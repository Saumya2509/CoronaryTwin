"""Model registry for serving: everything expensive is loaded once at startup.

Whatever artifacts/registry.json lists is served. Adding a target (e.g. left main)
is a registry entry plus an anatomy.json entry, not a routing change.
"""
from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from src import casebase, config, explain
from src.demo_patients import DEMO_JSON
from src.inference import Predictor

FORCE_MOCK_ENV = "CORONARYTWIN_MOCK"


def predictor_available() -> bool:
    return config.REGISTRY_JSON.exists() and (Path(__file__).parent / "predict.py").exists()


def mode() -> str:
    """'models' when trained artifacts are present, else 'mock' (fixtures).
    Set CORONARYTWIN_MOCK=1 to force mock mode, e.g. for frontend work."""
    if os.environ.get(FORCE_MOCK_ENV, "").strip() in {"1", "true", "yes"}:
        return "mock"
    return "models" if predictor_available() else "mock"


@dataclass
class ServingState:
    predictor: Predictor
    explainers: explain.Explainers
    stats: dict
    demos: dict[str, dict]
    registry: dict
    cases: casebase.CaseBase | None = None   # similar patients, OOD check, next best test

    @property
    def version(self) -> str:
        return self.predictor.version

    def threshold(self, target: str) -> float:
        return float(self.predictor.entries[target]["threshold"])


@lru_cache(maxsize=1)
def state() -> ServingState:
    reference = explain.load_background() if explain.BACKGROUND_CSV.exists() else None
    pred = Predictor(reference=reference)
    targets = set(pred.targets)
    expected = set(config.all_targets())
    if targets != expected:
        raise RuntimeError(f"registry targets {sorted(targets)} != settings targets {sorted(expected)}")
    demos = json.loads(DEMO_JSON.read_text(encoding="utf-8"))["patients"] if DEMO_JSON.exists() else {}
    return ServingState(
        predictor=pred,
        explainers=explain.Explainers(pred),
        stats=explain.load_stats(),
        demos=demos,
        registry=json.loads(config.REGISTRY_JSON.read_text(encoding="utf-8")),
        cases=casebase.load(),
    )


def reset() -> None:
    """Drop cached models (tests, or after retraining)."""
    state.cache_clear()
