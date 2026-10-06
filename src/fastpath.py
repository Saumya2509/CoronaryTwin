"""Serving speed-up: compile fitted ColumnTransformers into plain numpy.

Each calibrated model holds 5 fold pipelines, so a request runs preprocessing 20
times. sklearn's ColumnTransformer costs ~10-30 ms per call on a single row (pandas
column selection, validation), while the arithmetic itself is microseconds.

`accelerate()` swaps each pipeline's "pre" step for a numpy equivalent, but only after
verifying on reference rows that predictions are unchanged. Any mismatch keeps the
original sklearn step, so the speed-up can never change a result.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler


class _Unsupported(Exception):
    pass


class FastColumnTransformer:
    """numpy re-implementation of one fitted ColumnTransformer (transform only)."""

    def __init__(self, ct):
        self._names_out = ct.get_feature_names_out()
        self.blocks = []
        for name, trans, cols in ct.transformers_:
            if name == "remainder" or trans == "drop" or len(cols) == 0:
                continue
            steps = trans.steps if isinstance(trans, Pipeline) else [("only", trans)]
            ops = []
            for _, step in steps:
                if isinstance(step, SimpleImputer):
                    ops.append(("impute", step.statistics_))
                elif isinstance(step, StandardScaler):
                    ops.append(("scale", (step.mean_ if step.with_mean else 0.0,
                                          step.scale_ if step.with_std else 1.0)))
                elif isinstance(step, OneHotEncoder):
                    if step.drop is not None or getattr(step, "_infrequent_enabled", False):
                        raise _Unsupported("one-hot drop / infrequent categories")
                    ops.append(("onehot", step.categories_))
                else:
                    raise _Unsupported(type(step).__name__)
            self.blocks.append((list(cols), ops))

    def get_feature_names_out(self, *_):
        return self._names_out

    def transform(self, X: pd.DataFrame) -> np.ndarray:
        out = []
        for cols, ops in self.blocks:
            numeric = not any(op == "onehot" for op, _ in ops)
            a = X[cols].to_numpy(dtype=float if numeric else object)
            for op, p in ops:
                if op == "impute":
                    if numeric:
                        a = np.where(np.isnan(a), p, a)
                    else:
                        miss = pd.isna(a)
                        a = np.where(miss, np.broadcast_to(p, a.shape), a)
                elif op == "scale":
                    a = (a - p[0]) / p[1]
                elif op == "onehot":
                    a = np.hstack([(a[:, [j]] == np.asarray(cats, dtype=object)[None, :]).astype(float)
                                   for j, cats in enumerate(p)])
            out.append(np.asarray(a, dtype=float))
        return np.hstack(out)


def _pipelines(bundle: dict):
    yield bundle["base"]
    for c in bundle["calibrated"].calibrated_classifiers_:
        yield c.estimator


def accelerate(bundle: dict, reference: pd.DataFrame, atol: float = 1e-10) -> int:
    """Patch every pipeline in a model bundle in place. Returns how many were patched."""
    patched = 0
    for pipe in _pipelines(bundle):
        original = pipe.steps[0]
        if original[0] != "pre":
            continue
        try:
            fast = FastColumnTransformer(original[1])
        except _Unsupported:
            continue
        expected = pipe.predict_proba(reference)
        pipe.steps[0] = ("pre", fast)
        try:
            ok = np.allclose(pipe.predict_proba(reference), expected, atol=atol, rtol=0)
        except Exception:
            ok = False
        if ok:
            patched += 1
        else:
            pipe.steps[0] = original
    return patched
