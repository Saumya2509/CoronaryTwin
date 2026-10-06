"""Evaluation helpers for module 02: metrics with CIs, thresholds, subgroups, curves.

All inputs are out-of-fold (OOF) predictions from the nested CV in src/train.py,
so every number here comes from patients the scoring model never saw.
OOF frames have columns: repeat, fold, idx, y, p_base, p, spread.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.metrics import (accuracy_score, brier_score_loss, confusion_matrix, f1_score,
                             precision_recall_curve, precision_score, recall_score,
                             roc_auc_score, roc_curve)

from . import config

METRICS = ["roc_auc", "accuracy", "precision", "recall", "f1", "brier"]


def _metrics(y, p, threshold: float) -> dict:
    pred = (p >= threshold).astype(int)
    return {
        "roc_auc": roc_auc_score(y, p),
        "accuracy": accuracy_score(y, pred),
        "precision": precision_score(y, pred, zero_division=0),
        "recall": recall_score(y, pred, zero_division=0),
        "f1": f1_score(y, pred, zero_division=0),
        "brier": brier_score_loss(y, p),
    }


def fold_metrics(oof: pd.DataFrame, threshold: float = 0.5, col: str = "p") -> pd.DataFrame:
    rows = []
    for (r, k), g in oof.groupby(["repeat", "fold"]):
        rows.append({"repeat": r, "fold": k, **_metrics(g["y"].to_numpy(), g[col].to_numpy(), threshold)})
    return pd.DataFrame(rows)


def bootstrap_ci(values, n_boot: int, seed: int | None = None) -> tuple[float, float]:
    """95% percentile CI of the mean, resampling fold-level values.
    Folds from different repeats share patients, so the interval is approximate."""
    rng = np.random.default_rng(config.seed() if seed is None else seed)
    v = np.asarray(values, float)
    means = rng.choice(v, size=(n_boot, len(v)), replace=True).mean(axis=1)
    lo, hi = np.percentile(means, [2.5, 97.5])
    return float(lo), float(hi)


def summarize(folds: pd.DataFrame, n_boot: int) -> dict:
    out = {}
    for m in METRICS:
        lo, hi = bootstrap_ci(folds[m], n_boot)
        out[m] = {"mean": round(float(folds[m].mean()), 4), "ci95": [round(lo, 4), round(hi, 4)],
                  "sd": round(float(folds[m].std(ddof=1)) if len(folds) > 1 else 0.0, 4)}
    return out


def choose_threshold(y, p, min_recall: float) -> float:
    """Highest cut-off whose recall is still >= min_recall (recall favored for screening)."""
    best = 0.0
    for t in np.round(np.arange(0.05, 0.951, 0.01), 2):
        if recall_score(y, (p >= t).astype(int), zero_division=0) >= min_recall:
            best = float(t)
    return best


def patient_mean(oof: pd.DataFrame) -> pd.DataFrame:
    """One OOF prediction per patient: the mean over repeats."""
    return oof.groupby("idx").agg(y=("y", "first"), p=("p", "mean"), spread=("spread", "mean"))


def subgroups(per_patient: pd.DataFrame, frame: pd.DataFrame, threshold: float) -> list[dict]:
    """Metrics by sex and age band. Small groups are reported but marked."""
    df = per_patient.join(frame[["sex_male", "age"]])
    bands = pd.cut(df["age"], [0, 49, 64, 200], labels=["<50", "50-64", "65+"])
    groups = [("sex", "male", df["sex_male"] == 1), ("sex", "female", df["sex_male"] == 0)]
    groups += [("age", str(b), bands == b) for b in bands.cat.categories]
    out = []
    for kind, name, mask in groups:
        g = df[mask]
        both = g["y"].nunique() == 2
        pred = (g["p"] >= threshold).astype(int)
        out.append({
            "subgroup": kind, "level": name, "n": int(len(g)), "positives": int(g["y"].sum()),
            "roc_auc": round(float(roc_auc_score(g["y"], g["p"])), 4) if both else None,
            "recall": round(float(recall_score(g["y"], pred, zero_division=0)), 4) if g["y"].sum() else None,
            "precision": round(float(precision_score(g["y"], pred, zero_division=0)), 4),
            "small": bool(len(g) < 40 or g["y"].sum() < 10 or (len(g) - g["y"].sum()) < 10),
        })
    return out


def curves(oof: pd.DataFrame, threshold: float) -> dict:
    """ROC / PR points from repeat 0 (one prediction per patient) and the confusion
    matrix at the chosen threshold, for the dashboard's model-trust tab."""
    r0 = oof[oof["repeat"] == 0]
    y, p = r0["y"].to_numpy(), r0["p"].to_numpy()
    fpr, tpr, _ = roc_curve(y, p)
    prec, rec, _ = precision_recall_curve(y, p)
    keep_roc = np.unique(np.linspace(0, len(fpr) - 1, min(len(fpr), 60)).astype(int))
    keep_pr = np.unique(np.linspace(0, len(prec) - 1, min(len(prec), 60)).astype(int))
    tn, fp, fn, tp = confusion_matrix(y, (p >= threshold).astype(int), labels=[0, 1]).ravel()
    return {
        "roc": {"fpr": np.round(fpr[keep_roc], 4).tolist(), "tpr": np.round(tpr[keep_roc], 4).tolist()},
        "pr": {"precision": np.round(prec[keep_pr], 4).tolist(), "recall": np.round(rec[keep_pr], 4).tolist()},
        "confusion_at_threshold": {"tn": int(tn), "fp": int(fp), "fn": int(fn), "tp": int(tp)},
    }
