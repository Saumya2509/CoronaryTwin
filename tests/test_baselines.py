"""Guideline pre-test probability scores (src/baselines.py) and their place in /predict."""
import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient

from app import registry
from app.main import app
from src import baselines, data


def rec(**kw):
    base = {"age": 55, "sex_male": 1, "typical_chest_pain": 0, "atypical_chest_pain": 0,
            "nonanginal_chest_pain": 0, "dyspnea": 0, "diabetes": 0, "hypertension": 0,
            "dyslipidemia": 0, "current_smoker": 0, "ex_smoker": 0}
    return {**base, **kw}


def test_symptom_mapping():
    assert baselines.symptom(rec(typical_chest_pain=1)) == "typical"
    assert baselines.symptom(rec(atypical_chest_pain=1)) == "atypical"
    assert baselines.symptom(rec(nonanginal_chest_pain=1)) == "nonanginal"
    assert baselines.symptom(rec(dyspnea=1)) == "dyspnoea"
    assert baselines.symptom(rec()) == "nonanginal"
    assert baselines.symptom(rec(typical_chest_pain=None)) is None


@pytest.mark.parametrize("age,male,sym,expected", [
    (55, 1, "typical", 0.32), (55, 0, "typical", 0.13), (35, 1, "dyspnoea", 0.0),
    (72, 0, "dyspnoea", 0.12), (86, 1, "nonanginal", 0.24), (44, 0, "atypical", 0.06),
])
def test_esc2019_table(age, male, sym, expected):
    assert baselines.esc2019(age, male, sym) == pytest.approx(expected)


def test_esc2013_has_no_dyspnoea_column():
    assert baselines.esc2013(65, 1, "dyspnoea") == baselines.esc2013(65, 1, "nonanginal") == pytest.approx(0.44)


def test_cad_consortium_monotone():
    young, old = baselines.cadc(40, 0, "nonanginal"), baselines.cadc(70, 1, "typical")
    assert 0 < young < old < 1
    plain = baselines.cadc_rf(60, 1, "typical", rec())
    risky = baselines.cadc_rf(60, 1, "typical", rec(hypertension=1, dyslipidemia=1, current_smoker=1))
    assert risky > plain


def test_patient_scores_need_age_sex_symptoms():
    assert baselines.patient_scores(rec(age=None)) is None
    out = baselines.patient_scores(rec(typical_chest_pain=1, diabetes=None))
    ids = [s["id"] for s in out["scores"]]
    assert ids == ["esc2019", "esc2013", "cadc"]       # clinical CAD Consortium needs the risk factors
    assert out["esc2019_band"].startswith(">15%")


def test_every_dataset_patient_is_scored():
    df = pd.read_csv(data.PROCESSED_CSV)
    sf = baselines.score_frame(df)
    assert not sf.isna().any().any()
    assert ((sf >= 0) & (sf <= 1)).all().all()


def test_nri_identity_is_zero():
    y = np.array([0, 1, 1, 0, 1])
    p = np.array([0.1, 0.9, 0.5, 0.3, 0.7])
    r = baselines.nri(y, p, p)
    assert r["categorical"] == 0 and r["continuous"] == 0


def test_predict_returns_guideline():
    with TestClient(app) as c:
        if registry.mode() != "models":
            pytest.skip("trained models not available")
        feats = c.get("/demo-patients").json()["high"]["features"]
        g = c.post("/predict", json={"features": feats}).json()["guideline"]
        assert g is not None and {s["id"] for s in g["scores"]} >= {"esc2019", "esc2013", "cadc"}
        feats["age"] = None
        assert c.post("/predict", json={"features": feats}).json()["guideline"] is None
