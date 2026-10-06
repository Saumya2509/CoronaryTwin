"""Feature registry and cleaning (module 01)."""
import numpy as np
import pandas as pd
import pytest
from sklearn.base import clone

from src import config, data


@pytest.fixture(scope="module")
def raw():
    if not data.raw_path().exists():
        pytest.skip("raw dataset not downloaded; run `python -m src.data`")
    return data.load_raw(data.raw_path())


@pytest.fixture(scope="module")
def df(raw):
    return data.clean(raw)


def test_every_raw_column_is_accounted_for(raw):
    reg = data.registry()
    used = {f["source"] for f in reg["features"]}
    targets = {t["source"] for t in reg["targets"]}
    excluded = {e["source"] for e in reg["excluded"]}
    cols = {c.strip() for c in raw.columns}
    assert cols == used | targets | excluded, "new or renamed raw column: update features.yaml"
    assert not used & excluded


def test_clean_output_is_numeric_and_complete(df):
    assert list(df.columns) == data.feature_names() + data.target_names()
    non_cat = [f["name"] for f in data.features() if f["type"] != "categorical"]
    assert all(pd.api.types.is_numeric_dtype(df[c]) for c in non_cat)
    assert not df.isna().any().any()


def test_binary_features_are_0_1(df):
    for c in data.columns_by_type("binary"):
        assert set(df[c].unique()) <= {0, 1}, c


def test_target_positive_rates(df):
    rates = df[data.target_names()].mean()
    assert rates["CAD"] == pytest.approx(216 / 303)
    assert all(0.2 < r < 0.8 for r in rates)


def test_valid_ranges_accept_all_training_data(df):
    for f in data.features():
        if "valid_range" in f and f["type"] != "categorical":
            lo, hi = f["valid_range"]
            assert df[f["name"]].between(lo, hi).all(), f["name"]


def test_registry_fields_well_formed():
    for f in data.features():
        assert f.get("label") and f.get("patient_text"), f["name"]
        if f["type"] in ("numeric", "ordinal"):
            assert "valid_range" in f and "step" in f, f["name"]
        if f.get("modifiable"):
            assert f["type"] in ("numeric", "binary"), f["name"]
        nr = f.get("normal_range")
        if nr:
            lo, hi = nr
            assert lo is None or hi is None or lo < hi, f["name"]


def test_every_group_is_used():
    used = {f["group"] for f in data.features()}
    assert used == set(config.feature_groups())


def test_preprocessor_is_unfitted_and_maps_back(df):
    pre = data.build_preprocessor()
    assert not hasattr(pre, "transformers_"), "preprocessor must be fitted inside CV"
    Xt = clone(pre).fit(df[data.feature_names()]).transform(df[data.feature_names()])
    fitted = clone(pre).fit(df[data.feature_names()])
    names = list(fitted.get_feature_names_out())
    assert Xt.shape == (len(df), len(names))
    assert np.isfinite(Xt).all()
    mapping = data.transformed_to_feature(names)
    assert set(mapping.values()) == set(data.feature_names())


def test_apply_encodings_matches_clean(raw, df):
    row = raw.iloc[0]
    record = {f["name"]: row[f["source"]] for f in data.features()}
    encoded = data.apply_encodings(record)
    for name in data.feature_names():
        assert encoded[name] == df.iloc[0][name], name
