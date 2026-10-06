"""Probability calibration (module 02, section 3.4).

Artery colors map straight to probabilities, so a 0.7 must mean roughly 70%.
Platt (sigmoid) scaling is used: isotonic regression needs more data than the
~240 training rows available per fold.
"""
from __future__ import annotations

import numpy as np
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.metrics import brier_score_loss
from sklearn.model_selection import StratifiedKFold

from . import config


def calibrated(estimator, method: str | None = None, cv: int | None = None,
               seed: int | None = None) -> CalibratedClassifierCV:
    """Wrap an unfitted estimator. With ensemble=True, the result holds one
    calibrated copy per CV fold; their spread is used as an uncertainty signal."""
    t = config.settings()["training"]
    return CalibratedClassifierCV(
        estimator,
        method=method or t["calibration"],
        cv=StratifiedKFold(cv or t["calibration_cv"], shuffle=True,
                           random_state=config.seed() if seed is None else seed),
        ensemble=True,
    )


def predict_folds(model: CalibratedClassifierCV, X) -> np.ndarray:
    """rows x folds: calibrated probability from each copy in the fold ensemble."""
    return np.column_stack([c.predict_proba(X)[:, 1] for c in model.calibrated_classifiers_])


def predict_with_spread(model: CalibratedClassifierCV, X) -> tuple[np.ndarray, np.ndarray]:
    """Mean calibrated probability and the std across the fold ensemble."""
    per_fold = predict_folds(model, X)
    return per_fold.mean(axis=1), per_fold.std(axis=1)


def reliability(y, p, n_bins: int = 8) -> dict:
    """Reliability-curve points (quantile bins keep every bin populated)."""
    frac_pos, mean_pred = calibration_curve(y, p, n_bins=n_bins, strategy="quantile")
    return {"mean_predicted": np.round(mean_pred, 4).tolist(),
            "fraction_positive": np.round(frac_pos, 4).tolist(),
            "brier": round(float(brier_score_loss(y, p)), 4)}
