"""Pick real dataset patients for the "Load demo patient" buttons.

    python -m src.demo_patients     # after training; writes artifacts/demo_patients.json

Selection uses the final models' predictions on the patients they were trained on.
That is fine for picking examples, but these are not held-out results.
"""
from __future__ import annotations

import json

import pandas as pd

from . import config, conformal, contract, data
from .inference import Predictor

DEMO_JSON = config.ARTIFACTS_DIR / "demo_patients.json"


def _record(row: pd.Series) -> dict:
    out = {}
    for name in data.feature_names():
        v = row[name]
        out[name] = v if isinstance(v, str) else (int(v) if float(v).is_integer() else float(v))
    return out


def select(df: pd.DataFrame, pred: Predictor) -> dict:
    X = df[data.feature_names()]
    p = pd.DataFrame({t: pred.proba(t, X)[0] for t in pred.targets})
    states = pd.DataFrame({
        t: [contract.state_from_set(conformal.conformal_set(v, pred.entries[t]["qhat"])) for v in p[t]]
        for t in pred.targets})
    overall, vessels = config.overall_target(), config.vessel_ids()

    chosen = {}
    chosen["low"] = int(p.max(axis=1).idxmin())

    likely = (states[vessels] == contract.LIKELY).sum(axis=1)
    high_pool = p[(states[overall] == contract.LIKELY) & (likely >= 2)]
    chosen["high"] = int((high_pool if len(high_pool) else p).mean(axis=1).idxmax())

    n_unc = (states[vessels] == contract.UNCERTAIN).sum(axis=1)
    mixed_pool = p[(states[overall] == contract.LIKELY) & (n_unc >= 1) & (likely >= 1)]
    if not len(mixed_pool):
        mixed_pool = p[n_unc >= 1]
    chosen["mixed"] = int(n_unc[mixed_pool.index].idxmax())

    gap = (p[overall] - p[vessels].max(axis=1)).abs()
    flagged = [i for i in p.index
               if contract.coherence(p.at[i, overall], {v: p.at[i, v] for v in vessels})["flag"]]
    chosen["discordant"] = int(flagged[0]) if flagged else int(gap.idxmax())

    out = {}
    for name, idx in chosen.items():
        out[name] = {
            "patient_id": f"demo-{name}",
            "dataset_row": idx,
            "description": {
                "low": "Lowest predicted risk across all four models.",
                "high": "Overall CAD and at least two vessels likely.",
                "mixed": "CAD likely, with at least one vessel in the Uncertain state.",
                "discordant": ("Overall and vessel models disagree (coherence flag)." if flagged else
                               "Largest gap between overall CAD and the most likely vessel "
                               "(no patient triggers the coherence flag with the current thresholds)."),
            }[name],
            "probs": {t: round(float(p.at[idx, t]), 4) for t in pred.targets},
            "features": _record(df.loc[idx]),
        }
    return {"version": pred.version, "note": "Real dataset patients (seen in training).", "patients": out}


def main() -> None:
    df = pd.read_csv(data.PROCESSED_CSV)
    res = select(df, Predictor())
    DEMO_JSON.write_text(json.dumps(res, indent=2) + "\n", encoding="utf-8")
    for k, v in res["patients"].items():
        print(f"{k:10s} row {v['dataset_row']:3d}  " + "  ".join(f"{t}={pp:.2f}" for t, pp in v["probs"].items()))


if __name__ == "__main__":
    main()
