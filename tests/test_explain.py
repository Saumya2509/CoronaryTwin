"""Module 03: SHAP correctness, grouping, wording, what-if and counterfactuals."""
import numpy as np
import pandas as pd
import pytest
from scipy.special import logit

from app.schemas import Explanation
from src import config, data, explain, models
from src.leakage_guard import make_xy

FAMILIES = ["logreg", "rf", "xgb", "lgbm"]


@pytest.fixture(scope="module")
def df():
    if not data.PROCESSED_CSV.exists():
        pytest.skip("run `python -m src.data` first")
    return pd.read_csv(data.PROCESSED_CSV)


@pytest.fixture(scope="module")
def fitted(df):
    X, y = make_xy(df, "LAD")
    out = {}
    for fam in FAMILIES:
        pipe = models.make_pipeline(fam)
        if fam != "logreg":
            pipe.set_params(**{"clf__n_estimators": 50})
        pipe.fit(X, y)
        out[fam] = (pipe, explain.TargetExplainer("LAD", pipe, fam, X.sample(60, random_state=0)))
    return X, y, out


@pytest.mark.parametrize("fam", FAMILIES)
def test_shap_is_additive(fitted, fam):
    """base value + sum of feature SHAP == model output (in the explainer's units)."""
    X, _, out = fitted
    pipe, e = out[fam]
    rows = X.head(15)
    total = e.shap_frame(rows).sum(axis=1).to_numpy() + e.base_value
    p = pipe.predict_proba(rows)[:, 1]
    target = p if e.units == "probability" else logit(np.clip(p, 1e-12, 1 - 1e-12))
    np.testing.assert_allclose(total, target, atol=1e-3 if fam != "logreg" else 1e-6)


@pytest.mark.parametrize("fam", FAMILIES)
def test_dummies_summed_back_to_original_feature(fitted, fam):
    X, _, out = fitted
    sv = out[fam][1].shap_frame(X.head(5))
    assert list(sv.columns) == data.feature_names()
    assert not any(c.startswith("bbb_") for c in sv.columns)


@pytest.mark.parametrize("fam", FAMILIES)
def test_group_sums_equal_total(fitted, fam):
    X, _, out = fitted
    payload = out[fam][1].explain(X.iloc[[3]])
    total = sum(f["shap"] for f in payload["features"])
    assert sum(payload["groups"].values()) == pytest.approx(total, abs=1e-3)
    for g, v in payload["groups"].items():
        assert v == pytest.approx(sum(f["shap"] for f in payload["features"] if f["group"] == g), abs=1e-3)


def test_payload_matches_api_contract(fitted):
    X, _, out = fitted
    payload = out["logreg"][1].explain(X.iloc[[0]])
    Explanation.model_validate(payload)
    assert set(payload["groups"]) == set(config.feature_groups())
    assert payload["features"] == sorted(payload["features"], key=lambda f: -abs(f["shap"]))


def test_wording_names_top_driver(fitted):
    X, _, out = fitted
    payload = out["logreg"][1].explain(X.iloc[[0]])
    top = payload["features"][0]["name"]
    spec = {f["name"]: f for f in data.features()}
    assert spec[top]["label"] in payload["text"]
    assert "doctor" in payload["text_patient"]
    assert "LAD" in payload["text"]


def test_patient_text_negates_absent_findings():
    feats = [{"name": "region_rwma", "value": 0, "shap": -0.3, "group": "Echo"},
             {"name": "systolic_murmur", "value": 0, "shap": 0.2, "group": "Vitals"},
             {"name": "typical_chest_pain", "value": 1, "shap": 0.1, "group": "Symptoms"}]
    text = explain.patient_text("LAD", feats)
    assert "No heart murmur" in text
    assert "chest pain typical of heart problems" in text
    assert "No areas of heart wall" in text


def test_range_status():
    assert explain.range_status("ldl", 150) == "above"
    assert explain.range_status("ldl", 80) == "within"
    assert explain.range_status("hdl", 30) == "below"
    assert explain.range_status("hdl", 90) == "within"     # open upper bound
    assert explain.range_status("age", 60) is None          # no normal range


# ---------------------------------------------------------------- what-if / counterfactual

@pytest.fixture(scope="module")
def stats(df):
    return explain.feature_stats(df)


def test_whatif_rejects_non_modifiable(fitted):
    X, _, out = fitted
    fn = {"LAD": lambda Z: out["logreg"][0].predict_proba(Z)[:, 1]}
    with pytest.raises(ValueError):
        explain.whatif(fn, X.iloc[[0]], {"age": 30})
    res = explain.whatif(fn, X.iloc[[0]], {"bp": 110})
    assert res["deltas"]["LAD"] == pytest.approx(res["after"]["LAD"] - res["before"]["LAD"], abs=1e-4)
    assert "not medical advice" in res["caption"]


def test_counterfactual_moves_below_threshold_toward_normal(fitted, stats):
    X, _, out = fitted
    pipe = out["logreg"][0]
    fn = lambda Z: pipe.predict_proba(Z)[:, 1]  # noqa: E731
    p = fn(X)
    # a patient above threshold who has at least one out-of-range modifiable value
    row = next(i for i in np.argsort(-p)
               if p[i] < 0.95 and (X.iloc[i]["ldl"] > 100 or X.iloc[i]["bp"] > 120))
    thr = float(p[row]) - 0.05
    res = explain.counterfactual(fn, X.iloc[[row]], thr, stats)
    assert not res["already_below"]
    assert res["options"], "expected at least one counterfactual"
    efforts = [o["effort_sd"] for o in res["options"]]
    assert efforts == sorted(efforts)
    spec = {f["name"]: f for f in data.features()}
    for opt in res["options"]:
        assert opt["new_prob"] < thr
        for ch in opt["changes"]:
            assert spec[ch["feature"]]["modifiable"]
            assert stats[ch["feature"]]["p01"] - 1e-9 <= ch["to"] <= stats[ch["feature"]]["p99"] + 1e-9
            nr = spec[ch["feature"]].get("normal_range")
            if nr and nr[1] is not None and ch["from"] > nr[1]:
                assert ch["to"] < ch["from"]          # never pushed further out of range


def test_counterfactual_already_below(fitted, stats):
    X, _, out = fitted
    fn = lambda Z: out["logreg"][0].predict_proba(Z)[:, 1]  # noqa: E731
    res = explain.counterfactual(fn, X.iloc[[0]], threshold=1.01, stats=stats)
    assert res["already_below"] and res["options"] == []
