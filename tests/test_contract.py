"""Cross-module contract tests: vessel IDs, fixtures and shared rules."""
import json

import pytest

from app.schemas import PredictResponse
from src import config, contract

FIXTURES = sorted((config.FIXTURES_DIR / "responses").glob("*.json"))


def load(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_fixtures_exist():
    assert len(FIXTURES) >= 3, "run: python scripts/make_mock_fixtures.py"


def test_vessel_ids_consistent_with_anatomy():
    anat_ids = [v["id"] for v in load(config.ANATOMY_JSON)["vessels"]]
    assert anat_ids == config.vessel_ids()


def test_vessel_ids_consistent_with_registry():
    if not config.REGISTRY_JSON.exists():
        pytest.skip("artifacts/registry.json not trained yet")
    reg_ids = set(load(config.REGISTRY_JSON)["targets"]) - {config.overall_target()}
    assert reg_ids == set(config.vessel_ids())


def test_banned_columns_include_every_vessel_label():
    banned = set(config.settings()["banned_inputs"])
    assert set(config.vessel_ids()) <= banned
    assert "Cath" in banned


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_fixture_matches_contract(path):
    resp = PredictResponse.model_validate(load(path))
    assert resp.disclaimer == config.disclaimer()
    for v in [resp.overall, *resp.vessels.values()]:
        assert v.state == contract.state_from_set(v.set)
    expected = contract.coherence(resp.overall.prob, {k: v.prob for k, v in resp.vessels.items()})
    assert resp.coherence.flag == expected["flag"]


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_group_totals_equal_feature_sums(path):
    resp = PredictResponse.model_validate(load(path))
    for target, exp in resp.explanations.items():
        for group, total in exp.groups.items():
            s = sum(f.shap for f in exp.features if f.group == group)
            assert s == pytest.approx(total, abs=1e-3), (target, group)


@pytest.mark.parametrize("path", FIXTURES, ids=lambda p: p.stem)
def test_fixture_features_exist_in_registry(path):
    from src import data
    names = set(data.feature_names())
    for exp in load(path)["explanations"].values():
        assert {f["name"] for f in exp["features"]} <= names


def test_fixtures_cover_every_state():
    states = {v["state"] for p in FIXTURES for v in load(p)["vessels"].values()}
    assert states == {"Likely", "Unlikely", "Uncertain"}
    assert any(load(p)["coherence"]["flag"] for p in FIXTURES)


def test_state_and_coherence_rules():
    assert contract.state_from_set(["CAD"]) == "Likely"
    assert contract.state_from_set(["No CAD"]) == "Unlikely"
    assert contract.state_from_set(["CAD", "No CAD"]) == "Uncertain"
    assert contract.state_from_set([]) == "Uncertain"
    assert contract.coherence(0.9, {"LAD": 0.1, "LCX": 0.2, "RCA": 0.2})["flag"]
    assert contract.coherence(0.1, {"LAD": 0.9, "LCX": 0.2, "RCA": 0.2})["flag"]
    assert not contract.coherence(0.9, {"LAD": 0.8, "LCX": 0.2, "RCA": 0.2})["flag"]
