"""Case base: similar patients, out-of-distribution checks, plausible values (specialities A2, A3, S3).

    python -m src.casebase     # after explain; writes artifacts/casebase.joblib

Everything here works in one weighted distance space built from the training data:
  numeric / ordinal  z-score (median-centered, clipped at +-4 SD)
  binary             0 / 1
  categorical        0 if equal, 1 if different
Each feature is weighted by its share of mean |SHAP| averaged over the four models, plus a
small floor so every measurement counts a little. Missing query values are skipped, so a
half-filled form still finds neighbors on the fields it has.

The artifact holds the 303 training rows because the API container does not ship data/.
Responses only ever contain coarse, de-identified summaries (age band, sex, a few findings,
outcomes), never raw rows or row numbers.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache

import joblib
import numpy as np
import pandas as pd
from sklearn.covariance import LedoitWolf

from . import config, data, explain

CASEBASE = config.ARTIFACTS_DIR / "casebase.joblib"
WEIGHT_FLOOR = 0.15          # share of the total weight spread evenly over all features
Z_CLIP = 4.0
OOD_PERCENTILE = 99.0        # Mahalanobis distance above this training percentile = unusual combination

# Findings worth naming in a coarse case summary, in display order.
SUMMARY_FLAGS = ["typical_chest_pain", "diabetes", "hypertension", "current_smoker", "dyslipidemia",
                 "family_history", "q_wave", "st_elevation", "st_depression", "t_inversion"]


def _encode(df: pd.DataFrame, med: pd.Series, std: pd.Series) -> np.ndarray:
    """Rows -> numeric matrix in feature order; NaN where a value is missing.
    Categorical columns hold integer codes into the category list (compared by equality)."""
    out = np.full((len(df), len(data.feature_names())), np.nan)
    cats = set(data.columns_by_type("categorical"))
    binary = set(data.columns_by_type("binary"))
    for j, name in enumerate(data.feature_names()):
        col = df[name]
        if name in cats:
            levels = _levels()[name]
            out[:, j] = [levels.index(v) if v in levels else (np.nan if v is None or pd.isna(v) else -1)
                         for v in col]
        elif name in binary:
            out[:, j] = pd.to_numeric(col, errors="coerce")
        else:
            z = (pd.to_numeric(col, errors="coerce") - med[name]) / max(std[name], 1e-9)
            out[:, j] = np.clip(z, -Z_CLIP, Z_CLIP)
    return out


@lru_cache(maxsize=1)
def _levels() -> dict[str, list[str]]:
    return {f["name"]: list(dict.fromkeys(f["encoding"].values()))
            for f in data.features() if f["type"] == "categorical"}


def _shap_weights() -> np.ndarray:
    names = data.feature_names()
    glob = json.loads(explain.GLOBAL_JSON.read_text(encoding="utf-8"))["targets"]
    share = np.zeros(len(names))
    for g in glob.values():
        imp = np.array([g["features"].get(n, 0.0) for n in names])
        share += imp / max(imp.sum(), 1e-12)
    share /= len(glob)
    return (1 - WEIGHT_FLOOR) * share + WEIGHT_FLOOR / len(names)


def build(df: pd.DataFrame) -> dict:
    names = data.feature_names()
    X = df[names]
    scaled = data.columns_by_type("numeric", "ordinal")
    med = X[scaled].astype(float).median()
    std = X[scaled].astype(float).std().replace(0, 1.0)
    M = _encode(X, med, std)
    cat_idx = [names.index(c) for c in data.columns_by_type("categorical")]

    # Shrunk covariance: 303 rows and ~50 correlated (often binary) columns.
    dense = _dense(M, cat_idx)
    cov = LedoitWolf().fit(dense)
    train_dist = cov.mahalanobis(dense)

    numeric = data.columns_by_type("numeric", "ordinal")
    return {
        "version": json.loads(config.REGISTRY_JSON.read_text(encoding="utf-8"))["version"],
        "names": names,
        "median": med.to_dict(), "std": std.to_dict(),
        "weights": _shap_weights(),
        "matrix": M,
        "categorical_idx": cat_idx,
        "raw": X.reset_index(drop=True),
        "outcomes": df[data.target_names()].astype(int).reset_index(drop=True),
        "cov": cov,
        "train_dist": np.sort(train_dist),
        "ood_cut": float(np.percentile(train_dist, OOD_PERCENTILE)),
        "ranges": {n: (float(X[n].min()), float(X[n].max())) for n in numeric},
    }


def _dense(M: np.ndarray, cat_idx: list[int]) -> np.ndarray:
    """Matrix for the Mahalanobis check: missing -> 0 (the median / most common after encoding),
    categorical code -> one-hot."""
    keep = [j for j in range(M.shape[1]) if j not in cat_idx]
    parts = [np.nan_to_num(M[:, keep], nan=0.0)]
    names = data.feature_names()
    for j in cat_idx:
        n_levels = len(_levels()[names[j]])
        codes = np.nan_to_num(M[:, j], nan=0.0).astype(int)       # unknown level (-1) -> all zeros
        parts.append(np.vstack([np.eye(n_levels), np.zeros(n_levels)])[np.where(codes < 0, n_levels, codes)])
    return np.hstack(parts)


@dataclass
class CaseBase:
    art: dict

    @property
    def names(self) -> list[str]:
        return self.art["names"]

    def encode(self, record: dict) -> np.ndarray:
        rec = data.apply_encodings(record)
        df = pd.DataFrame([{n: rec.get(n) for n in self.names}])
        return _encode(df, pd.Series(self.art["median"]), pd.Series(self.art["std"]))[0]

    def distances(self, record: dict) -> np.ndarray:
        """Weighted RMS distance from the query to every training patient, over the
        query's known fields only."""
        q = self.encode(record)
        M, w = self.art["matrix"], self.art["weights"]
        known = ~np.isnan(q)
        if not known.any():
            return np.zeros(len(M))
        diff = M[:, known] - q[known]
        cat = np.isin(np.flatnonzero(known), self.art["categorical_idx"])
        diff[:, cat] = (diff[:, cat] != 0).astype(float)
        wk = w[known]
        return np.sqrt((diff ** 2 * wk).sum(axis=1) / wk.sum())

    def neighbors(self, record: dict, k: int) -> np.ndarray:
        return np.argsort(self.distances(record), kind="stable")[:k]

    # ------------------------------------------------------------ A2 similar patients

    def similar(self, record: dict, k: int = 5) -> dict:
        d = self.distances(record)
        idx = np.argsort(d, kind="stable")[:k]
        known = sum(record.get(n) is not None for n in self.names)
        cases = [{"rank": r + 1, "distance": round(float(d[i]), 3), "summary": self._summary(i),
                  "outcomes": {t: int(self.art["outcomes"].at[i, t]) for t in config.all_targets()}}
                 for r, i in enumerate(idx)]
        rates = {t: round(float(np.mean([c["outcomes"][t] for c in cases])), 3) for t in config.all_targets()}
        return {"k": k, "matched_on": known, "cases": cases, "outcome_rates": rates,
                "caption": "Similar historical cases from the training data, not a diagnosis."}

    def _summary(self, i: int) -> str:
        row = self.art["raw"].iloc[i]
        lo = int(row["age"] // 5 * 5)
        sex = "man" if row["sex_male"] == 1 else "woman"
        spec = {f["name"]: f for f in data.features()}
        found = [spec[n]["label"].lower() for n in SUMMARY_FLAGS if row.get(n) == 1][:4]
        ef = row.get("ef_tte")
        if ef is not None and not pd.isna(ef) and ef < 50:
            found.append("reduced ejection fraction")
        tail = ", ".join(found) if found else "no major risk findings recorded"
        return f"{lo}-{lo + 4}-year-old {sex}; {tail}"

    # ------------------------------------------------------------ A3 out-of-distribution

    def ood(self, record: dict) -> dict:
        """Range check against the training min/max, plus a Mahalanobis distance (shrunk
        covariance) for unusual combinations of otherwise ordinary values. Missing values are
        set to the training median / most common value, so blanks never look unusual."""
        spec = {f["name"]: f for f in data.features()}
        out_of_range = []
        rec = data.apply_encodings(record)
        for name, (lo, hi) in self.art["ranges"].items():
            v = rec.get(name)
            if v is None or isinstance(v, str):
                continue
            unit = spec[name].get("unit", "")
            unit = f" {unit}" if unit else ""
            if v < lo:
                out_of_range.append(f"{spec[name]['label']} {v:g}{unit} is below every training patient (min {lo:g}).")
            elif v > hi:
                out_of_range.append(f"{spec[name]['label']} {v:g}{unit} is above every training patient (max {hi:g}).")
        q = self.encode(record)[None, :]
        dist = float(self.art["cov"].mahalanobis(_dense(q, self.art["categorical_idx"]))[0])
        train = self.art["train_dist"]
        # typicality: share of training patients that look at least as unusual as this one
        pct = float(1 - np.searchsorted(train, dist) / len(train))
        unusual = dist > self.art["ood_cut"]
        reasons = out_of_range + (["This combination of values is more unusual than in 99% of training "
                                   "patients."] if unusual else [])
        return {"flag": bool(reasons), "out_of_range": out_of_range, "unusual_combination": bool(unusual),
                "typicality": round(pct, 3), "reasons": reasons}


@lru_cache(maxsize=1)
def load() -> CaseBase | None:
    return CaseBase(joblib.load(CASEBASE)) if CASEBASE.exists() else None


def main() -> None:
    df = pd.read_csv(data.PROCESSED_CSV)
    art = build(df)
    joblib.dump(art, CASEBASE, compress=3)
    cb = CaseBase(art)
    flagged = sum(cb.ood(r)["flag"] for r in df[data.feature_names()].to_dict("records"))
    print(f"casebase: {len(df)} patients -> {CASEBASE.relative_to(config.ROOT)} "
          f"({flagged} training patients flagged by the OOD check)")


if __name__ == "__main__":
    main()
