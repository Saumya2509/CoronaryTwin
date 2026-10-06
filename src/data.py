"""Load, clean and encode the Extension of Z-Alizadeh Sani dataset (module 01).

Everything is driven by features.yaml: which raw columns are used, what they are
called, how they are encoded and which preprocessing branch they go through.

    python -m src.data     # download if needed, write data/processed/ and the manifest
"""
from __future__ import annotations

import hashlib
import io
import json
import urllib.request
import zipfile
from functools import lru_cache
from pathlib import Path
from typing import Any

import pandas as pd
import yaml
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from . import config

PROCESSED_CSV = config.PROCESSED_DIR / "coronary.csv"
SCALED_TYPES = ("numeric", "ordinal")


# ---------------------------------------------------------------- registry

@lru_cache(maxsize=1)
def registry() -> dict[str, Any]:
    with open(config.FEATURES_YAML, encoding="utf-8") as f:
        reg = yaml.safe_load(f)
    _validate_registry(reg)
    return reg


def _validate_registry(reg: dict) -> None:
    groups = set(config.feature_groups())
    names = [f["name"] for f in reg["features"]]
    if len(names) != len(set(names)):
        raise ValueError("duplicate feature names in features.yaml")
    for f in reg["features"]:
        if f["group"] not in groups:
            raise ValueError(f"{f['name']}: group {f['group']!r} not in settings feature_groups")
        if f["type"] not in {"numeric", "binary", "ordinal", "categorical"}:
            raise ValueError(f"{f['name']}: unknown type {f['type']!r}")


def features() -> list[dict]:
    return registry()["features"]


def feature_names() -> list[str]:
    """Model input order. Serving must use the same order (see the manifest)."""
    return [f["name"] for f in features()]


def columns_by_type(*types: str) -> list[str]:
    return [f["name"] for f in features() if f["type"] in types]


def target_names() -> list[str]:
    return [t["name"] for t in registry()["targets"]]


# ---------------------------------------------------------------- raw data

def raw_path() -> Path:
    return config.RAW_DIR / registry()["dataset"]["file"]


def download(force: bool = False) -> Path:
    """Fetch the UCI archive into data/raw/ unless it is already there."""
    path = raw_path()
    if path.exists() and not force:
        return path
    config.RAW_DIR.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(registry()["dataset"]["url"], timeout=60) as r:
        zipfile.ZipFile(io.BytesIO(r.read())).extractall(config.RAW_DIR)
    return path


def load_raw(path: Path | None = None) -> pd.DataFrame:
    return pd.read_excel(path or download())


def file_sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


# ---------------------------------------------------------------- cleaning

def _encode(series: pd.Series, spec: dict) -> pd.Series:
    enc = spec.get("encoding")
    if enc is None:
        return pd.to_numeric(series, errors="raise")
    s = series.astype(str).str.strip()
    unknown = set(s.dropna().unique()) - {str(k) for k in enc}
    if unknown:
        raise ValueError(f"{spec['source']}: values {sorted(unknown)} missing from encoding")
    return s.map({str(k): v for k, v in enc.items()})


def clean(raw: pd.DataFrame) -> pd.DataFrame:
    """Raw UCI frame -> canonical frame: one column per registry feature, plus targets."""
    raw = raw.rename(columns=lambda c: str(c).strip())
    needed = [f["source"] for f in features()] + [t["source"] for t in registry()["targets"]]
    missing = [c for c in needed if c not in raw.columns]
    if missing:
        raise KeyError(f"raw data is missing columns: {missing}")

    out = pd.DataFrame(index=raw.index)
    for f in features():
        out[f["name"]] = _encode(raw[f["source"]], f)
    for t in registry()["targets"]:
        out[t["name"]] = (raw[t["source"]].astype(str).str.strip() == t["positive"]).astype(int)
    return out


def apply_encodings(record: dict[str, Any]) -> dict[str, Any]:
    """Encode one raw-valued record (keys = canonical names) the same way as clean()."""
    out = {}
    for f in features():
        v = record.get(f["name"])
        enc = f.get("encoding")
        out[f["name"]] = enc.get(v, v) if enc and v is not None else v
    return out


# ---------------------------------------------------------------- preprocessing

def build_preprocessor() -> ColumnTransformer:
    """Unfitted transformer. It must be fitted inside CV folds, never on the full data."""
    scaled = columns_by_type(*SCALED_TYPES)
    binary = columns_by_type("binary")
    categorical = columns_by_type("categorical")
    return ColumnTransformer(
        [
            ("num", Pipeline([("imp", SimpleImputer(strategy="median")),
                              ("sc", StandardScaler())]), scaled),
            ("bin", SimpleImputer(strategy="most_frequent"), binary),
            ("cat", Pipeline([("imp", SimpleImputer(strategy="most_frequent")),
                              ("oh", OneHotEncoder(handle_unknown="ignore"))]), categorical),
        ],
        verbose_feature_names_out=False,
    )


def transformed_to_feature(transformed_names: list[str]) -> dict[str, str]:
    """Map post-encoding column names (e.g. bbb_left) back to registry features, so
    SHAP values of one-hot dummies can be summed per original feature (module 03)."""
    cats = columns_by_type("categorical")
    mapping = {}
    for col in transformed_names:
        if col in feature_names():
            mapping[col] = col
            continue
        owner = next((c for c in cats if col.startswith(c + "_")), None)
        if owner is None:
            raise KeyError(f"cannot map transformed column {col!r} to a feature")
        mapping[col] = owner
    return mapping


# ---------------------------------------------------------------- artifacts

def manifest(df: pd.DataFrame, source_file: Path) -> dict:
    return {
        "feature_order": feature_names(),
        "features": {f["name"]: {"source": f["source"], "type": f["type"], "group": f["group"]}
                     for f in features()},
        "targets": target_names(),
        "n_rows": int(len(df)),
        "positive_rate": {t: round(float(df[t].mean()), 4) for t in target_names()},
        "source_file": source_file.name,
        "source_sha256": file_sha256(source_file),
    }


def main() -> None:
    src = download()
    df = clean(load_raw(src))

    config.PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    df.to_csv(PROCESSED_CSV, index=False)

    config.ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    man = manifest(df, src)
    config.MANIFEST_JSON.write_text(json.dumps(man, indent=2) + "\n", encoding="utf-8")

    print(f"rows={man['n_rows']}  features={len(man['feature_order'])}  -> {PROCESSED_CSV}")
    for t, r in man["positive_rate"].items():
        print(f"  {t}: {r:.1%} positive")


if __name__ == "__main__":
    main()
