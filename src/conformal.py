"""Split / cross-conformal prediction sets (module 02, section 3.5).

A prediction set contains every label the model cannot rule out at level alpha.
{"CAD", "No CAD"} means Uncertain, and that state drives the translucent, slowly
pulsing arteries in the 3D scene.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config, contract


def nonconformity(p: np.ndarray, y: np.ndarray) -> np.ndarray:
    """1 - probability assigned to the true class."""
    p, y = np.asarray(p, float), np.asarray(y, int)
    return 1 - np.where(y == 1, p, 1 - p)


def conformal_threshold(p_cal, y_cal, alpha: float | None = None) -> float:
    alpha = config.settings()["conformal"]["alpha"] if alpha is None else alpha
    s = nonconformity(p_cal, y_cal)
    n = len(s)
    q = np.ceil((n + 1) * (1 - alpha)) / n
    return float(np.quantile(s, min(q, 1.0), method="higher"))


def conformal_set(p: float, qhat: float) -> list[str]:
    out = []
    if 1 - p <= qhat:
        out.append(contract.POSITIVE)
    if p <= qhat:
        out.append(contract.NEGATIVE)
    return out  # [] is rare; contract.state_from_set treats it as Uncertain


def set_stats(p, y, qhat: float) -> dict:
    """Empirical coverage and how often each state occurs."""
    sets = [conformal_set(pi, qhat) for pi in p]
    truth = [contract.POSITIVE if yi == 1 else contract.NEGATIVE for yi in y]
    states = pd.Series([contract.state_from_set(s) for s in sets])
    return {
        "coverage": round(float(np.mean([t in s for t, s in zip(truth, sets)])), 4),
        "uncertain_rate": round(float((states == contract.UNCERTAIN).mean()), 4),
        "empty_rate": round(float(np.mean([len(s) == 0 for s in sets])), 4),
        "singleton_accuracy": round(float(np.mean(
            [t in s for t, s in zip(truth, sets) if len(s) == 1])) if any(len(s) == 1 for s in sets)
            else float("nan"), 4),
    }


def cross_conformal_coverage(oof: pd.DataFrame, alpha: float | None = None) -> dict:
    """Honest coverage estimate from out-of-fold predictions.

    For every (repeat, fold), qhat is computed from the OOF scores of the other folds
    in the same repeat and then applied to the held-out fold. No patient's own score
    contributes to the threshold used on that patient.
    Expects columns: repeat, fold, y, p.
    """
    covered, uncertain, n = 0, 0, 0
    for (r, k), test in oof.groupby(["repeat", "fold"]):
        cal = oof[(oof["repeat"] == r) & (oof["fold"] != k)]
        qhat = conformal_threshold(cal["p"], cal["y"], alpha)
        st = set_stats(test["p"].to_numpy(), test["y"].to_numpy(), qhat)
        covered += st["coverage"] * len(test)
        uncertain += st["uncertain_rate"] * len(test)
        n += len(test)
    return {"coverage": round(covered / n, 4), "uncertain_rate": round(uncertain / n, 4)}


def uncertainty_score(p, spread) -> np.ndarray:
    """Continuous uncertainty in [0, 1] for the 3D pulse and opacity effects.

    Blends ambiguity (closeness to 0.5) with disagreement across the calibrated
    fold ensemble; a spread of 0.10 or more counts as maximal disagreement.
    """
    p, spread = np.asarray(p, float), np.asarray(spread, float)
    ambiguity = 1 - np.abs(2 * p - 1)
    disagreement = np.clip(spread / 0.10, 0, 1)
    return np.round(np.clip(0.7 * ambiguity + 0.3 * disagreement, 0, 1), 4)
