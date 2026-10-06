"""The leakage guard: banned columns must never reach a model's fit()."""
import pandas as pd
import pytest

from src import config, data, leakage_guard
from src.leakage_guard import LeakageError, make_xy


@pytest.fixture(scope="module")
def df():
    if not data.PROCESSED_CSV.exists():
        pytest.skip("run `python -m src.data` first")
    return pd.read_csv(data.PROCESSED_CSV)


def test_registry_has_no_banned_inputs():
    leakage_guard.assert_registry_clean()


def test_banned_covers_raw_and_derived_targets():
    banned = leakage_guard.banned_columns()
    assert {"LAD", "LCX", "RCA", "Cath", "CAD"} <= banned


@pytest.mark.parametrize("target", ["CAD", "LAD", "LCX", "RCA"])
def test_make_xy_excludes_every_target(df, target):
    X, y = make_xy(df, target)
    assert not leakage_guard.banned_columns() & set(X.columns)
    assert list(X.columns) == data.feature_names()
    assert set(y.unique()) <= {0, 1}


def test_extra_raw_label_columns_are_ignored(df):
    # Even if a raw label column sneaks into the frame, the whitelist drops it.
    dirty = df.assign(Cath=df["CAD"], LAD_copy=df["LAD"])
    X, _ = make_xy(dirty, "CAD")
    assert "Cath" not in X.columns and "LAD_copy" not in X.columns


def test_banned_feature_in_registry_is_rejected(monkeypatch):
    poisoned = data.features() + [{"name": "cath_leak", "source": "Cath", "type": "binary",
                                   "group": "History"}]
    monkeypatch.setattr(data, "features", lambda: poisoned)
    with pytest.raises(LeakageError):
        leakage_guard.assert_registry_clean()


def test_assert_no_leakage_raises():
    with pytest.raises(LeakageError):
        leakage_guard.assert_no_leakage(["age", "RCA"])


def test_unknown_target_rejected(df):
    with pytest.raises(ValueError):
        make_xy(df, "LM")


def test_manifest_matches_registry_order():
    import json
    if not config.MANIFEST_JSON.exists():
        pytest.skip("run `python -m src.data` first")
    man = json.loads(config.MANIFEST_JSON.read_text(encoding="utf-8"))
    assert man["feature_order"] == data.feature_names()
    assert not leakage_guard.banned_columns() & set(man["feature_order"])
