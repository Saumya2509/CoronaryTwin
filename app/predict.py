"""Prediction flow behind /predict, /whatif, /counterfactual and /predict/batch.

1. validate input (pydantic, generated from features.yaml)
2. order columns by the feature manifest (src.inference.to_frame)
3. per target: calibrated probability, conformal set, uncertainty
4. coherence flag
5. SHAP per target and per group
6. out-of-distribution check (when the case base artifact is present)
7. guideline pre-test probability scores for comparison (src/baselines.py)
8. attach version and disclaimer
"""
from __future__ import annotations

import io
from typing import Any

import numpy as np
import pandas as pd
from fastapi import HTTPException

from src import baselines, config, conformal, contract, data, explain, nextbest
from src.inference import to_frame

from .registry import ServingState
from .schemas import PatientInput

MAX_BATCH_ROWS = 500


def resolve(st: ServingState, demo: str | None, features: Any) -> tuple[dict, str | None]:
    """Request -> (record keyed by feature name, default patient id)."""
    if demo is not None:
        if demo not in st.demos:
            raise HTTPException(404, f"Unknown demo '{demo}'. Options: {sorted(st.demos)}")
        d = st.demos[demo]
        return dict(d["features"]), d["patient_id"]
    if features is None:
        raise HTTPException(422, "Provide either `features` or `demo`.")
    return features.model_dump(), None


def imputed(record: dict) -> list[str]:
    return [n for n in data.feature_names() if record.get(n) is None]


def _target_result(st: ServingState, target: str, folds: np.ndarray) -> dict:
    """One row's sub-model probabilities -> probability, uncertainty, conformal set, state, range."""
    p, spread = float(folds.mean()), float(folds.std())
    u = float(conformal.uncertainty_score([p], [spread])[0])
    s = conformal.conformal_set(p, st.predictor.entries[target]["qhat"])
    return {"prob": round(p, 4), "uncertainty": round(u, 4), "set": s,
            "state": contract.state_from_set(s), "threshold": st.threshold(target),
            "range": [round(float(folds.min()), 4), round(float(folds.max()), 4)]}


def summarize_rows(st: ServingState, X: pd.DataFrame) -> list[dict]:
    """Probabilities, sets and coherence for every row of X (no SHAP)."""
    overall, vessels = config.overall_target(), config.vessel_ids()
    folds = {t: st.predictor.proba_folds(t, X) for t in st.predictor.targets}
    rows = []
    for i in range(len(X)):
        res = {t: _target_result(st, t, f[i]) for t, f in folds.items()}
        ov = res[overall]
        rows.append({
            "overall": {**ov, "label": contract.overall_label(ov["set"])},
            "vessels": {v: res[v] for v in vessels},
            "coherence": contract.coherence(ov["prob"], {v: res[v]["prob"] for v in vessels}),
        })
    return rows


def predict(st: ServingState, record: dict, patient_id: str | None) -> dict:
    X = to_frame(record)
    out = summarize_rows(st, X)[0]
    return {
        "patient_id": patient_id or "patient",
        **out,
        "explanations": st.explainers.explain(X),
        "imputed": imputed(record),
        "ood": st.cases.ood(record) if st.cases else None,
        "guideline": baselines.patient_scores(record),
        "model_version": st.version,
        "disclaimer": config.disclaimer(),
    }


def _cases_or_503(st: ServingState):
    if st.cases is None:
        raise HTTPException(503, "Case base not available. Run `python -m src.casebase`.")
    return st.cases


def next_best_test(st: ServingState, record: dict, target: str | None) -> dict:
    if target is not None and target not in st.predictor.targets:
        raise HTTPException(422, f"Unknown target '{target}'. Options: {st.predictor.targets}")
    res = nextbest.next_best(st.predictor, _cases_or_503(st), record, target)
    return {**res, "disclaimer": config.disclaimer()}


def similar(st: ServingState, record: dict, k: int) -> dict:
    return {**_cases_or_503(st).similar(record, k), "disclaimer": config.disclaimer()}


def whatif(st: ServingState, record: dict, overrides: dict, patient_id: str | None) -> dict:
    allowed = set(explain.modifiable_features())
    bad = sorted(set(overrides) - allowed)
    if bad:
        raise HTTPException(422, f"Not modifiable: {bad}. Modifiable features: {sorted(allowed)}")
    new = dict(record)
    for k, v in overrides.items():
        new[k] = v
    try:
        PatientInput.model_validate(new)      # overrides obey the same ranges as inputs
    except Exception as e:  # pydantic.ValidationError
        raise HTTPException(422, f"Override out of range: {e}") from None
    base = predict(st, record, patient_id)
    after = predict(st, new, patient_id)
    deltas = {config.overall_target(): round(after["overall"]["prob"] - base["overall"]["prob"], 4)}
    deltas.update({v: round(after["vessels"][v]["prob"] - base["vessels"][v]["prob"], 4)
                   for v in config.vessel_ids()})
    return {"base": base, "whatif": after, "deltas": deltas, "caption": explain.CAPTION}


def counterfactual(st: ServingState, record: dict, target: str) -> dict:
    if target not in st.predictor.targets:
        raise HTTPException(422, f"Unknown target '{target}'. Options: {st.predictor.targets}")
    res = explain.counterfactual(st.predictor.proba_fn(target), to_frame(record),
                                 st.threshold(target), st.stats)
    return {"target": target, **res, "disclaimer": config.disclaimer()}


def batch(st: ServingState, content: bytes) -> dict:
    """CSV with one patient per row. Columns: canonical feature names (see GET /features)
    and an optional patient_id. Invalid rows are reported in `errors`, not dropped silently."""
    try:
        df = pd.read_csv(io.BytesIO(content))
    except Exception as e:
        raise HTTPException(422, f"Could not parse CSV: {e}") from None
    if len(df) > MAX_BATCH_ROWS:
        raise HTTPException(413, f"At most {MAX_BATCH_ROWS} rows per batch.")
    unknown = sorted(set(df.columns) - set(data.feature_names()) - {"patient_id"})
    if unknown:
        raise HTTPException(422, f"Unknown columns: {unknown}")

    records, ids, errors = [], [], []
    for i, row in df.iterrows():
        raw = {k: (None if pd.isna(v) else v) for k, v in row.items() if k != "patient_id"}
        raw = data.apply_encodings(raw)
        raw = {k: (int(v) if isinstance(v, float) and v.is_integer() and k in data.columns_by_type("binary")
                   else v) for k, v in raw.items()}
        try:
            rec = PatientInput.model_validate(raw).model_dump()
        except Exception as e:
            errors.append({"row": int(i), "error": str(e).splitlines()[0:3]})
            continue
        records.append(rec)
        pid = row.get("patient_id")
        ids.append(str(pid) if pid is not None and not pd.isna(pid) else f"row-{i}")

    rows = []
    if records:
        X = to_frame(records)
        for pid, rec, summary in zip(ids, records, summarize_rows(st, X)):
            ood = st.cases.ood(rec)["flag"] if st.cases else None
            rows.append({"patient_id": pid, **summary, "imputed": imputed(rec), "ood": ood})
    return {"rows": rows, "errors": errors, "summary": cohort_summary(rows) if rows else None,
            "model_version": st.version, "disclaimer": config.disclaimer()}


def cohort_summary(rows: list[dict]) -> dict:
    """Mean probability and state counts per target over a cohort (the "population heart")."""
    targets = {}
    for t in config.all_targets():
        res = [r["overall"] if t == config.overall_target() else r["vessels"][t] for r in rows]
        states = [r["state"] for r in res]
        targets[t] = {"mean_prob": round(sum(r["prob"] for r in res) / len(res), 4),
                      "likely": states.count(contract.LIKELY), "uncertain": states.count(contract.UNCERTAIN),
                      "unlikely": states.count(contract.UNLIKELY)}
    return {"n": len(rows), "targets": targets,
            "coherence_flags": sum(r["coherence"]["flag"] for r in rows),
            "ood_flags": sum(bool(r.get("ood")) for r in rows)}
