"""Guideline pre-test probability scores, and how CoronaryTwin compares with them (feature 1).

Clinicians estimate the chance of obstructive CAD before any test from age, sex and the type
of chest pain. This module implements the published scores, so every patient gets a guideline
estimate next to the model's, and the Model-trust tab can show what the model adds:

  esc2019   ESC 2019 chronic coronary syndromes, Table 5 (Knuuti et al., Eur Heart J 2020;41:407).
            Age band x sex x symptom (typical / atypical / non-anginal / dyspnoea).
  esc2013   ESC 2013 stable CAD table (updated Diamond-Forrester, Genders et al. 2011).
            Same layout without dyspnoea. Both tables as reproduced in Adamson et al.,
            Eur Heart J Cardiovasc Imaging 2020 (SCOT-HEART, PMC7590886, Table 3), whose top
            band is 70+.
  cadc      CAD Consortium basic model (Genders et al., BMJ 2012;344:e3485): age, sex, chest pain.
  cadc_rf   CAD Consortium clinical model: adds diabetes, hypertension, dyslipidaemia, smoking.
            Coefficients as implemented in the CRAN package RiskScorescvd (CAD_Consortium_func).
  refit     The same inputs as cadc_rf plus family history, refitted by logistic regression on
            this dataset inside the same repeated 5-fold CV as the served models: the strongest
            "routine clinical" baseline, calibrated to this cath-lab population.

The published scores were derived in lower-prevalence populations (people referred for
non-invasive testing), and every patient here underwent catheterization (71% had CAD), so they
underestimate risk in absolute terms. AUC compares ranking only and is unaffected; the
reclassification and decision-curve results are reported against both the raw scores and the
locally refitted baseline, which has no calibration handicap.

    python -m src.experiments --only baselines   # merge into artifacts/experiments.json
"""
from __future__ import annotations

import math
from typing import Any

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from . import config

SYMPTOMS = ("typical", "atypical", "nonanginal", "dyspnoea")
AGE_BANDS = (30, 40, 50, 60, 70)  # lower bounds; the last band is 70+

# (men, women) per symptom, per age band 30-39 ... 70+, in percent.
ESC2019 = {
    "typical": [(3, 5), (22, 10), (32, 13), (44, 16), (52, 27)],
    "atypical": [(4, 3), (10, 6), (17, 6), (26, 11), (34, 19)],
    "nonanginal": [(1, 1), (3, 2), (11, 3), (22, 6), (24, 10)],
    "dyspnoea": [(0, 3), (12, 3), (20, 9), (27, 14), (32, 12)],
}
ESC2013 = {
    "typical": [(59, 28), (69, 37), (77, 47), (84, 58), (89, 68)],
    "atypical": [(29, 10), (38, 14), (49, 20), (59, 28), (69, 37)],
    "nonanginal": [(18, 5), (25, 8), (34, 12), (44, 17), (54, 24)],
}

CADC_BASIC = {"intercept": -6.917, "age": math.log(1.89) / 10, "male": math.log(3.89),
              "atypical": math.log(1.93), "typical": math.log(7.21)}
CADC_CLINICAL = {"intercept": -7.539, "age": math.log(1.85) / 10, "male": math.log(3.79),
                 "atypical": math.log(1.88), "typical_diabetes": math.log(4.91),
                 "typical_no_diabetes": math.log(7.36), "diabetes": math.log(2.29),
                 "hypertension": math.log(1.40), "dyslipidemia": math.log(1.53),
                 "smoking": math.log(1.59)}

RISK_FACTORS = ["diabetes", "hypertension", "dyslipidemia", "current_smoker", "family_history"]

SCORES = {
    "esc2019": {"label": "ESC 2019 pre-test probability", "short": "ESC 2019",
                "inputs": "age, sex, symptom type (incl. dyspnoea)"},
    "esc2013": {"label": "ESC 2013 / updated Diamond-Forrester", "short": "ESC 2013",
                "inputs": "age, sex, chest-pain type"},
    "cadc": {"label": "CAD Consortium (basic)", "short": "CAD Consortium",
             "inputs": "age, sex, chest-pain type"},
    "cadc_rf": {"label": "CAD Consortium (clinical)", "short": "CAD Consortium + RF",
                "inputs": "age, sex, chest-pain type, diabetes, hypertension, dyslipidaemia, smoking"},
}
REFIT = {"label": "Clinical model refitted on this data", "short": "Refit clinical",
         "inputs": "age, sex, symptom type, 5 risk factors (logistic regression, same CV)"}


# ---------------------------------------------------------------- per-patient scores

def symptom(record: dict[str, Any]) -> str | None:
    """Dataset chest-pain flags -> guideline symptom class. None when the flags are unknown.

    The dataset has no "no symptoms" class for these referrals: patients without chest pain
    were referred mostly for dyspnoea (25 of 30), so they map to the ESC 2019 dyspnoea column."""
    flags = [record.get(k) for k in ("typical_chest_pain", "atypical_chest_pain", "nonanginal_chest_pain")]
    if flags[0] == 1:
        return "typical"
    if flags[1] == 1:
        return "atypical"
    if flags[2] == 1:
        return "nonanginal"
    if any(f is None for f in flags):
        return None
    return "dyspnoea" if record.get("dyspnea") == 1 else "nonanginal"


def _band(age: float) -> int:
    return max(0, min(len(AGE_BANDS) - 1, int((age - 30) // 10)))


def esc2019(age: float, male: int, sym: str) -> float:
    return ESC2019[sym][_band(age)][0 if male else 1] / 100


def esc2013(age: float, male: int, sym: str) -> float:
    sym = "nonanginal" if sym == "dyspnoea" else sym  # no dyspnoea column in 2013
    return ESC2013[sym][_band(age)][0 if male else 1] / 100


def _sigmoid(z: float) -> float:
    return 1 / (1 + math.exp(-z))


def cadc(age: float, male: int, sym: str) -> float:
    b = CADC_BASIC
    return _sigmoid(b["intercept"] + b["age"] * age + b["male"] * male + b.get(sym, 0.0))


def cadc_rf(age: float, male: int, sym: str, record: dict[str, Any]) -> float | None:
    b = CADC_CLINICAL
    rf = {k: record.get(k) for k in ("diabetes", "hypertension", "dyslipidemia", "current_smoker", "ex_smoker")}
    if any(rf[k] is None for k in ("diabetes", "hypertension", "dyslipidemia", "current_smoker")):
        return None
    smoking = int(rf["current_smoker"] == 1 or rf["ex_smoker"] == 1)
    cp = {"typical": b["typical_diabetes"] if rf["diabetes"] else b["typical_no_diabetes"],
          "atypical": b["atypical"]}.get(sym, 0.0)
    z = (b["intercept"] + b["age"] * age + b["male"] * male + cp + b["diabetes"] * rf["diabetes"]
         + b["hypertension"] * rf["hypertension"] + b["dyslipidemia"] * rf["dyslipidemia"] + b["smoking"] * smoking)
    return _sigmoid(z)


def esc2019_band(p: float) -> str:
    """ESC 2019 action bands."""
    if p < 0.05:
        return "<5%: testing only for compelling reasons"
    if p <= 0.15:
        return "5–15%: testing may be considered"
    return ">15%: non-invasive testing recommended"


def patient_scores(record: dict[str, Any]) -> dict | None:
    """Guideline estimates for one patient. None when age, sex or symptom type is unknown."""
    age, male, sym = record.get("age"), record.get("sex_male"), symptom(record)
    if age is None or male is None or sym is None:
        return None
    rf = cadc_rf(age, male, sym, record)
    vals = {"esc2019": esc2019(age, male, sym), "esc2013": esc2013(age, male, sym),
            "cadc": cadc(age, male, sym), "cadc_rf": rf}
    return {
        "symptom": sym,
        "scores": [{"id": k, "label": SCORES[k]["label"], "short": SCORES[k]["short"],
                    "prob": round(v, 4)} for k, v in vals.items() if v is not None],
        "esc2019_band": esc2019_band(vals["esc2019"]),
        "note": ("Guideline scores use only age, sex, symptoms (and risk factors for CAD Consortium + RF). "
                 "They were derived in lower-risk populations, so in this cath-lab cohort they run low."),
    }


def score_frame(df: pd.DataFrame) -> pd.DataFrame:
    rows = [patient_scores(r) for r in df.to_dict("records")]
    out = pd.DataFrame(index=df.index, columns=list(SCORES), dtype=float)
    for i, r in zip(df.index, rows):
        if r:
            for s in r["scores"]:
                out.loc[i, s["id"]] = s["prob"]
    return out


# ---------------------------------------------------------------- locally refitted baseline

def clinical_design(df: pd.DataFrame) -> pd.DataFrame:
    sym = df.apply(lambda r: symptom(r.to_dict()), axis=1)
    X = pd.DataFrame({"age": df["age"], "male": df["sex_male"]}, index=df.index)
    for s in ("typical", "atypical", "dyspnoea"):  # non-anginal is the reference
        X[s] = (sym == s).astype(int)
    for k in RISK_FACTORS:
        X[k] = df[k]
    return X


def refit_oof(df: pd.DataFrame, target: str) -> np.ndarray:
    """Out-of-fold probabilities of the refitted clinical model, averaged over repeats, using the
    same outer CV as src/train.py (stratified 5-fold x outer_repeats, project seed)."""
    tr = config.settings()["training"]
    X, y = clinical_design(df), df[target].to_numpy()
    cv = RepeatedStratifiedKFold(n_splits=tr["outer_splits"], n_repeats=tr["outer_repeats"],
                                 random_state=config.seed())
    acc, cnt = np.zeros(len(y)), np.zeros(len(y))
    for a, b in cv.split(X, y):
        m = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)).fit(X.iloc[a], y[a])
        acc[b] += m.predict_proba(X.iloc[b])[:, 1]
        cnt[b] += 1
    return acc / cnt


# ---------------------------------------------------------------- comparison metrics

NRI_CUTS = (0.15, 0.85)  # ESC 2013 action bands: <15% no test, 15-85% test, >85% treat as CAD


def _cat(p: np.ndarray) -> np.ndarray:
    return np.digitize(p, NRI_CUTS)


def nri(y: np.ndarray, p_old: np.ndarray, p_new: np.ndarray) -> dict:
    """Categorical (ESC 2013 bands) and continuous net reclassification improvement, new vs old."""
    ev, ne = y == 1, y == 0
    co, cn = _cat(p_old), _cat(p_new)
    up, down = cn > co, cn < co
    cat_ev = up[ev].mean() - down[ev].mean()
    cat_ne = down[ne].mean() - up[ne].mean()
    cup, cdown = p_new > p_old, p_new < p_old
    cont = (cup[ev].mean() - cdown[ev].mean()) + (cdown[ne].mean() - cup[ne].mean())
    return {"categorical": cat_ev + cat_ne, "events": cat_ev, "nonevents": cat_ne, "continuous": cont}


def band_counts(y: np.ndarray, p: np.ndarray) -> dict:
    """Patients per ESC 2013 band (<15%, 15-85%, >85%), split by outcome."""
    c = _cat(p)
    return {"cad": [int(np.sum((c == i) & (y == 1))) for i in range(3)],
            "no_cad": [int(np.sum((c == i) & (y == 0))) for i in range(3)]}


def net_benefit(y: np.ndarray, p: np.ndarray, ts: np.ndarray) -> list[float]:
    n = len(y)
    out = []
    for t in ts:
        pred = p >= t
        tp, fp = np.sum(pred & (y == 1)), np.sum(pred & (y == 0))
        out.append(round(float(tp / n - fp / n * t / (1 - t)), 4))
    return out


def _ci(vals: np.ndarray) -> list[float]:
    return [round(float(np.percentile(vals, 2.5)), 4), round(float(np.percentile(vals, 97.5)), 4)]


def compare(y: np.ndarray, p_model: np.ndarray, baselines: dict[str, np.ndarray], n_boot: int,
            with_reclass: bool) -> dict:
    """Paired bootstrap of the model against each baseline on the same patients."""
    rng = np.random.default_rng(config.seed())
    boots = [b for b in rng.integers(0, len(y), size=(n_boot, len(y))) if len(np.unique(y[b])) == 2]
    auc_m = np.array([roc_auc_score(y[b], p_model[b]) for b in boots])
    out = {"model": {"auc": round(float(roc_auc_score(y, p_model)), 4), "auc_ci95": _ci(auc_m),
                     "brier": round(float(brier_score_loss(y, p_model)), 4),
                     "mean_pred": round(float(p_model.mean()), 4)},
           "baselines": {}}
    for k, p in baselines.items():
        auc_b = np.array([roc_auc_score(y[b], p[b]) for b in boots])
        d = auc_m - auc_b
        r = {"auc": round(float(roc_auc_score(y, p)), 4), "auc_ci95": _ci(auc_b),
             "delta_auc": round(float(roc_auc_score(y, p_model) - roc_auc_score(y, p)), 4),
             "delta_ci95": _ci(d), "p_model_better": round(float(np.mean(d > 0)), 3),
             "brier": round(float(brier_score_loss(y, p)), 4), "mean_pred": round(float(p.mean()), 4)}
        if with_reclass:
            point = nri(y, p, p_model)
            bs = [nri(y[b], p[b], p_model[b]) for b in boots]
            r["nri"] = {key: round(float(v), 4) for key, v in point.items()}
            r["nri"]["categorical_ci95"] = _ci(np.array([x["categorical"] for x in bs]))
            r["nri"]["continuous_ci95"] = _ci(np.array([x["continuous"] for x in bs]))
        out["baselines"][k] = r
    return out


def evaluate(df: pd.DataFrame, model_oof: dict[str, np.ndarray], n_boot: int) -> dict:
    """model_oof: target -> out-of-fold probability per row of df (averaged over repeats)."""
    sf = score_frame(df)
    if sf.isna().any().any():
        raise ValueError("a guideline score is missing for some dataset patients")
    overall = config.overall_target()
    res = {"scores": {**SCORES, "refit": REFIT}, "nri_bands": list(NRI_CUTS),
           "observed_prevalence": round(float(df[overall].mean()), 4),
           "symptom_counts": df.apply(lambda r: symptom(r.to_dict()), axis=1).value_counts().to_dict(),
           "targets": {}}
    for t in config.all_targets():
        y = df[t].to_numpy()
        base = {k: sf[k].to_numpy(float) for k in SCORES}
        base["refit"] = refit_oof(df, t)
        res["targets"][t] = compare(y, model_oof[t], base, n_boot, with_reclass=(t == overall))
    y, ts = df[overall].to_numpy(), np.round(np.arange(0.05, 0.951, 0.05), 2)
    prev = y.mean()
    refit = refit_oof(df, overall)
    res["bands"] = {k: band_counts(y, p) for k, p in
                    {"model": model_oof[overall], **{k: sf[k].to_numpy(float) for k in SCORES},
                     "refit": refit}.items()}
    res["decision"] = {
        "thresholds": ts.tolist(),
        "model": net_benefit(y, model_oof[overall], ts),
        **{k: net_benefit(y, sf[k].to_numpy(float), ts) for k in SCORES},
        "refit": net_benefit(y, refit, ts),
        "treat_all": [round(float(prev - (1 - prev) * t / (1 - t)), 4) for t in ts],
    }
    return res


def report_lines(res: dict | None) -> list[str]:
    if not res:
        return []
    T, S = res["targets"], res["scores"]
    overall = config.overall_target()
    lines = ["## Versus guideline pre-test probability scores", "",
             "What doctors estimate today from age, sex and symptom type, on the same 303 patients. Model numbers are "
             "out-of-fold; the published scores are fixed formulas (nothing fitted here); the refitted clinical model is "
             "out-of-fold in the same CV. ΔAUC = model minus score, paired bootstrap 95% CI.", "",
             "| Score | Inputs | " + " | ".join(f"{t} AUC (Δ model)" for t in T) + " |",
             "|---|---|" + "---|" * len(T),
             "| **CoronaryTwin** | 51 routine clinical values | " + " | ".join(
                 f"**{T[t]['model']['auc']:.3f}**" for t in T) + " |"]
    for k in [*SCORES, "refit"]:
        cells = []
        for t in T:
            b = T[t]["baselines"][k]
            cells.append(f"{b['auc']:.3f} (+{b['delta_auc']:.3f}, {b['delta_ci95'][0]:+.3f} to {b['delta_ci95'][1]:+.3f})"
                         if b["delta_auc"] >= 0 else
                         f"{b['auc']:.3f} ({b['delta_auc']:+.3f}, {b['delta_ci95'][0]:+.3f} to {b['delta_ci95'][1]:+.3f})")
        lines.append(f"| {S[k]['label']} | {S[k]['inputs']} | " + " | ".join(cells) + " |")
    o = T[overall]
    lines += ["", "The guideline scores were built to rank overall CAD, not single arteries; the artery columns are "
              "shown for completeness.", "",
              f"### Reclassification ({overall}, ESC 2013 action bands <15% / 15–85% / >85%)", "",
              "| Model vs | Categorical NRI (95% CI) | Events | Non-events | Continuous NRI (95% CI) | Mean predicted |",
              "|---|---|---|---|---|---|"]
    for k in [*SCORES, "refit"]:
        n, b = o["baselines"][k]["nri"], o["baselines"][k]
        lines.append(f"| {S[k]['label']} | {n['categorical']:+.3f} ({n['categorical_ci95'][0]:+.3f} to "
                     f"{n['categorical_ci95'][1]:+.3f}) | {n['events']:+.3f} | {n['nonevents']:+.3f} | "
                     f"{n['continuous']:+.3f} ({n['continuous_ci95'][0]:+.3f} to {n['continuous_ci95'][1]:+.3f}) | "
                     f"{b['mean_pred']:.0%} |")
    d, bands = res["decision"], res.get("bands", {})
    if bands:
        lines += ["", "Patients per band (CAD / no CAD): " + "; ".join(
            f"{(S[k]['short'] if k in S else 'CoronaryTwin')}: <15% {b['cad'][0]}/{b['no_cad'][0]}, "
            f"15–85% {b['cad'][1]}/{b['no_cad'][1]}, >85% {b['cad'][2]}/{b['no_cad'][2]}"
            for k, b in bands.items()) + ".",
                  "", "CoronaryTwin is the most cautious at the extremes: it places no CAD patient below 15%, "
                  "but it also commits fewer CAD patients to the >85% band than the refitted clinical model. That is why "
                  "its banded NRI against the refitted model is negative while its AUC is slightly higher (a difference "
                  "within noise). Against the refitted model, the honest summary is: similar ranking, more caution."]
    lines += ["", f"Observed prevalence {res['observed_prevalence']:.0%}; CoronaryTwin's mean estimate "
              f"{o['model']['mean_pred']:.0%}. The published scores were derived where far fewer patients had CAD, "
              "so their categorical NRI partly reflects calibration; the refitted model has no such handicap and is "
              "the fair like-for-like comparison.", "",
              "### Net benefit (decision curve, CAD)", "",
              "| Threshold | CoronaryTwin | " + " | ".join(S[k]["short"] for k in [*SCORES, "refit"]) + " | Treat all |",
              "|---|---|" + "---|" * (len(SCORES) + 2)]
    for x in (0.3, 0.5, 0.7, 0.85):
        i = d["thresholds"].index(x)
        lines.append(f"| {x:.2f} | **{d['model'][i]:+.3f}** | " + " | ".join(
            f"{d[k][i]:+.3f}" for k in [*SCORES, "refit"]) + f" | {d['treat_all'][i]:+.3f} |")
    lines += ["", "Sources: ESC 2019 Table 5 (Knuuti et al., Eur Heart J 2020); ESC 2013 / updated Diamond-Forrester "
              "and ESC 2019 tables as reproduced in Adamson et al. 2020 (SCOT-HEART, PMC7590886); CAD Consortium "
              "(Genders et al., BMJ 2012) as implemented in the R package RiskScorescvd. The 2024 ESC RF-CL model "
              "is not included: its full table could not be verified from an open source.", ""]
    return lines
