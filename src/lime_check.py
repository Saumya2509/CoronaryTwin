"""LIME cross-check of the SHAP explanations (the brief asks for "SHAP/LIME"; md/improve.md P1.13).

    python -m src.lime_check      # ~2 min; writes artifacts/lime_check.json

For a fixed sample of patients and each of the four models, LIME (a local linear surrogate fitted
on perturbed copies of the patient) and SHAP (exact for the deployed model family) each rank the
51 measurements. We report how often they agree on the top drivers. Agreement means the
explanations shown in the app are not an artifact of one method. LIME explains the calibrated
probability; SHAP explains the base model's output; rankings are compared, not values.
"""
from __future__ import annotations

import json
import re

import numpy as np
import pandas as pd
from lime.lime_tabular import LimeTabularExplainer

from . import config, data, explain
from .inference import Predictor, to_frame

LIME_JSON = config.ARTIFACTS_DIR / "lime_check.json"
N_PATIENTS = 20
N_SAMPLES = 2000


def _encode(df: pd.DataFrame, cats: dict[str, list[str]]) -> np.ndarray:
    """Frame -> float matrix; categorical values become their index (LIME's convention)."""
    X = df[data.feature_names()].copy()
    for c, levels in cats.items():
        X[c] = X[c].map({v: i for i, v in enumerate(levels)}).astype(float)
    return X.astype(float).to_numpy()


def main() -> None:
    df = pd.read_csv(data.PROCESSED_CSV)
    names = data.feature_names()
    cats = {c: sorted(df[c].dropna().unique().tolist()) for c in data.columns_by_type("categorical")}
    cat_idx = [names.index(c) for c in cats]
    X = _encode(df, cats)

    pred = Predictor()
    expl = explain.Explainers(pred).by_target
    sample = df.sample(N_PATIENTS, random_state=config.seed())
    Xs = _encode(sample, cats)
    explainer = LimeTabularExplainer(
        X, feature_names=names, categorical_features=cat_idx,
        categorical_names={names.index(c): v for c, v in cats.items()},
        class_names=["No", "Yes"], discretize_continuous=True, random_state=config.seed(),
    )

    def decode(M: np.ndarray) -> pd.DataFrame:
        recs = []
        for row in M:
            r = {n: float(v) for n, v in zip(names, row)}
            for c, levels in cats.items():
                r[c] = levels[int(round(min(max(r[c], 0), len(levels) - 1)))]
            recs.append(r)
        return to_frame(recs)

    out = {"n_patients": N_PATIENTS, "lime_samples": N_SAMPLES, "targets": {}}
    for t in pred.targets:
        fn = lambda M, t=t: np.column_stack([1 - pred.proba(t, decode(M))[0], pred.proba(t, decode(M))[0]])  # noqa: E731
        top1, top3, top5 = [], [], []
        for i in range(len(sample)):
            row = sample.iloc[[i]][names]
            shap_rank = expl[t].shap_frame(to_frame(row.to_dict("records"))).iloc[0].abs().sort_values(ascending=False).index.tolist()
            le = explainer.explain_instance(Xs[i], fn, num_features=10, num_samples=N_SAMPLES)
            # LIME labels look like "age > 63.00" or "bbb=left": map back to the feature name.
            lime_rank = []
            for label, _ in le.as_list():
                name = next(n for n in sorted(names, key=len, reverse=True) if re.search(rf"(^|[\s<>=]){re.escape(n)}($|[\s<>=])", label))
                if name not in lime_rank:
                    lime_rank.append(name)
            top1.append(shap_rank[0] == lime_rank[0])
            top3.append(len(set(shap_rank[:3]) & set(lime_rank[:3])) / 3)
            top5.append(len(set(shap_rank[:5]) & set(lime_rank[:5])) / 5)
        out["targets"][t] = {"top1_agreement": round(float(np.mean(top1)), 3),
                             "top3_overlap": round(float(np.mean(top3)), 3),
                             "top5_overlap": round(float(np.mean(top5)), 3)}
        print(f"{t}: top-1 agree {np.mean(top1):.0%}, top-3 overlap {np.mean(top3):.0%}, top-5 overlap {np.mean(top5):.0%}")

    LIME_JSON.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    _update_report(out)


def lime_section(res: dict) -> str:
    rows = "\n".join(f"| {t} | {r['top1_agreement']:.0%} | {r['top3_overlap']:.0%} | {r['top5_overlap']:.0%} |"
                     for t, r in res["targets"].items())
    return f"""## LIME cross-check

LIME (local linear surrogate, {res['lime_samples']} perturbations per patient) was run on {res['n_patients']} patients per model
and compared with SHAP's ranking of the 51 measurements (`python -m src.lime_check`).

| Model | Same top driver | Top-3 overlap | Top-5 overlap |
|---|---|---|---|
{rows}

Chance level for a top-3 overlap is about 6% (3 of 51 measurements). LIME discretizes numeric values and explains the
calibrated probability, so exact agreement is not expected; strong overlap means the drivers shown in the app are not
an artifact of one explanation method."""


def _update_report(res: dict) -> None:
    path = explain.REPORT_MD
    if not path.exists():
        return
    text = path.read_text(encoding="utf-8")
    section = lime_section(res)
    text = re.sub(r"## LIME[^\n]*\n.*?(?=\n## |\Z)", section + "\n", text, flags=re.S)
    path.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
