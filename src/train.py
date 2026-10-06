"""Train the four calibrated classifiers: CAD, LAD, LCX, RCA (module 02).

    python -m src.train              # full nested CV (5x5 outer, all families)
    python -m src.train --fast       # smoke run with the `training.fast` settings
    python -m src.train --targets LAD RCA

For each target and model family:
  outer RepeatedStratifiedKFold -> inner RandomizedSearchCV (ROC-AUC) -> Platt calibration
  on the outer-train part -> predictions on the untouched outer-test fold.
The family is chosen with the one-standard-error rule, then refitted on all data.
Writes artifacts/models/*.joblib, artifacts/oof/*.csv, metrics.json, registry.json.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from datetime import datetime, timezone

import joblib
import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.model_selection import RandomizedSearchCV, RepeatedStratifiedKFold, StratifiedKFold

from . import calibrate, conformal, config, contract, data, evaluate, models
from .leakage_guard import assert_no_leakage, make_xy

OOF_DIR = config.ARTIFACTS_DIR / "oof"
SIMPLICITY = ["logreg", "rf", "lgbm", "xgb"]  # tie-break order for the one-SE rule


def training_settings(fast: bool) -> dict:
    t = dict(config.settings()["training"])
    fast_over = t.pop("fast")
    if fast:
        t.update(fast_over)
    return t


def cv_signature(target: str, family: str, t: dict) -> str:
    """Hash of everything that determines a nested-CV result, for resumable runs."""
    keys = ["outer_splits", "outer_repeats", "inner_splits", "search_iter", "calibration",
            "calibration_cv"]
    payload = {"target": target, "family": family, "seed": config.seed(),
               "features": data.feature_names(), "space": repr(models.param_space(family)),
               **{k: t[k] for k in keys}}
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()[:16]


def cached_nested_cv(X, y, target: str, family: str, t: dict) -> pd.DataFrame:
    """nested_cv(), reusing artifacts/oof/<target>_<family>.csv when the signature matches."""
    path = OOF_DIR / f"{target.lower()}_{family}.csv"
    sig_path = path.with_suffix(".sig")
    sig = cv_signature(target, family, t)
    if path.exists() and sig_path.exists() and sig_path.read_text().strip() == sig:
        log(f"{target} {family:6s} reusing cached out-of-fold predictions")
        return pd.read_csv(path)
    oof = nested_cv(X, y, family, t)
    oof.to_csv(path, index=False)
    sig_path.write_text(sig)
    return oof


def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)


def _jsonable(params: dict) -> dict:
    return {k.removeprefix("clf__"): (v.item() if isinstance(v, np.generic) else v)
            for k, v in params.items()}


def _search(family: str, t: dict, seed: int) -> RandomizedSearchCV:
    return RandomizedSearchCV(
        models.make_pipeline(family), models.param_space(family), n_iter=t["search_iter"],
        cv=StratifiedKFold(t["inner_splits"], shuffle=True, random_state=seed),
        scoring="roc_auc", n_jobs=-1, random_state=seed, refit=True,
    )


def nested_cv(X: pd.DataFrame, y: pd.Series, family: str, t: dict) -> pd.DataFrame:
    seed = config.seed()
    outer = RepeatedStratifiedKFold(n_splits=t["outer_splits"], n_repeats=t["outer_repeats"],
                                    random_state=seed)
    rows = []
    for i, (tr, te) in enumerate(outer.split(X, y)):
        Xtr, ytr, Xte = X.iloc[tr], y.iloc[tr], X.iloc[te]
        assert_no_leakage(Xtr.columns)
        search = _search(family, t, seed + i).fit(Xtr, ytr)
        p_base = search.best_estimator_.predict_proba(Xte)[:, 1]
        cal = calibrate.calibrated(clone(search.best_estimator_), seed=seed + i).fit(Xtr, ytr)
        p, spread = calibrate.predict_with_spread(cal, Xte)
        rows.append(pd.DataFrame({
            "repeat": i // t["outer_splits"], "fold": i % t["outer_splits"], "idx": X.index[te],
            "y": y.iloc[te].to_numpy(), "p_base": p_base, "p": p, "spread": spread,
            "params": json.dumps(_jsonable(search.best_params_)),
        }))
    return pd.concat(rows, ignore_index=True)


def select_family(fold_aucs: dict[str, pd.Series]) -> str:
    """One-SE rule: the simplest family whose mean AUC is within one standard
    error of the best. Guards against picking a complex model on noise."""
    means = {f: s.mean() for f, s in fold_aucs.items()}
    best = max(means, key=means.get)
    se = fold_aucs[best].std(ddof=1) / np.sqrt(len(fold_aucs[best])) if len(fold_aucs[best]) > 1 else 0
    ok = [f for f in SIMPLICITY if f in means and means[f] >= means[best] - se]
    return ok[0]


def fit_final(X, y, family: str, t: dict):
    seed = config.seed()
    search = _search(family, t, seed).fit(X, y)
    base = search.best_estimator_                       # uncalibrated, for SHAP (module 03)
    cal = calibrate.calibrated(clone(base), seed=seed).fit(X, y)
    return cal, base, _jsonable(search.best_params_)


def train_target(target: str, df: pd.DataFrame, t: dict) -> tuple[dict, pd.DataFrame]:
    X, y = make_xy(df, target)
    OOF_DIR.mkdir(parents=True, exist_ok=True)

    oofs, comparison = {}, {}
    for family in t["families"]:
        start = time.time()
        oof = cached_nested_cv(X, y, target, family, t)
        oofs[family] = oof
        folds = evaluate.fold_metrics(oof)
        lo, hi = evaluate.bootstrap_ci(folds["roc_auc"], t["bootstrap"])
        comparison[family] = {"roc_auc": round(float(folds["roc_auc"].mean()), 4),
                              "ci95": [round(lo, 4), round(hi, 4)],
                              "brier": round(float(folds["brier"].mean()), 4)}
        log(f"{target} {family:6s} AUC {comparison[family]['roc_auc']:.3f} "
            f"[{lo:.3f}, {hi:.3f}]  ({time.time() - start:.0f}s)")

    family = select_family({f: evaluate.fold_metrics(o)["roc_auc"] for f, o in oofs.items()})
    oof = oofs[family]
    log(f"{target}: selected {family}")

    threshold = evaluate.choose_threshold(oof["y"].to_numpy(), oof["p"].to_numpy(), t["min_recall"])
    alpha = config.settings()["conformal"]["alpha"]
    qhat = float(np.median([conformal.conformal_threshold(g["p"], g["y"], alpha)
                            for _, g in oof.groupby("repeat")]))
    per_patient = evaluate.patient_mean(oof)
    r0 = oof[oof["repeat"] == 0]

    cal, base, params = fit_final(X, y, family, t)
    path = config.MODELS_DIR / f"{target.lower()}.joblib"
    config.MODELS_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"target": target, "family": family, "calibrated": cal, "base": base,
                 "params": params, "threshold": threshold, "qhat": qhat,
                 "feature_order": data.feature_names()}, path)

    result = {
        "target": target,
        "n": int(len(y)), "positive_rate": round(float(y.mean()), 4),
        "family": family, "family_label": models.FAMILY_LABELS[family], "params": params,
        "comparison": comparison,
        "metrics_at_0.5": evaluate.summarize(evaluate.fold_metrics(oof, 0.5), t["bootstrap"]),
        "threshold": threshold,
        "metrics_at_threshold": evaluate.summarize(evaluate.fold_metrics(oof, threshold), t["bootstrap"]),
        "calibration": {
            "method": t["calibration"],
            "uncalibrated": calibrate.reliability(r0["y"], r0["p_base"]),
            "calibrated": calibrate.reliability(r0["y"], r0["p"]),
            "brier_uncalibrated": evaluate.summarize(
                evaluate.fold_metrics(oof, 0.5, col="p_base"), t["bootstrap"])["brier"],
        },
        "conformal": {"alpha": alpha, "qhat": round(qhat, 4),
                      **conformal.cross_conformal_coverage(oof[["repeat", "fold", "y", "p"]], alpha)},
        "subgroups": evaluate.subgroups(per_patient, df, threshold),
        "curves": evaluate.curves(oof, threshold),
        "model_path": str(path.relative_to(config.ARTIFACTS_DIR)).replace("\\", "/"),
    }
    return result, per_patient


def coherence_summary(per_patient: dict[str, pd.DataFrame]) -> dict:
    """How often the (independently trained) models disagree, from OOF predictions."""
    overall, vessels = config.overall_target(), config.vessel_ids()
    if not all(t in per_patient for t in [overall, *vessels]):
        return {"evaluated": False}
    p = pd.DataFrame({t: per_patient[t]["p"] for t in [overall, *vessels]})
    flags = p.apply(lambda r: contract.coherence(r[overall], {v: r[v] for v in vessels})["flag"], axis=1)
    y_cad = per_patient[overall]["y"]
    wrong = ((p[overall] >= 0.5).astype(int) != y_cad)
    return {
        "evaluated": True,
        "thresholds": config.settings()["coherence"],
        "flag_rate": round(float(flags.mean()), 4),
        "n_flagged": int(flags.sum()),
        "overall_error_rate_flagged": round(float(wrong[flags].mean()), 4) if flags.any() else None,
        "overall_error_rate_unflagged": round(float(wrong[~flags].mean()), 4),
    }


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--fast", action="store_true", help="use training.fast settings")
    ap.add_argument("--targets", nargs="+", default=config.all_targets())
    ap.add_argument("--families", nargs="+", help="override training.families")
    args = ap.parse_args(argv)

    t = training_settings(args.fast)
    if args.families:
        t["families"] = args.families
    df = pd.read_csv(data.PROCESSED_CSV)
    log(f"training {args.targets} with {t['families']} "
        f"({t['outer_splits']}x{t['outer_repeats']} outer, {t['search_iter']} search iters)")

    results, per_patient = {}, {}
    for target in args.targets:
        results[target], per_patient[target] = train_target(target, df, t)

    version = datetime.now().strftime("%Y-%m-%d") + ("-fast" if args.fast else "")
    metrics = {
        "version": version,
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "mode": "fast" if args.fast else "full",
        "settings": {k: v for k, v in t.items()},
        "targets": results,
        "coherence": coherence_summary(per_patient),
    }
    config.METRICS_JSON.write_text(json.dumps(metrics, indent=2) + "\n", encoding="utf-8")

    registry = {
        "version": version,
        "created": metrics["created"],
        "alpha": config.settings()["conformal"]["alpha"],
        "feature_manifest": "feature_manifest.json",
        "targets": {tg: {"path": r["model_path"], "family": r["family"],
                         "threshold": r["threshold"], "qhat": r["conformal"]["qhat"]}
                    for tg, r in results.items()},
    }
    config.REGISTRY_JSON.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")

    from . import report
    report.main()
    log("done: artifacts/metrics.json, artifacts/registry.json, docs/MODEL_CARD.md")


if __name__ == "__main__":
    main()
