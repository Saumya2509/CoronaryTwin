"""Specialities (md/09.md): next best test (S3), similar patients (A2), OOD warning (A3),
cohort summary (A4) and the experiments endpoint (S4)."""
import io

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app import registry
from app.main import app
from src import casebase, config, data


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="module")
def st(client):
    if registry.mode() != "models" or registry.state().cases is None:
        pytest.skip("trained models or case base not available")
    return registry.state()


@pytest.fixture(scope="module")
def high(client, st):
    return client.get("/demo-patients").json()["high"]["features"]


# ---------------------------------------------------------------- A3 out-of-distribution

def test_ood_quiet_on_real_patient(client, high):
    ood = client.post("/predict", json={"features": high}).json()["ood"]
    assert ood is not None and ood["flag"] is False and ood["reasons"] == []


def test_ood_fires_beyond_training_range(client, high, st):
    lo, hi = st.cases.art["ranges"]["ldl"]
    rec = {**high, "ldl": min(hi + 100, 400), "age": 105}
    ood = client.post("/predict", json={"features": rec}).json()["ood"]
    assert ood["flag"] is True
    assert any("LDL" in r for r in ood["out_of_range"]) and any("Age" in r for r in ood["out_of_range"])


def test_ood_rare_on_training_data(st):
    df = st.cases.art["raw"]
    rate = np.mean([st.cases.ood(r)["flag"] for r in df.to_dict("records")])
    assert rate <= 0.03          # cut-off is the 99th percentile; no training value is out of range


def test_blank_fields_never_look_unusual(st):
    assert st.cases.ood({"age": 60, "sex_male": 1})["flag"] is False


# ---------------------------------------------------------------- A2 similar patients

def test_similar_cases_are_coarse(client, high):
    body = client.post("/similar", json={"features": high, "k": 4}).json()
    assert len(body["cases"]) == 4 and body["caption"] and body["disclaimer"]
    d = [c["distance"] for c in body["cases"]]
    assert d == sorted(d)
    for c in body["cases"]:
        assert set(c) == {"rank", "distance", "summary", "outcomes"}       # no raw row, no row number
        assert set(c["outcomes"]) == set(config.all_targets())
        assert "-year-old" in c["summary"]


def test_similar_works_on_partial_record(client):
    body = client.post("/similar", json={"features": {"age": 70, "sex_male": 0, "typical_chest_pain": 1}}).json()
    assert body["matched_on"] == 3 and len(body["cases"]) == 5


def test_casebase_weights_are_a_distribution(st):
    w = st.cases.art["weights"]
    assert len(w) == len(data.feature_names()) and np.isclose(w.sum(), 1) and (w > 0).all()


# ---------------------------------------------------------------- S3 next best test

def test_next_best_test_ranks_only_missing(client, high):
    blank = ["ef_tte", "region_rwma", "vhd", "ldl", "q_wave"]
    rec = {k: (None if k in blank else v) for k, v in high.items()}
    body = client.post("/next-best-test", json={"features": rec}).json()
    assert body["n_missing"] == len(blank)
    assert {f["name"] for f in body["features"]} <= set(blank)
    assert [t["name"] for t in body["tests"]] == ["Echo"]       # only Echo has >= 2 blank fields
    assert set(body["tests"][0]["fills"]) == {"ef_tte", "region_rwma", "vhd"}
    scores = [f["score"] for f in body["features"]]
    assert scores == sorted(scores, reverse=True)
    for f in body["features"]:
        for t in config.all_targets():
            pt = f["per_target"][t]
            assert 0 <= pt["p_definite"] <= 1 and pt["range"][0] <= pt["range"][1]
    assert "not by clinical necessity" in body["caption"]


def test_next_best_test_complete_record(client, high):
    body = client.post("/next-best-test", json={"features": high}).json()
    assert body["n_missing"] == 0 and body["tests"] == [] and body["features"] == []


def test_next_best_test_single_target(client, high):
    rec = {**high, "ef_tte": None, "ldl": None}
    body = client.post("/next-best-test", json={"features": rec, "target": "LAD"}).json()
    assert all(f["score"] == f["per_target"]["LAD"]["spread"] for f in body["features"])
    assert client.post("/next-best-test", json={"features": rec, "target": "XYZ"}).status_code == 422


def test_next_best_test_deterministic(st, high):
    from src import nextbest
    rec = {**high, "ef_tte": None, "tg": None}
    a = nextbest.next_best(st.predictor, st.cases, rec)
    b = nextbest.next_best(st.predictor, st.cases, rec)
    assert a == b


# ---------------------------------------------------------------- A4 cohort summary

def test_batch_cohort_summary(client, high, st):
    cols = data.feature_names()
    lines = [",".join(cols)]
    for _ in range(3):
        lines.append(",".join("" if high[c] is None else str(high[c]) for c in cols))
    body = client.post("/predict/batch", files={"file": ("c.csv", io.BytesIO("\n".join(lines).encode()), "text/csv")}).json()
    s = body["summary"]
    assert s["n"] == 3
    for t in config.all_targets():
        ts = s["targets"][t]
        assert ts["likely"] + ts["uncertain"] + ts["unlikely"] == 3
    assert all(r["ood"] is False for r in body["rows"])


# ---------------------------------------------------------------- S4 experiments

def test_experiments_endpoint(client):
    from src import experiments
    if not experiments.EXPERIMENTS_JSON.exists():
        pytest.skip("run python -m src.experiments")
    body = client.get("/experiments").json()
    for t in config.all_targets():
        r = body["targets"][t]
        assert set(r["refit"]["ablation"]) == set(config.feature_groups())
        assert len(r["decision"]["model"]) == len(r["decision"]["thresholds"])
        assert r["comparison"][r["selected"]]["selected"] is True
    assert 0 <= body["ood"]["false_alarm_rate_training"] <= 0.05


def test_casebase_artifact_matches_registry():
    cb = casebase.load()
    if cb is None:
        pytest.skip("case base not built")
    assert cb.names == data.feature_names()


# ---------------------------------------------------------------- sub-model range (md/10.md hero range)

def test_submodel_range_brackets_estimate(client, high):
    body = client.post("/predict", json={"features": high}).json()
    for r in [body["overall"], *body["vessels"].values()]:
        lo, hi = r["range"]
        assert 0 <= lo <= r["prob"] <= hi <= 1


# ---------------------------------------------------------------- CSV samples (csv/demo.json)

def test_demo_set_serves_ten_complete_samples(client):
    body = client.get("/demo-set").json()
    assert body["errors"] == [] and len(body["demo"]) == 10
    assert len({d["file"] for d in body["demo"]}) == 10                     # ten different files
    assert body["demo"][0]["label"].startswith("Low") and body["demo"][-1]["label"].startswith("High")
    for d in body["demo"]:
        header, row = d["csv"].strip().splitlines()[:2]
        assert len(header.split(",")) == len(row.split(",")) == 52
        assert ",," not in row and not row.endswith(",")      # no missing values


def test_demo_set_skips_bad_entries(client, monkeypatch, tmp_path):
    import json as _json
    from app import main
    (tmp_path / "ok.csv").write_text("age\n50\n", encoding="utf-8")
    manifest = tmp_path / "demo.json"
    manifest.write_text(_json.dumps({"demo": [{"file": "ok.csv", "label": "A"}, {"file": "missing.csv"},
                                               {"file": "../secret.csv"}]}), encoding="utf-8")
    monkeypatch.setattr(main, "DEMO_MANIFEST", manifest)
    body = client.get("/demo-set").json()
    assert [d["file"] for d in body["demo"]] == ["ok.csv"] and len(body["errors"]) == 2
