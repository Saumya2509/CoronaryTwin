"""Module 07: the system extends through registries, and drift is caught.

The brief asks that new clinical features, models or anatomical structures can be
added without a redesign. These tests show that the registries drive the code, and
that the consistency checker fails loudly when they disagree.
"""
import copy
import importlib.util
import sys
from pathlib import Path

import pytest

from src import config, data

ROOT = Path(__file__).resolve().parents[1]


def load_checker():
    spec = importlib.util.spec_from_file_location("check_registries", ROOT / "scripts" / "check_registries.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["check_registries"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_registries_agree():
    assert load_checker().main() == 0


def test_checker_catches_a_vessel_added_in_only_one_place(monkeypatch):
    """Adding 'LM' to settings without anatomy, model and fixtures must fail the check."""
    settings = copy.deepcopy(config.settings())
    settings["targets"]["vessels"] = [*settings["targets"]["vessels"], "LM"]
    monkeypatch.setattr(config, "settings", lambda: settings)
    checker = load_checker()
    assert checker.main() == 1
    joined = " ".join(checker.problems)
    assert "anatomy.json" in joined and "LM" in joined


def test_checker_catches_unknown_feature_group(monkeypatch):
    feats = copy.deepcopy(data.features())
    feats[0]["group"] = "Genomics"
    monkeypatch.setattr(data, "features", lambda: feats)
    checker = load_checker()
    assert checker.main() == 1
    assert any("Genomics" in p for p in checker.problems)


def test_new_feature_gets_api_validation_without_code_changes(monkeypatch):
    """A new numeric registry entry becomes a validated API field automatically."""
    from app import schemas
    new = {"name": "troponin", "source": "Troponin", "label": "Troponin I", "unit": "ng/L",
           "type": "numeric", "group": "Labs", "valid_range": [0, 50000], "normal_range": [0, 14],
           "modifiable": False, "step": 1, "patient_text": "Your troponin"}
    monkeypatch.setattr(data, "features", lambda: [*data.registry()["features"], new])
    Model = schemas.build_input_model()
    assert "troponin" in Model.model_fields
    Model.model_validate({"troponin": 12})
    with pytest.raises(Exception):
        Model.model_validate({"troponin": -5})


def test_new_feature_reaches_preprocessing(monkeypatch):
    new = {"name": "troponin", "source": "Troponin", "label": "Troponin I", "type": "numeric",
           "group": "Labs", "valid_range": [0, 50000], "step": 1, "patient_text": "x"}
    monkeypatch.setattr(data, "features", lambda: [*data.registry()["features"], new])
    pre = data.build_preprocessor()
    numeric_cols = next(cols for name, _, cols in pre.transformers if name == "num")
    assert "troponin" in numeric_cols


def test_api_serves_whatever_the_registry_lists():
    """Routing is generic: /model-info lists targets from the registry, not hard-coded names."""
    from fastapi.testclient import TestClient
    from app.main import app
    body = TestClient(app).get("/model-info").json()
    assert body["targets"] == config.all_targets()
