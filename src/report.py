"""Figures and MODEL_CARD.md from artifacts/metrics.json (module 02).

    python -m src.report     # regenerate without retraining
"""
from __future__ import annotations

import json

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

from . import config, data, models  # noqa: E402

FIG_DIR = config.ROOT / "docs" / "figures"
CARD = config.ROOT / "docs" / "MODEL_CARD.md"
COLORS = {"CAD": "#444444", "LAD": "#c0504d", "LCX": "#e39b2d", "RCA": "#4f81bd"}


def _fmt(m: dict) -> str:
    return f"{m['mean']:.2f} [{m['ci95'][0]:.2f}, {m['ci95'][1]:.2f}]"


def figures(metrics: dict) -> None:
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    targets = metrics["targets"]

    fig, ax = plt.subplots(figsize=(4.8, 4.4))
    for t, r in targets.items():
        auc = r["metrics_at_0.5"]["roc_auc"]
        ax.plot(r["curves"]["roc"]["fpr"], r["curves"]["roc"]["tpr"], color=COLORS.get(t),
                label=f"{t}  AUC {_fmt(auc)}")
    ax.plot([0, 1], [0, 1], ":", color="#999")
    ax.set_xlabel("False positive rate"); ax.set_ylabel("True positive rate")
    ax.set_title("ROC (out-of-fold, repeat 1)"); ax.legend(fontsize=8, loc="lower right")
    fig.tight_layout(); fig.savefig(FIG_DIR / "roc.png", dpi=150); plt.close(fig)

    fig, axes = plt.subplots(1, len(targets), figsize=(3.2 * len(targets), 3.2), squeeze=False)
    for ax, (t, r) in zip(axes[0], targets.items()):
        for key, style in [("uncalibrated", "o--"), ("calibrated", "s-")]:
            c = r["calibration"][key]
            ax.plot(c["mean_predicted"], c["fraction_positive"], style, ms=4,
                    label=f"{key} (Brier {c['brier']:.3f})")
        ax.plot([0, 1], [0, 1], ":", color="#999")
        ax.set_title(t); ax.set_xlabel("predicted"); ax.legend(fontsize=6.5)
    axes[0][0].set_ylabel("observed")
    fig.suptitle("Reliability before and after calibration"); fig.tight_layout()
    fig.savefig(FIG_DIR / "calibration.png", dpi=150); plt.close(fig)

    fams = list(next(iter(targets.values()))["comparison"])
    fig, ax = plt.subplots(figsize=(6.4, 3.4))
    w = 0.8 / len(fams)
    for j, f in enumerate(fams):
        xs = [i + j * w for i in range(len(targets))]
        means = [r["comparison"][f]["roc_auc"] for r in targets.values()]
        errs = [[m - r["comparison"][f]["ci95"][0] for m, r in zip(means, targets.values())],
                [r["comparison"][f]["ci95"][1] - m for m, r in zip(means, targets.values())]]
        ax.bar(xs, means, w, yerr=errs, capsize=2, label=models.FAMILY_LABELS[f])
    ax.set_xticks([i + 0.4 - w / 2 for i in range(len(targets))], list(targets))
    ax.set_ylim(0.5, 1); ax.set_ylabel("ROC-AUC (nested CV)"); ax.legend(fontsize=7, ncol=2)
    ax.set_title("Model families compared")
    fig.tight_layout(); fig.savefig(FIG_DIR / "model_comparison.png", dpi=150); plt.close(fig)


def _table(header: list[str], rows: list[list]) -> str:
    out = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    out += ["| " + " | ".join(str(c) for c in r) + " |" for r in rows]
    return "\n".join(out)


def model_card(metrics: dict) -> str:
    T = metrics["targets"]
    s = metrics["settings"]
    reg = data.registry()

    perf = _table(
        ["Target", "Model", "ROC-AUC", "Brier", "Threshold", "Recall", "Precision", "F1", "Accuracy"],
        [[t, r["family_label"], _fmt(r["metrics_at_0.5"]["roc_auc"]), _fmt(r["metrics_at_0.5"]["brier"]),
          f"{r['threshold']:.2f}", _fmt(r["metrics_at_threshold"]["recall"]),
          _fmt(r["metrics_at_threshold"]["precision"]), _fmt(r["metrics_at_threshold"]["f1"]),
          _fmt(r["metrics_at_threshold"]["accuracy"])] for t, r in T.items()])
    perf05 = _table(
        ["Target", "Recall @0.5", "Precision @0.5", "F1 @0.5", "Accuracy @0.5"],
        [[t, *(_fmt(r["metrics_at_0.5"][m]) for m in ["recall", "precision", "f1", "accuracy"])]
         for t, r in T.items()])
    comp = _table(
        ["Target", *(models.FAMILY_LABELS[f] for f in next(iter(T.values()))["comparison"])],
        [[t, *(f"{c['roc_auc']:.3f} [{c['ci95'][0]:.2f}, {c['ci95'][1]:.2f}]"
               + (" ✓" if f == r["family"] else "") for f, c in r["comparison"].items())]
         for t, r in T.items()])
    calib = _table(
        ["Target", "Brier uncalibrated", "Brier calibrated"],
        [[t, _fmt(r["calibration"]["brier_uncalibrated"]), _fmt(r["metrics_at_0.5"]["brier"])]
         for t, r in T.items()])
    conf = _table(
        ["Target", "q̂", "Measured coverage", "Uncertain rate"],
        [[t, f"{r['conformal']['qhat']:.3f}", f"{r['conformal']['coverage']:.1%}",
          f"{r['conformal']['uncertain_rate']:.1%}"] for t, r in T.items()])
    sub_rows = []
    for t, r in T.items():
        for g in r["subgroups"]:
            sub_rows.append([t, f"{g['subgroup']}: {g['level']}", g["n"], g["positives"],
                             "n/a" if g["roc_auc"] is None else f"{g['roc_auc']:.2f}",
                             "n/a" if g["recall"] is None else f"{g['recall']:.2f}",
                             "⚠ small" if g["small"] else ""])
    subs = _table(["Target", "Subgroup", "n", "Positives", "ROC-AUC", "Recall", "Note"], sub_rows)
    coh = metrics["coherence"]
    if coh.get("evaluated"):
        err_f = coh["overall_error_rate_flagged"]
        err_f = "n/a" if err_f is None else f"{err_f:.1%}"
        coh_txt = (f"On out-of-fold predictions, {coh['n_flagged']} patients ({coh['flag_rate']:.1%}) were "
                   f"flagged (thresholds: high ≥ {coh['thresholds']['high']}, low ≤ {coh['thresholds']['low']}). "
                   f"The overall-CAD error rate was {err_f} on flagged patients and "
                   f"{coh['overall_error_rate_unflagged']:.1%} on unflagged ones.")
    else:
        coh_txt = "Not evaluated (not all four targets were trained)."

    return f"""# Model card: CoronaryTwin risk models

Generated by `python -m src.report` from `artifacts/metrics.json`. Do not edit by hand.
Version **{metrics['version']}** ({metrics['mode']} run, {metrics['created']}).

> **For decision support and educational purposes only. Not a substitute for formal
> diagnostic imaging or clinical judgment.**

## 1. Model details

Four independent binary classifiers: overall CAD, plus ≥50% stenosis in the LAD, LCX and RCA.
Each is a scikit-learn pipeline (imputation → scaling / one-hot → classifier), wrapped in Platt
({s['calibration']}) calibration with a {s['calibration_cv']}-fold ensemble. Candidate families were
{", ".join(models.FAMILY_LABELS[f] for f in s['families'])}. The family for each target was chosen with
the one-standard-error rule: the simplest family whose mean nested-CV AUC is within one SE of the best.

## 2. Intended use

- **In scope:** education, demonstration and decision *support* for clinicians exploring how routine
  clinical measurements relate to coronary findings.
- **Out of scope:** diagnosis, triage or treatment decisions, and any use on patients unlike the training population.

## 3. Data

{metrics['targets'][next(iter(T))]['n']} patients from the Extension of Z-Alizadeh Sani dataset
(UCI id {reg['dataset']['uci_id']}, DOI {reg['dataset']['doi']}), all from a single source.
{len(data.feature_names())} inputs in 7 groups; `LAD`, `LCX`, `RCA` and `Cath` are excluded by a tested leakage guard.
Positive rates: {", ".join(f"{t} {r['positive_rate']:.1%}" for t, r in T.items())}. See `docs/data_report.md`.

## 4. Evaluation method

- **Nested, repeated, stratified CV:** {s['outer_splits']}×{s['outer_repeats']} outer folds for performance,
  and an inner {s['inner_splits']}-fold `RandomizedSearchCV` ({s['search_iter']} candidates, ROC-AUC) for
  hyperparameters. Preprocessing, tuning and calibration all happen inside the outer-training part.
- **Intervals:** mean over outer folds, with a 95% bootstrap CI ({s['bootstrap']} resamples of fold-level values).
  Folds from different repeats share patients, so the intervals are approximate.
- **Threshold:** the highest cut-off with out-of-fold recall ≥ {s['min_recall']:.0%}. Screening favors recall,
  because a missed stenosis costs more than a false alarm. The threshold was chosen on the same out-of-fold
  predictions it is evaluated on, so the metrics at that threshold are mildly optimistic.

## 5. Performance

Discrimination and calibration (ROC-AUC and Brier do not depend on the threshold). Metrics are
computed at each target's chosen threshold:

{perf}

At the default 0.5 cut-off, for comparison:

{perf05}

Model families compared (nested-CV ROC-AUC, ✓ = selected):

{comp}

![ROC](figures/roc.png)
![Model comparison](figures/model_comparison.png)

### Calibration

{calib}

![Calibration](figures/calibration.png)

### Conformal prediction (α = {T[next(iter(T))]['conformal']['alpha']}, target coverage {1 - T[next(iter(T))]['conformal']['alpha']:.0%})

Coverage was measured with cross-conformal evaluation: each fold's q̂ was computed from the other folds'
out-of-fold scores. A prediction set containing both labels is shown as **Uncertain**.

{conf}

### Coherence between models

{coh_txt}

## 6. Subgroups

Metrics use per-patient out-of-fold probabilities (averaged over repeats) at each target's threshold.
Groups marked ⚠ have fewer than 40 patients or fewer than 10 of either class, and are too small to judge.

{subs}

## 7. Limitations

- A single source with only ~300 patients, and **no external validation**. Performance on other populations is unknown.
- The labels are vessel-level. There is no lesion or segment location, so the 3D coloring is **schematic**.
- SHAP explanations (module 03) describe model behavior, not biological cause.
- Model selection used the same outer folds that are reported, which adds a small optimistic bias.
- The four models are trained independently and can disagree. The coherence flag makes this visible but does not resolve it.

## 8. Ethical considerations

- There is a risk of over-reliance. The UI shows uncertainty, conformal "Uncertain" states and a persistent disclaimer.
- By default, no patient data is stored by the API.
- Subgroup gaps must be read with the small group sizes above in mind.
"""


def main() -> None:
    metrics = json.loads(config.METRICS_JSON.read_text(encoding="utf-8"))
    figures(metrics)
    CARD.write_text(model_card(metrics), encoding="utf-8")
    print(f"wrote {CARD.relative_to(config.ROOT)} and figures")


if __name__ == "__main__":
    main()
