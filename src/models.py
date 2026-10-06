"""Candidate model families and their hyperparameter search spaces (module 02).

Every family is a Pipeline(pre -> clf) so preprocessing is always fitted inside
the training fold. Search spaces are deliberately small and regularized: with
~240 training rows per fold, shallow trees and strong penalties generalize best.
"""
from __future__ import annotations

from lightgbm import LGBMClassifier
from scipy.stats import loguniform, randint, uniform
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from xgboost import XGBClassifier

from . import config, data

FAMILY_LABELS = {
    "logreg": "Logistic regression",
    "rf": "Random forest",
    "xgb": "XGBoost",
    "lgbm": "LightGBM",
}


def _estimator(family: str, seed: int):
    if family == "logreg":
        return LogisticRegression(solver="liblinear", max_iter=5000, random_state=seed)
    if family == "rf":
        return RandomForestClassifier(n_estimators=300, n_jobs=1, random_state=seed)
    if family == "xgb":
        return XGBClassifier(n_estimators=200, n_jobs=1, verbosity=0, random_state=seed,
                             eval_metric="logloss")
    if family == "lgbm":
        return LGBMClassifier(n_estimators=200, n_jobs=1, verbose=-1, random_state=seed)
    raise ValueError(f"unknown model family {family!r}")


PARAM_SPACE = {
    "logreg": {
        "clf__C": loguniform(1e-3, 10),
        # sklearn >= 1.8: l1_ratio replaces `penalty` (0 = L2 / ridge, 1 = L1 / lasso).
        "clf__l1_ratio": [0.0, 1.0],
        "clf__class_weight": [None, "balanced"],
    },
    "rf": {
        "clf__max_depth": [3, 4, 5, 6, None],
        "clf__min_samples_leaf": randint(2, 15),
        "clf__max_features": ["sqrt", 0.3, 0.5],
        "clf__class_weight": [None, "balanced"],
    },
    "xgb": {
        "clf__max_depth": randint(2, 5),
        "clf__learning_rate": loguniform(0.01, 0.3),
        "clf__subsample": uniform(0.6, 0.4),
        "clf__colsample_bytree": uniform(0.4, 0.6),
        "clf__min_child_weight": randint(1, 10),
        "clf__reg_lambda": loguniform(0.1, 20),
    },
    "lgbm": {
        "clf__num_leaves": randint(4, 16),
        "clf__max_depth": randint(2, 5),
        "clf__learning_rate": loguniform(0.01, 0.3),
        "clf__min_child_samples": randint(5, 30),
        "clf__subsample": uniform(0.6, 0.4),
        "clf__subsample_freq": [1],
        "clf__colsample_bytree": uniform(0.4, 0.6),
        "clf__reg_lambda": loguniform(0.1, 20),
    },
}


def make_pipeline(family: str, seed: int | None = None) -> Pipeline:
    seed = config.seed() if seed is None else seed
    return Pipeline([("pre", data.build_preprocessor()), ("clf", _estimator(family, seed))])


def param_space(family: str) -> dict:
    return PARAM_SPACE[family]
