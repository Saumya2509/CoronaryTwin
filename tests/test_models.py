"""Module 02: conformal, calibration, selection rules, nested CV and saved artifacts."""
import json

import joblib
import numpy as np
import pandas as pd
import pytest

from src import conformal, config, data, evaluate, train


# ---------------------------------------------------------------- conformal

def test_conformal_coverage_on_synthetic_data():
    rng = np.random.default_rng(0)
    p = rng.uniform(size=4000)
    y = (rng.uniform(size=4000) < p).astype(int)      # perfectly calibrated
    qhat = conformal.conformal_threshold(p[:2000], y[:2000], alpha=0.1)
    cov = conformal.set_stats(p[2000:], y[2000:], qhat)["coverage"]
    assert 0.87 <= cov <= 0.93


def test_conformal_set_states():
    assert conformal.conformal_set(0.95, 0.6) == ["CAD"]
    assert conformal.conformal_set(0.05, 0.6) == ["No CAD"]
    assert conformal.conformal_set(0.5, 0.6) == ["CAD", "No CAD"]


def test_cross_conformal_uses_other_folds_only():
    rng = np.random.default_rng(1)
    n = 600
    p = rng.uniform(size=n)
    oof = pd.DataFrame({"repeat": 0, "fold": np.arange(n) % 5, "p": p,
                        "y": (rng.uniform(size=n) < p).astype(int)})
    out = conformal.cross_conformal_coverage(oof, alpha=0.1)
    assert 0.85 <= out["coverage"] <= 0.95


def test_uncertainty_score_bounds():
    u = conformal.uncertainty_score([0.0, 0.5, 1.0, 0.5], [0.0, 0.0, 0.0, 0.5])
    assert u.min() >= 0 and u.max() <= 1
    assert u[1] > u[0] and u[3] > u[1]


# ---------------------------------------------------------------- selection rules

def test_one_se_rule_prefers_simpler_family_within_noise():
    aucs = {"logreg": pd.Series([0.80, 0.82, 0.78, 0.81, 0.79]),
            "xgb": pd.Series([0.805, 0.825, 0.785, 0.815, 0.795])}  # +0.005, SE ~0.007
    assert train.select_family(aucs) == "logreg"
    aucs["xgb"] = aucs["xgb"] + 0.10
    assert train.select_family(aucs) == "xgb"


def test_threshold_meets_min_recall():
    rng = np.random.default_rng(2)
    y = rng.integers(0, 2, 500)
    p = np.clip(y * 0.3 + rng.uniform(size=500) * 0.7, 0, 1)
    t = evaluate.choose_threshold(y, p, 0.85)
    from sklearn.metrics import recall_score
    assert recall_score(y, (p >= t).astype(int)) >= 0.85
    assert recall_score(y, (p >= t + 0.01).astype(int)) < 0.85 or t >= 0.95


# ---------------------------------------------------------------- nested CV

@pytest.fixture(scope="module")
def df():
    if not data.PROCESSED_CSV.exists():
        pytest.skip("run `python -m src.data` first")
    return pd.read_csv(data.PROCESSED_CSV)


def test_nested_cv_predicts_every_patient_once_per_repeat(df):
    from src.leakage_guard import make_xy
    X, y = make_xy(df, "CAD")
    t = {"outer_splits": 3, "outer_repeats": 1, "inner_splits": 3, "search_iter": 1}
    oof = train.nested_cv(X, y, "logreg", t)
    assert sorted(oof["idx"]) == list(range(len(df)))
    assert oof["p"].between(0, 1).all() and oof["p_base"].between(0, 1).all()
    assert (oof["spread"] >= 0).all()


# ---------------------------------------------------------------- saved artifacts

@pytest.fixture(scope="module")
def registry():
    if not config.REGISTRY_JSON.exists():
        pytest.skip("run `python -m src.train` first")
    return json.loads(config.REGISTRY_JSON.read_text(encoding="utf-8"))


def test_registry_covers_all_targets(registry):
    assert set(registry["targets"]) == set(config.all_targets())
    for entry in registry["targets"].values():
        assert 0 < entry["threshold"] < 1
        assert 0 < entry["qhat"] <= 1


def test_saved_models_predict_valid_probabilities(registry, df):
    X = df[data.feature_names()].head(10)
    for target, entry in registry["targets"].items():
        bundle = joblib.load(config.ARTIFACTS_DIR / entry["path"])
        assert bundle["feature_order"] == data.feature_names()
        assert bundle["target"] == target
        p = bundle["calibrated"].predict_proba(X)[:, 1]
        assert ((p >= 0) & (p <= 1)).all()
        assert bundle["base"].predict_proba(X).shape == (10, 2)


def test_metrics_json_complete(registry):
    m = json.loads(config.METRICS_JSON.read_text(encoding="utf-8"))
    assert m["version"] == registry["version"]
    for t in config.all_targets():
        r = m["targets"][t]
        for key in ["metrics_at_0.5", "metrics_at_threshold"]:
            for metric in evaluate.METRICS:
                lo, hi = r[key][metric]["ci95"]
                assert lo <= r[key][metric]["mean"] <= hi
        assert r["curves"]["roc"]["fpr"][0] == 0
        assert r["subgroups"]
