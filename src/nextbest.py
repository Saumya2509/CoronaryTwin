"""Next best test: which missing measurement would most reduce the model's uncertainty (speciality S3).

For a partially filled record, every missing measurement (and every missing test, i.e. a
feature group such as Echo or ECG that is entirely blank) is filled with plausible values:
the values seen in the training patients most similar to this one on the fields that ARE
known (src.casebase). All other missing fields stay imputed. The models are re-run on each
filled copy and we measure, per target:

  spread      std of the calibrated probability across the plausible values
              = how far the estimate could still move once this value is known
  p_definite  share of plausible values for which the conformal set is a single label
              (Likely or Unlikely instead of Uncertain)

Ranking is by spread averaged over the four targets (or for one target, if asked).
This ranks by MODEL uncertainty, not clinical necessity.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import config, conformal, contract, data
from .casebase import CaseBase
from .inference import Predictor, to_frame

NEIGHBORS = 25
CAPTION = ("Ranked by how much each measurement could change the model's estimate, "
           "not by clinical necessity.")


def _state(p: float, qhat: float) -> str:
    return contract.state_from_set(conformal.conformal_set(p, qhat))


def next_best(predictor: Predictor, cb: CaseBase, record: dict, target: str | None = None,
              top: int = 6) -> dict:
    names = data.feature_names()
    rec = {n: record.get(n) for n in names}
    missing = [n for n in names if rec[n] is None]
    targets = predictor.targets
    if target is not None and target not in targets:
        raise ValueError(f"unknown target {target!r}")
    out = {"target": target, "n_missing": len(missing), "tests": [], "features": [], "caption": CAPTION}
    if not missing:
        return out

    base = to_frame(rec)
    p0 = {t: float(predictor.proba(t, base)[0][0]) for t in targets}
    out["current"] = {t: {"prob": round(p, 4), "state": _state(p, predictor.entries[t]["qhat"])}
                      for t, p in p0.items()}

    nb = cb.neighbors(rec, NEIGHBORS)
    pool = cb.art["raw"].iloc[nb][names].reset_index(drop=True)

    spec = {f["name"]: f for f in data.features()}
    candidates: list[tuple[str, str, list[str]]] = [("feature", n, [n]) for n in missing]
    for g in config.feature_groups():
        group_feats = [n for n in names if spec[n]["group"] == g]
        group_missing = [n for n in group_feats if n in missing]
        # A "test" is a group with two or more blank fields: measuring it fills them together.
        if len(group_missing) >= 2:
            candidates.append(("test", g, group_missing))

    blocks = []
    for _, _, cols in candidates:
        b = pd.DataFrame([rec] * len(pool))
        for c in cols:
            b[c] = pool[c].to_numpy()
        blocks.append(b)
    X = to_frame(pd.concat(blocks, ignore_index=True).to_dict("records"))
    probs = {t: predictor.proba(t, X)[0].reshape(len(candidates), len(pool)) for t in targets}

    rows = {"feature": [], "test": []}
    for i, (kind, key, cols) in enumerate(candidates):
        per = {}
        for t in targets:
            p = probs[t][i]
            qhat = predictor.entries[t]["qhat"]
            per[t] = {"spread": round(float(p.std()), 4),
                      "range": [round(float(np.percentile(p, 10)), 4), round(float(np.percentile(p, 90)), 4)],
                      "p_definite": round(float(np.mean([_state(v, qhat) != contract.UNCERTAIN for v in p])), 3)}
        score = per[target]["spread"] if target else float(np.mean([per[t]["spread"] for t in targets]))
        item = {"score": round(score, 4), "per_target": per}
        if kind == "feature":
            item.update(name=key, label=spec[key]["label"], group=spec[key]["group"])
        else:
            item.update(name=key, label=f"{key} ({len(cols)} values)", fills=cols)
        rows[kind].append(item)

    for kind, key in (("feature", "features"), ("test", "tests")):
        out[key] = sorted(rows[kind], key=lambda r: -r["score"])[:top]
    return out
