"""Leakage guard: target columns can never reach a model's fit().

Two independent checks:
  1. Whitelist: X is built only from registry features, in manifest order.
  2. Blacklist: X must contain no banned column, whether a raw source name from
     settings.yaml (LAD, LCX, RCA, Cath) or a derived target name (CAD, ...), and
     no registry feature may be sourced from a banned column.
"""
from __future__ import annotations

import pandas as pd

from . import config, data


class LeakageError(RuntimeError):
    pass


def banned_columns() -> set[str]:
    return set(config.settings()["banned_inputs"]) | set(data.target_names())


def assert_no_leakage(columns) -> None:
    leaked = banned_columns().intersection(columns)
    if leaked:
        raise LeakageError(f"Leakage columns in features: {sorted(leaked)}")


def assert_registry_clean() -> None:
    banned = banned_columns()
    bad = [f["name"] for f in data.features() if f["source"] in banned or f["name"] in banned]
    if bad:
        raise LeakageError(f"features.yaml uses banned columns as inputs: {bad}")


def make_xy(df: pd.DataFrame, target: str) -> tuple[pd.DataFrame, pd.Series]:
    if target not in data.target_names():
        raise ValueError(f"Unknown target {target!r}; expected one of {data.target_names()}")
    assert_registry_clean()
    X = df[data.feature_names()].copy()
    assert_no_leakage(X.columns)
    y = df[target].astype(int)
    return X, y
