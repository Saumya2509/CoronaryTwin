"""Extra evaluation for the Trust tab and docs (speciality S4, specialities.md part 3).

    python -m src.experiments          # ~5 min on 4 cores; writes artifacts/experiments.json, docs/experiments.md
    python -m src.experiments --fast   # 1 repeat, fewer bootstrap samples (smoke runs, tests)

Run after `python tasks.py train` (needs the OOF predictions and final models).

  comparison   paired bootstrap of the AUC difference between each family and the selected one
               (same out-of-fold patients, so the comparison is paired)
  decision     decision-curve analysis: net benefit of the selected model vs treat-all / treat-none
  ablation     drop one feature group at a time (values blanked -> imputed constant), AUC drop
  engineered   add clinically motivated engineered features (features.yaml rationale), AUC change
  calibration  none vs sigmoid vs isotonic, Brier score
  learning     AUC vs training-set size
  robustness   small input noise on the final models: how much do probabilities / states move
  ood          out-of-distribution check: false alarms on real patients, hits on synthetic extremes
  nextbest     does the "next best test" pick a test that recovers the full-record estimate better
               than a random choice?
  chain        classifier chain: does feeding the overall CAD estimate into the artery models help?
               (`--only chain` runs just this and merges it into the existing results)
  baselines    versus the guideline pre-test probability scores (ESC 2019, ESC 2013, CAD Consortium)
               and a clinical model refitted on this data: AUC, NRI, decision curve (src/baselines.py)
               (`--only baselines` runs just this and merges it)

Ablation, engineered, calibration and learning curves use the selected family with its final
hyperparameters, refitted inside repeated stratified CV (no re-tuning, so they are cheap and
comparable). Every AUC comes from held-out folds.
"""
from __future__ import annotations

import argparse
import json
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
from joblib import Parallel, delayed
from sklearn.base import BaseEstimator, TransformerMixin, clone
from sklearn.calibration import CalibratedClassifierCV
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold, StratifiedKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

from . import baselines, casebase, config, conformal, contract, data, models, nextbest
from .inference import Predictor, to_frame
from .leakage_guard import make_xy

EXPERIMENTS_JSON = config.ARTIFACTS_DIR / "experiments.json"
REPORT_MD = config.ROOT / "docs" / "experiments.md"
OOF_DIR = config.ARTIFACTS_DIR / "oof"


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


# ---------------------------------------------------------------- helpers

def _final_pipeline(target: str, reg: dict) -> Pipeline:
    bundle_params = json.loads((config.ARTIFACTS_DIR / "metrics.json").read_text(encoding="utf-8"))
    params = bundle_params["targets"][target]["params"]
    pipe = models.make_pipeline(reg["targets"][target]["family"])
    return pipe.set_params(**{f"clf__{k}": v for k, v in params.items()})


def _cv(repeats: int):
    return RepeatedStratifiedKFold(n_splits=5, n_repeats=repeats, random_state=config.seed())


def _fold_auc(pipe, X, y, tr, te, blank: list[str] | None = None, frac: float = 1.0, seed: int = 0):
    Xtr, ytr = X.iloc[tr], y.iloc[tr]
    if frac < 1.0:                       # stratified subsample of the training fold
        rng = np.random.default_rng(seed)
        keep = np.concatenate([rng.choice(np.flatnonzero(ytr.to_numpy() == c),
                                          max(2, int(round(frac * (ytr == c).sum()))), replace=False)
                               for c in (0, 1)])
        Xtr, ytr = Xtr.iloc[keep], ytr.iloc[keep]
    Xte = X.iloc[te]
    if blank:  # constant from the training fold (median / most common): the group carries no information
        Xtr, Xte = Xtr.copy(), Xte.copy()
        for c in blank:
            fill = Xtr[c].median() if pd.api.types.is_numeric_dtype(Xtr[c]) else Xtr[c].mode().iloc[0]
            Xtr[c] = fill
            Xte[c] = fill
    m = clone(pipe).fit(Xtr, ytr)
    return roc_auc_score(y.iloc[te], m.predict_proba(Xte)[:, 1])


def _paired(base: list[float], other: list[float]) -> dict:
    d = np.asarray(other) - np.asarray(base)
    se = d.std(ddof=1) / np.sqrt(len(d)) if len(d) > 1 else 0.0
    return {"auc": round(float(np.mean(other)), 4), "delta": round(float(d.mean()), 4),
            "ci95": [round(float(d.mean() - 1.96 * se), 4), round(float(d.mean() + 1.96 * se), 4)]}


# ---------------------------------------------------------------- 1. family comparison (paired bootstrap)

def comparison(target: str, selected: str, families: list[str], n_boot: int) -> dict:
    per = {}
    for f in families:
        path = OOF_DIR / f"{target.lower()}_{f}.csv"
        if path.exists():
            oof = pd.read_csv(path)
            per[f] = oof.groupby("idx").agg(y=("y", "first"), p=("p", "mean"))
    if selected not in per:
        return {}
    base = per[selected]
    y = base["y"].to_numpy()
    rng = np.random.default_rng(config.seed())
    boots = rng.integers(0, len(y), size=(n_boot, len(y)))
    boots = [b for b in boots if len(np.unique(y[b])) == 2]
    out = {}
    for f, d in per.items():
        p_sel, p_f = base["p"].to_numpy(), d.loc[base.index, "p"].to_numpy()
        deltas = np.array([roc_auc_score(y[b], p_f[b]) - roc_auc_score(y[b], p_sel[b]) for b in boots])
        out[f] = {"label": models.FAMILY_LABELS[f], "auc": round(float(roc_auc_score(y, p_f)), 4),
                  "delta_vs_selected": round(float(roc_auc_score(y, p_f) - roc_auc_score(y, p_sel)), 4),
                  "ci95": [round(float(np.percentile(deltas, 2.5)), 4), round(float(np.percentile(deltas, 97.5)), 4)],
                  "p_better": round(float(np.mean(deltas > 0)), 3), "selected": f == selected}
    return out


def selected_oof(df: pd.DataFrame, reg: dict) -> dict[str, np.ndarray]:
    """Out-of-fold probability of each served model per row of df, averaged over repeats."""
    out = {}
    for t in config.all_targets():
        oof = pd.read_csv(OOF_DIR / f"{t.lower()}_{reg['targets'][t]['family']}.csv")
        pp = oof.groupby("idx").agg(y=("y", "first"), p=("p", "mean")).reindex(df.index)
        if pp["p"].isna().any() or not (pp["y"].to_numpy() == df[t].to_numpy()).all():
            raise ValueError(f"{t}: OOF predictions do not line up with the processed data")
        out[t] = pp["p"].to_numpy()
    return out


def baseline_experiment(df: pd.DataFrame, reg: dict, n_boot: int) -> dict:
    return baselines.evaluate(df, selected_oof(df, reg), n_boot)


# ---------------------------------------------------------------- 2. decision curve

def decision_curve(target: str, selected: str) -> dict:
    oof = pd.read_csv(OOF_DIR / f"{target.lower()}_{selected}.csv")
    pp = oof.groupby("idx").agg(y=("y", "first"), p=("p", "mean"))
    y, p, n = pp["y"].to_numpy(), pp["p"].to_numpy(), len(pp)
    prev = y.mean()
    ts = np.round(np.arange(0.05, 0.951, 0.05), 2)
    model, treat_all = [], []
    for t in ts:
        pred = p >= t
        tp, fp = np.sum(pred & (y == 1)), np.sum(pred & (y == 0))
        w = t / (1 - t)
        model.append(round(float(tp / n - fp / n * w), 4))
        treat_all.append(round(float(prev - (1 - prev) * w), 4))
    return {"thresholds": ts.tolist(), "model": model, "treat_all": treat_all,
            "prevalence": round(float(prev), 4)}


# ---------------------------------------------------------------- 3-6. refit experiments

class Engineered(BaseEstimator, TransformerMixin):
    """Adds the engineered columns of ENGINEERED to a canonical feature frame."""

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        X = X.copy()
        for name, (fn, _) in ENGINEERED.items():
            X[name] = fn(X)
        return X


ENGINEERED = {
    "risk_factor_count": (lambda X: X[["diabetes", "hypertension", "current_smoker", "family_history",
                                       "dyslipidemia"]].sum(axis=1, min_count=1),
                          "Number of classic risk factors present (DM, HTN, smoking, family history, DLP)."),
    "ecg_abnormal_count": (lambda X: X[["q_wave", "st_elevation", "st_depression", "t_inversion",
                                        "poor_r_progression", "lvh"]].sum(axis=1, min_count=1),
                           "Number of abnormal ECG findings; single findings are rare and noisy."),
    "age_x_male": (lambda X: X["age"] * X["sex_male"],
                   "Age acts differently by sex (later onset in women)."),
    "ldl_hdl_ratio": (lambda X: X["ldl"] / X["hdl"].clip(lower=1),
                      "Lipid ratio; carries more risk information than either value alone."),
    "ecg_x_rwma": (lambda X: X[["q_wave", "st_elevation", "st_depression", "t_inversion"]].max(axis=1)
                   * X["region_rwma"],
                   "ECG ischemia finding together with wall-motion abnormality."),
}


def _engineered_pipeline(pipe: Pipeline) -> Pipeline:
    pre = data.build_preprocessor()
    extra = ("eng", Pipeline([("imp", SimpleImputer(strategy="median")), ("sc", StandardScaler())]),
             list(ENGINEERED))
    pre = ColumnTransformer([*pre.transformers, extra], verbose_feature_names_out=False)
    return Pipeline([("add", Engineered()), ("pre", pre), ("clf", clone(pipe.named_steps["clf"]))])


def refit_experiments(target: str, pipe: Pipeline, X, y, repeats: int) -> dict:
    splits = list(_cv(repeats).split(X, y))
    par = Parallel(n_jobs=-1)
    spec = {f["name"]: f for f in data.features()}
    groups = config.feature_groups()

    base = par(delayed(_fold_auc)(pipe, X, y, tr, te) for tr, te in splits)
    ablation = {}
    for g in groups:
        cols = [n for n in data.feature_names() if spec[n]["group"] == g]
        aucs = par(delayed(_fold_auc)(pipe, X, y, tr, te, blank=cols) for tr, te in splits)
        ablation[g] = {"n_features": len(cols), **_paired(base, aucs)}

    eng = par(delayed(_fold_auc)(_engineered_pipeline(pipe), X, y, tr, te) for tr, te in splits)

    learning = []
    for frac in (0.2, 0.4, 0.6, 0.8, 1.0):
        aucs = par(delayed(_fold_auc)(pipe, X, y, tr, te, frac=frac, seed=i) for i, (tr, te) in enumerate(splits))
        learning.append({"fraction": frac, "n_train": int(round(frac * len(splits[0][0]))),
                         "auc": round(float(np.mean(aucs)), 4), "sd": round(float(np.std(aucs, ddof=1)), 4)})

    def _cal(method, tr, te):
        if method == "none":
            m = clone(pipe).fit(X.iloc[tr], y.iloc[tr])
        else:
            m = CalibratedClassifierCV(clone(pipe), method=method,
                                       cv=StratifiedKFold(5, shuffle=True, random_state=config.seed())
                                       ).fit(X.iloc[tr], y.iloc[tr])
        return brier_score_loss(y.iloc[te], m.predict_proba(X.iloc[te])[:, 1])

    calibration = {}
    for method in ("none", "sigmoid", "isotonic"):
        b = par(delayed(_cal)(method, tr, te) for tr, te in splits)
        calibration[method] = {"brier": round(float(np.mean(b)), 4), "sd": round(float(np.std(b, ddof=1)), 4)}

    return {"base_auc": round(float(np.mean(base)), 4), "folds": len(splits), "ablation": ablation,
            "engineered": _paired(base, eng), "learning": learning, "calibration": calibration}


# ---------------------------------------------------------------- 6b. classifier chain

def _chain_fold(cad_pipe, pipe, X, y, y_cad, tr, te) -> tuple[float, float]:
    """AUC without and with the CAD estimate as an extra input. The CAD estimate for training rows
    is out-of-fold inside the training fold, and for test rows comes from a CAD model fitted on
    the training fold only, so no label leaks."""
    from sklearn.model_selection import cross_val_predict
    Xtr, Xte = X.iloc[tr], X.iloc[te]
    inner = StratifiedKFold(5, shuffle=True, random_state=config.seed())
    cad_tr = cross_val_predict(clone(cad_pipe), Xtr, y_cad.iloc[tr], cv=inner, method="predict_proba")[:, 1]
    cad_te = clone(cad_pipe).fit(Xtr, y_cad.iloc[tr]).predict_proba(Xte)[:, 1]
    base = clone(pipe).fit(Xtr, y.iloc[tr])
    auc0 = roc_auc_score(y.iloc[te], base.predict_proba(Xte)[:, 1])
    pre = data.build_preprocessor()
    pre = ColumnTransformer([*pre.transformers, ("chain", StandardScaler(), ["cad_prob"])], verbose_feature_names_out=False)
    chained = Pipeline([("pre", pre), ("clf", clone(pipe.named_steps["clf"]))])
    chained.fit(Xtr.assign(cad_prob=cad_tr), y.iloc[tr])
    auc1 = roc_auc_score(y.iloc[te], chained.predict_proba(Xte.assign(cad_prob=cad_te))[:, 1])
    return auc0, auc1


def chain_experiment(df: pd.DataFrame, reg: dict, repeats: int) -> dict:
    overall = config.overall_target()
    cad_pipe = _final_pipeline(overall, reg)
    out = {}
    for t in config.vessel_ids():
        X, y = make_xy(df, t)
        _, y_cad = make_xy(df, overall)
        splits = list(_cv(repeats).split(X, y))
        res = Parallel(n_jobs=-1)(delayed(_chain_fold)(cad_pipe, _final_pipeline(t, reg), X, y, y_cad, tr, te) for tr, te in splits)
        base, chained = [r[0] for r in res], [r[1] for r in res]
        out[t] = {"base_auc": round(float(np.mean(base)), 4), **_paired(base, chained)}
        log(f"chain {t}: {out[t]}")
    return out


# ---------------------------------------------------------------- 7. robustness

def robustness(pred: Predictor, X: pd.DataFrame, draws: int) -> dict:
    numeric = data.columns_by_type("numeric")
    sd = X[numeric].astype(float).std()
    rng = np.random.default_rng(config.seed())
    out = {}
    for t in pred.targets:
        p0 = pred.proba(t, X)[0]
        qhat = pred.entries[t]["qhat"]
        s0 = np.array([contract.state_from_set(conformal.conformal_set(v, qhat)) for v in p0])
        out[t] = {}
        for level in (0.05, 0.10):
            dps, flips, hard = [], [], []
            for _ in range(draws):
                Xn = X.copy()
                Xn[numeric] = X[numeric].astype(float) + rng.normal(0, 1, (len(X), len(numeric))) * (sd.to_numpy() * level)
                p = pred.proba(t, Xn)[0]
                s = np.array([contract.state_from_set(conformal.conformal_set(v, qhat)) for v in p])
                dps.append(np.abs(p - p0))
                flips.append(np.mean(s != s0))
                hard.append(np.mean(((s0 == contract.LIKELY) & (s == contract.UNLIKELY))
                                    | ((s0 == contract.UNLIKELY) & (s == contract.LIKELY))))
            dp = np.concatenate(dps)
            out[t][f"{int(level * 100)}pct_sd"] = {
                "mean_abs_change": round(float(dp.mean()), 4), "p95_abs_change": round(float(np.percentile(dp, 95)), 4),
                "state_change_rate": round(float(np.mean(flips)), 4),
                "likely_unlikely_flip_rate": round(float(np.mean(hard)), 4)}
    return out


# ---------------------------------------------------------------- 8. OOD check

def ood_eval(cb: casebase.CaseBase, X: pd.DataFrame, n: int) -> dict:
    rng = np.random.default_rng(config.seed())
    real = X.to_dict("records")
    fa = np.mean([cb.ood(r)["flag"] for r in real])
    spec = {f["name"]: f for f in data.features()}
    # (feature, low, high) intervals that the API accepts but no training patient reached.
    gaps = []
    for f in data.columns_by_type("numeric"):
        lo, hi = spec[f]["valid_range"]
        tr_lo, tr_hi = cb.art["ranges"][f]
        gaps += [(f, lo, tr_lo)] if lo < tr_lo else []
        gaps += [(f, tr_hi, hi)] if hi > tr_hi else []
    extreme, shuffled = [], []
    for _ in range(n):
        r = dict(real[rng.integers(len(real))])
        f, a, b = gaps[rng.integers(len(gaps))]
        r[f] = float(rng.uniform(a, b))
        extreme.append(cb.ood(r)["flag"])
        # Each feature drawn from a different real patient: realistic values, unrealistic combination.
        mix = {k: real[rng.integers(len(real))][k] for k in data.feature_names()}
        shuffled.append(cb.ood(mix)["unusual_combination"])
    return {"false_alarm_rate_training": round(float(fa), 4),
            "synthetic_extreme_detection": round(float(np.mean(extreme)), 4),
            "shuffled_combination_detection": round(float(np.mean(shuffled)), 4), "n_synthetic": n}


# ---------------------------------------------------------------- 9. next-best-test check

def nextbest_eval(pred: Predictor, cb: casebase.CaseBase, X: pd.DataFrame, n: int) -> dict:
    """Blank ECG, Echo and Labs for real patients. Fill the top-ranked test with the patient's
    true values vs a random other blank test, and measure how close the estimate gets to the
    full-record estimate (mean |p - p_full| over the four targets)."""
    rng = np.random.default_rng(config.seed())
    spec = {f["name"]: f for f in data.features()}
    blank_groups = ["ECG", "Echo", "Labs"]
    rows = X.sample(n, random_state=config.seed()).to_dict("records")
    gaps = {"none": [], "top": [], "random": []}
    top_hits = []
    for r in rows:
        full = {t: pred.proba(t, to_frame(r))[0][0] for t in pred.targets}
        part = {k: (None if spec[k]["group"] in blank_groups else v) for k, v in r.items()}

        def gap(rec):
            return float(np.mean([abs(pred.proba(t, to_frame(rec))[0][0] - full[t]) for t in pred.targets]))

        res = nextbest.next_best(pred, cb, part)
        tests = [t["name"] for t in res["tests"]]
        top = tests[0]
        other = [g for g in blank_groups if g != top][rng.integers(len(blank_groups) - 1)]
        fill = lambda g: {k: (r[k] if spec[k]["group"] == g else v) for k, v in part.items()}  # noqa: E731
        gaps["none"].append(gap(part))
        gaps["top"].append(gap(fill(top)))
        gaps["random"].append(gap(fill(other)))
        # Oracle: which single test actually closes the gap the most?
        best = min(blank_groups, key=lambda g: gap(fill(g)))
        top_hits.append(best == top)
    return {"n": n, "blanked": blank_groups,
            "mean_gap": {k: round(float(np.mean(v)), 4) for k, v in gaps.items()},
            "top_closes_more_than_random": round(float(np.mean(np.array(gaps["top"]) <= np.array(gaps["random"]))), 3),
            "top_is_best_test": round(float(np.mean(top_hits)), 3)}


# ---------------------------------------------------------------- report

def _chain_lines(res: dict) -> list[str]:
    c = res.get("chain")
    if not c:
        return []
    rows = [f"| {t} | {r['base_auc']:.3f} | {r['auc']:.3f} | {r['delta']:+.3f} ({r['ci95'][0]:+.3f} to {r['ci95'][1]:+.3f}) |" for t, r in c.items()]
    gain = any(r["ci95"][0] > 0 for r in c.values())
    return ["## Classifier chain", "",
            "The overall CAD estimate is added as an input to each artery model. For training rows it is out-of-fold inside "
            "the training fold; for test rows it comes from a CAD model fitted on the training fold only.", "",
            "| Artery | Base AUC | With CAD estimate | Δ (95% CI) |", "|---|---|---|---|", *rows, "",
            "A reliable gain: a candidate for the next model version." if gain else
            "No reliable gain, so the served artery models stay independent of the overall model.", ""]


def _report(res: dict) -> str:
    T = res["targets"]
    m = json.loads(config.METRICS_JSON.read_text(encoding="utf-8"))["targets"]
    lines = [f"# Experiments (specialities.md part 3)",
             "", f"Generated by `python -m src.experiments` on {res['created'][:10]} for model version "
             f"**{res['version']}** ({res['mode']} mode). Do not edit by hand; numbers come from "
             "`artifacts/experiments.json`, the same file the app's Model trust tab reads.", "",
             "## Results table (nested CV, out-of-fold)", "",
             "| Target | Model | AUC (95% CI) | F1 | Recall | Precision | Brier |", "|---|---|---|---|---|---|---|"]
    for t, mt in m.items():
        a, th = mt["metrics_at_0.5"], mt["metrics_at_threshold"]
        lines.append(f"| {t} | {mt['family_label']} | {a['roc_auc']['mean']:.2f} ({a['roc_auc']['ci95'][0]:.2f}–"
                     f"{a['roc_auc']['ci95'][1]:.2f}) | {th['f1']['mean']:.2f} | {th['recall']['mean']:.2f} | "
                     f"{th['precision']['mean']:.2f} | {a['brier']['mean']:.3f} |")
    lines += ["", "F1, recall and precision are at each model's recall-favoring threshold (see the model card).", "",
              "## Model families: paired bootstrap", "",
              "ΔAUC of each family minus the selected one, on the same out-of-fold patients (bootstrap 95% CI). "
              "A CI that includes 0 means the data cannot tell the two apart.", "",
              "| Target | " + " | ".join(models.FAMILY_LABELS.values()) + " |", "|---|" + "---|" * len(models.FAMILY_LABELS)]
    for t, r in T.items():
        cells = []
        for f in models.FAMILY_LABELS:
            c = r["comparison"].get(f)
            if not c:
                cells.append("–")
            elif c["selected"]:
                cells.append(f"**{c['auc']:.3f} (selected)**")
            else:
                cells.append(f"{c['auc']:.3f} (Δ {c['delta_vs_selected']:+.3f}, {c['ci95'][0]:+.3f} to {c['ci95'][1]:+.3f})")
        lines.append(f"| {t} | " + " | ".join(cells) + " |")
    groups = config.feature_groups()
    lines += ["", "## Ablation by feature group", "",
              f"AUC change when one group is blanked (imputed to a constant), selected family with fixed "
              f"hyperparameters, {next(iter(T.values()))['refit']['folds']} held-out folds. Negative = the group helps.", "",
              "| Target | Base AUC | " + " | ".join(groups) + " |", "|---|---|" + "---|" * len(groups)]
    for t, r in T.items():
        a = r["refit"]["ablation"]
        lines.append(f"| {t} | {r['refit']['base_auc']:.3f} | " + " | ".join(
            f"{a[g]['delta']:+.3f}" for g in groups) + " |")
    lines += ["", "## Engineered features", "",
              "| Feature | Rationale |", "|---|---|"]
    lines += [f"| `{k}` | {v[1]} |" for k, v in ENGINEERED.items()]
    lines += ["", "| Target | Base AUC | With engineered | Δ (95% CI) |", "|---|---|---|---|"]
    for t, r in T.items():
        e = r["refit"]["engineered"]
        lines.append(f"| {t} | {r['refit']['base_auc']:.3f} | {e['auc']:.3f} | {e['delta']:+.3f} "
                     f"({e['ci95'][0]:+.3f} to {e['ci95'][1]:+.3f}) |")
    lines += ["", "The engineered features are **not** used by the served models unless they clearly help; "
              "a result of \"no reliable gain\" is reported as such.", "",
              "## Calibration method (Brier, lower is better)", "", "| Target | None | Sigmoid (Platt) | Isotonic |",
              "|---|---|---|---|"]
    for t, r in T.items():
        c = r["refit"]["calibration"]
        lines.append(f"| {t} | {c['none']['brier']:.4f} | {c['sigmoid']['brier']:.4f} | {c['isotonic']['brier']:.4f} |")
    lines += ["", "## Learning curve (AUC vs training size)", "",
              "| Target | " + " | ".join(f"{int(x['fraction'] * 100)}% (n≈{x['n_train']})"
                                          for x in next(iter(T.values()))["refit"]["learning"]) + " |",
              "|---|" + "---|" * 5]
    for t, r in T.items():
        lines.append(f"| {t} | " + " | ".join(f"{x['auc']:.3f}" for x in r["refit"]["learning"]) + " |")
    lines += ["", "A curve still rising at 100% means more patients would likely help: the small dataset is a real limit.",
              "", "## Robustness to input noise", "",
              "Gaussian noise of 5% / 10% of each numeric feature's SD added to all 303 patients (final models).", "",
              "| Target | Mean |Δp| 5% | State change 5% | Mean |Δp| 10% | State change 10% | Likely↔Unlikely flips 10% |",
              "|---|---|---|---|---|---|"]
    for t, r in res["robustness"].items():
        a, b = r["5pct_sd"], r["10pct_sd"]
        lines.append(f"| {t} | {a['mean_abs_change']:.3f} | {a['state_change_rate']:.1%} | {b['mean_abs_change']:.3f} | "
                     f"{b['state_change_rate']:.1%} | {b['likely_unlikely_flip_rate']:.1%} |")
    lines += ["", "## Decision curves", "",
              "Net benefit of acting on the model vs acting on everyone, at selected thresholds.", "",
              "| Target | Prevalence | " + " | ".join(f"t={x}" for x in (0.2, 0.4, 0.6)) + " |", "|---|---|---|---|---|"]
    for t, r in T.items():
        d = r["decision"]
        cells = []
        for x in (0.2, 0.4, 0.6):
            i = d["thresholds"].index(x)
            cells.append(f"{d['model'][i]:+.3f} vs {d['treat_all'][i]:+.3f}")
        lines.append(f"| {t} | {d['prevalence']:.0%} | " + " | ".join(cells) + " |")
    o, nb = res["ood"], res["nextbest"]
    lines += ["", "## Out-of-distribution warning", "",
              f"- False alarms on the 303 real training patients: **{o['false_alarm_rate_training']:.1%}**",
              f"- Synthetic patients with one value beyond the training range (still physiologically valid): "
              f"**{o['synthetic_extreme_detection']:.0%}** flagged (n={o['n_synthetic']})",
              f"- Shuffled patients (each value from a different real patient): **{o['shuffled_combination_detection']:.0%}** "
              "flagged as an unusual combination. Many shuffled records still look plausible, and the cut-off is set for "
              "a ~1% false-alarm rate, so this detector is deliberately conservative.",
              "", "## Next best test", "",
              f"For {nb['n']} real patients, {', '.join(nb['blanked'])} were blanked. Filling in the top-ranked test with the "
              "patient's true values was compared with filling in a random other blank test. Gap = mean |p − p(full record)| over the four targets.", "",
              f"- Gap with all three blank: {nb['mean_gap']['none']:.3f}",
              f"- After the top-ranked test: **{nb['mean_gap']['top']:.3f}**; after a random other test: {nb['mean_gap']['random']:.3f}",
              f"- Top-ranked test closed the gap at least as well as the random one in **{nb['top_closes_more_than_random']:.0%}** of patients, "
              f"and was the single best test in {nb['top_is_best_test']:.0%} (chance: 33%).",
              "", "The ranking reflects model uncertainty, not clinical necessity.", "",
              *(_chain_lines(res)),
              *(baselines.report_lines(res.get("baselines"))),
              "## Not done, and why", "",
              "- **External validation**: the original and extended Z-Alizadeh Sani files contain the same patients, so "
              "one cannot validate the other. Other public sets (e.g. UCI Cleveland) share only a few features.",
              "- **Synthetic augmentation (SMOTE/CTGAN), TabPFN, Optuna**: not run in this pass. With 303 rows the expected gain "
              "is small; the pipeline is ready to add them as families in `src/models.py`.", ""]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fast", action="store_true")
    ap.add_argument("--only", choices=["chain", "baselines"], help="run one experiment and merge it into experiments.json")
    args = ap.parse_args(argv)
    repeats, n_boot, draws, n_syn, n_nb = (1, 200, 2, 60, 20) if args.fast else (2, 2000, 5, 300, 60)
    if args.only == "chain":
        reg = json.loads(config.REGISTRY_JSON.read_text(encoding="utf-8"))
        res = json.loads(EXPERIMENTS_JSON.read_text(encoding="utf-8"))
        res["chain"] = chain_experiment(pd.read_csv(data.PROCESSED_CSV), reg, repeats)
        EXPERIMENTS_JSON.write_text(json.dumps(res, indent=2) + "\n", encoding="utf-8")
        REPORT_MD.write_text(_report(res), encoding="utf-8")
        log("merged classifier-chain results into experiments.json and docs/experiments.md")
        return
    if args.only == "baselines":
        reg = json.loads(config.REGISTRY_JSON.read_text(encoding="utf-8"))
        res = json.loads(EXPERIMENTS_JSON.read_text(encoding="utf-8"))
        res["baselines"] = baseline_experiment(pd.read_csv(data.PROCESSED_CSV), reg, n_boot)
        EXPERIMENTS_JSON.write_text(json.dumps(res, indent=2) + "\n", encoding="utf-8")
        REPORT_MD.write_text(_report(res), encoding="utf-8")
        log("merged guideline-score comparison into experiments.json and docs/experiments.md")
        return

    reg = json.loads(config.REGISTRY_JSON.read_text(encoding="utf-8"))
    df = pd.read_csv(data.PROCESSED_CSV)
    families = config.settings()["training"]["families"]
    pred = Predictor()
    cb = casebase.load()
    if cb is None:
        raise SystemExit("artifacts/casebase.joblib missing: run `python -m src.casebase` first")

    res = {"version": reg["version"], "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "mode": "fast" if args.fast else "full", "targets": {}}
    for t in pred.targets:
        start = time.time()
        X, y = make_xy(df, t)
        sel = reg["targets"][t]["family"]
        res["targets"][t] = {
            "selected": sel,
            "comparison": comparison(t, sel, families, n_boot),
            "decision": decision_curve(t, sel),
            "refit": refit_experiments(t, _final_pipeline(t, reg), X, y, repeats),
        }
        log(f"{t}: done ({time.time() - start:.0f}s)")
    X = df[data.feature_names()]
    res["robustness"] = robustness(pred, X, draws)
    log("robustness done")
    res["ood"] = ood_eval(cb, X, n_syn)
    log("ood done")
    res["nextbest"] = nextbest_eval(pred, cb, X, n_nb)
    log("next-best-test check done")
    res["chain"] = chain_experiment(df, reg, repeats)
    res["baselines"] = baseline_experiment(df, reg, n_boot)

    EXPERIMENTS_JSON.write_text(json.dumps(res, indent=2) + "\n", encoding="utf-8")
    REPORT_MD.write_text(_report(res), encoding="utf-8")
    log(f"wrote {EXPERIMENTS_JSON.relative_to(config.ROOT)} and {REPORT_MD.relative_to(config.ROOT)}")


if __name__ == "__main__":
    main()
