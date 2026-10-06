"""Leakage audit and exploratory summary for module 01.

    python -m src.audit    # needs data/processed/coronary.csv (run python -m src.data first)

Writes:
  artifacts/leakage_audit.csv   single-feature ROC-AUC of every input against every target
  docs/data_report.md           class balance, label consistency, audit table, exclusions
  docs/figures/*.png            balance, vessel correlation, missingness, key distributions
"""
from __future__ import annotations

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.metrics import roc_auc_score  # noqa: E402

from . import config, data  # noqa: E402

SUSPICIOUS_AUC = 0.90
FIG_DIR = config.ROOT / "docs" / "figures"
REPORT_MD = config.ROOT / "docs" / "data_report.md"
AUDIT_CSV = config.ARTIFACTS_DIR / "leakage_audit.csv"
KEY_NUMERIC = ["age", "ef_tte", "fbs", "bp", "esr", "tg"]


def load_processed() -> pd.DataFrame:
    if not data.PROCESSED_CSV.exists():
        raise FileNotFoundError("run `python -m src.data` first")
    return pd.read_csv(data.PROCESSED_CSV)


def single_feature_auc(df: pd.DataFrame) -> pd.DataFrame:
    """Direction-free AUC (max(auc, 1 - auc)) of each feature used alone as a score.
    Categorical features are scored by their in-sample category positive rate."""
    rows = []
    for f in data.features():
        x = df[f["name"]]
        row = {"feature": f["name"], "group": f["group"]}
        for t in data.target_names():
            score = x.map(df.groupby(f["name"])[t].mean()) if f["type"] == "categorical" else x
            auc = roc_auc_score(df[t], score)
            row[t] = round(max(auc, 1 - auc), 3)
        rows.append(row)
    out = pd.DataFrame(rows)
    out["max_auc"] = out[data.target_names()].max(axis=1)
    out["flag"] = out["max_auc"] >= SUSPICIOUS_AUC
    return out.sort_values("max_auc", ascending=False).reset_index(drop=True)


def label_consistency(df: pd.DataFrame) -> dict:
    vessels = config.vessel_ids()
    any_vessel = df[vessels].max(axis=1)
    cad = df[config.overall_target()]
    return {
        "cad_and_vessel": int(((cad == 1) & (any_vessel == 1)).sum()),
        "cad_no_vessel": int(((cad == 1) & (any_vessel == 0)).sum()),
        "normal_with_vessel": int(((cad == 0) & (any_vessel == 1)).sum()),
        "normal_no_vessel": int(((cad == 0) & (any_vessel == 0)).sum()),
        "normal_with_vessel_rows": df.index[(cad == 0) & (any_vessel == 1)].tolist(),
    }


def _figures(df: pd.DataFrame) -> list[str]:
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    targets = data.target_names()
    written = []

    fig, ax = plt.subplots(figsize=(5, 3))
    rates = df[targets].mean()
    ax.bar(targets, rates, color="#c0504d")
    ax.bar(targets, 1 - rates, bottom=rates, color="#d9d9d9")
    for i, r in enumerate(rates):
        ax.text(i, r / 2, f"{r:.0%}", ha="center", color="white", fontsize=9)
    ax.set_ylabel("share of patients"); ax.set_title("Positive rate per target")
    fig.tight_layout(); fig.savefig(FIG_DIR / "target_balance.png", dpi=150); plt.close(fig)
    written.append("target_balance.png")

    fig, ax = plt.subplots(figsize=(4, 3.4))
    corr = df[targets].corr()
    im = ax.imshow(corr, vmin=0, vmax=1, cmap="Reds")
    ax.set_xticks(range(len(targets)), targets); ax.set_yticks(range(len(targets)), targets)
    for i in range(len(targets)):
        for j in range(len(targets)):
            ax.text(j, i, f"{corr.iat[i, j]:.2f}", ha="center", va="center", fontsize=8)
    fig.colorbar(im); ax.set_title("Label correlation")
    fig.tight_layout(); fig.savefig(FIG_DIR / "label_correlation.png", dpi=150); plt.close(fig)
    written.append("label_correlation.png")

    fig, ax = plt.subplots(figsize=(8, 2.2))
    ax.imshow(df[data.feature_names()].isna().T.values[:, :], aspect="auto", cmap="Greys", vmin=0, vmax=1)
    ax.set_yticks([]); ax.set_xlabel("patient"); ax.set_title(
        f"Missing values ({int(df[data.feature_names()].isna().sum().sum())} total)")
    fig.tight_layout(); fig.savefig(FIG_DIR / "missing_values.png", dpi=150); plt.close(fig)
    written.append("missing_values.png")

    fig, axes = plt.subplots(2, 3, figsize=(9, 5))
    labels = {f["name"]: f["label"] for f in data.features()}
    cad = df[config.overall_target()]
    for ax, col in zip(axes.flat, KEY_NUMERIC):
        ax.boxplot([df.loc[cad == 0, col], df.loc[cad == 1, col]], tick_labels=["Normal", "CAD"])
        ax.set_title(labels[col], fontsize=9)
    fig.suptitle("Key measurements by CAD status"); fig.tight_layout()
    fig.savefig(FIG_DIR / "distributions_by_cad.png", dpi=150); plt.close(fig)
    written.append("distributions_by_cad.png")
    return written


def _md_table(df: pd.DataFrame) -> str:
    cols = list(df.columns)
    lines = ["| " + " | ".join(cols) + " |", "|" + "---|" * len(cols)]
    lines += ["| " + " | ".join(str(v) for v in row) + " |" for row in df.itertuples(index=False)]
    return "\n".join(lines)


def report(df: pd.DataFrame, audit: pd.DataFrame, cons: dict, figs: list[str]) -> str:
    reg = data.registry()
    targets = data.target_names()
    balance = pd.DataFrame({
        "target": targets,
        "positives": [int(df[t].sum()) for t in targets],
        "negatives": [int((1 - df[t]).sum()) for t in targets],
        "positive rate": [f"{df[t].mean():.1%}" for t in targets],
    })
    excluded = pd.DataFrame(reg["excluded"])[["source", "reason"]]
    groups = pd.Series([f["group"] for f in data.features()]).value_counts()
    groups = groups.reindex(config.feature_groups()).rename_axis("group").reset_index(name="features")
    flagged = audit[audit["flag"]]
    top = audit.head(12)[["feature", "group", *targets]]

    return f"""# Data report (module 01)

Generated by `python -m src.audit`. Do not edit by hand.

**Dataset:** Extension of Z-Alizadeh Sani, UCI Machine Learning Repository (id {reg['dataset']['uci_id']}, DOI {reg['dataset']['doi']}).
{len(df)} patients, {len(data.feature_names())} model inputs after exclusions, {int(df[data.feature_names()].isna().sum().sum())} missing values.

## Class balance

{_md_table(balance)}

Overall CAD is the majority class, so plain accuracy is misleading. Report ROC-AUC, F1, precision and recall.

## Label consistency

Overall CAD comes from catheterization (`Cath`), and it almost exactly means "at least one stenotic vessel":

| | any vessel stenotic | no vessel stenotic |
|---|---|---|
| CAD | {cons['cad_and_vessel']} | {cons['cad_no_vessel']} |
| Normal | {cons['normal_with_vessel']} | {cons['normal_no_vessel']} |

{cons['normal_with_vessel']} patient(s) (0-based row {', '.join(map(str, cons['normal_with_vessel_rows']))} of the raw file) are labeled Normal while a vessel is labeled stenotic. These rows are kept as recorded. This near-identity is what the coherence layer (module 02) relies on: a high overall CAD estimate with no high vessel estimate is internally inconsistent.

![label correlation](figures/label_correlation.png)

## Leakage guard

- `LAD`, `LCX`, `RCA` and `Cath` are banned as inputs (`config/settings.yaml`), and derived target names are banned as well.
- Model inputs are built from a whitelist, `features.yaml`, in the order recorded in `artifacts/feature_manifest.json`.
- `tests/test_leakage.py` fails if any banned column can reach a model.
- All preprocessing (imputation, scaling, one-hot encoding) is fitted inside CV folds (`src.data.build_preprocessor`).

### Single-feature audit

Each input was scored alone against each target (direction-free ROC-AUC). A value at or above {SUSPICIOUS_AUC} would suggest that a feature encodes the label.
**Flagged features: {len(flagged)}.** {"None of the inputs look like a hidden label." if flagged.empty else "Investigate: " + ", ".join(flagged.feature)}

Top 12 features by maximum AUC:

{_md_table(top)}

The full table is in `artifacts/leakage_audit.csv`.

## Excluded raw columns

{_md_table(excluded)}

## Feature groups

{_md_table(groups)}

`History` and `Symptoms` were added to the five groups in the brief. Chest-pain type, diabetes and hypertension are among the strongest predictors, and none of the original groups fits them.

## Figures

{chr(10).join(f"![{f}](figures/{f})" for f in figs)}
"""


def main() -> None:
    df = load_processed()
    audit = single_feature_auc(df)
    config.ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)
    audit.to_csv(AUDIT_CSV, index=False)
    cons = label_consistency(df)
    figs = _figures(df)
    REPORT_MD.write_text(report(df, audit, cons, figs), encoding="utf-8")
    print(f"audit: {int(audit['flag'].sum())} flagged, top={audit.iloc[0]['feature']} "
          f"({audit.iloc[0]['max_auc']})  -> {REPORT_MD.relative_to(config.ROOT)}")
    print(f"label consistency: {cons}")


if __name__ == "__main__":
    main()
