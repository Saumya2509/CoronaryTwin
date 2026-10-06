"""Load the trained models from the registry and turn patient records into predictions.

Shared by the explainability code (what-if, counterfactuals) and the API (module 04),
so serving and analysis cannot disagree on feature order, encoding or the conformal rule.
"""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Iterable

import joblib
import numpy as np
import pandas as pd

from . import calibrate, config, conformal, contract, data, fastpath


def _num(v) -> float:
    if v is None:
        return np.nan
    try:
        return float(v)
    except (TypeError, ValueError):
        return np.nan


def to_frame(records: dict | Iterable[dict]) -> pd.DataFrame:
    """Records keyed by canonical feature name -> model-ready frame in manifest order.

    Accepts raw values (e.g. "Y", "LBBB") or encoded ones (1, "left"). Missing or
    None values become NaN and are imputed by the pipeline."""
    if isinstance(records, dict):
        records = [records]
    rows = [data.apply_encodings(r) for r in records]
    cats = set(data.columns_by_type("categorical"))
    cols = {}
    for name in data.feature_names():
        if name in cats:
            cols[name] = pd.Series([r.get(name) for r in rows], dtype=object)
        else:
            cols[name] = np.array([_num(r.get(name)) for r in rows], dtype=float)
    return pd.DataFrame(cols)


class Predictor:
    """All registry models plus their thresholds and conformal quantiles."""

    def __init__(self, registry_path: Path = config.REGISTRY_JSON, reference: pd.DataFrame | None = None):
        """`reference` rows (e.g. the SHAP background) enable the verified numpy fast path."""
        reg = json.loads(Path(registry_path).read_text(encoding="utf-8"))
        self.version: str = reg["version"]
        self.entries: dict[str, dict] = reg["targets"]
        self.bundles: dict[str, dict] = {}
        for target, entry in self.entries.items():
            bundle = joblib.load(config.ARTIFACTS_DIR / entry["path"])
            if bundle["feature_order"] != data.feature_names():
                raise RuntimeError(f"{target}: model feature order differs from features.yaml; retrain")
            if reference is not None:
                fastpath.accelerate(bundle, reference)
            self.bundles[target] = bundle

    @property
    def targets(self) -> list[str]:
        return list(self.entries)

    def proba(self, target: str, X: pd.DataFrame) -> tuple[np.ndarray, np.ndarray]:
        """Calibrated probability and fold-ensemble spread."""
        return calibrate.predict_with_spread(self.bundles[target]["calibrated"], X)

    def proba_folds(self, target: str, X: pd.DataFrame) -> np.ndarray:
        """rows x sub-models: each calibrated fold copy's probability (for the sub-model range)."""
        return calibrate.predict_folds(self.bundles[target]["calibrated"], X)

    def proba_fn(self, target: str):
        return lambda X: self.proba(target, X)[0]

    def predict(self, record: dict[str, Any]) -> dict[str, dict]:
        """One patient -> {target: {prob, uncertainty, set, state}}."""
        X = to_frame(record)
        out = {}
        for target in self.targets:
            p, spread = self.proba(target, X)
            s = conformal.conformal_set(float(p[0]), self.entries[target]["qhat"])
            out[target] = {
                "prob": round(float(p[0]), 4),
                "uncertainty": float(conformal.uncertainty_score(p, spread)[0]),
                "set": s,
                "state": contract.state_from_set(s),
            }
        return out


@lru_cache(maxsize=1)
def predictor() -> Predictor:
    return Predictor()
