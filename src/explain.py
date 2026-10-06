"""Explainability for the four models (module 03).

    python -m src.explain     # background sample, feature stats, global SHAP, stability, report

Per-patient pieces used by the API:
  TargetExplainer.explain()  SHAP per original feature, group totals, clinician + patient text
  whatif()                   new probabilities after overriding modifiable inputs
  counterfactual()           smallest modifiable change that moves a target below its threshold

SHAP explains the *uncalibrated* base model (in log-odds for logistic regression,
XGBoost and LightGBM, and in probability for random forest). The calibrated
probability is shown separately. SHAP describes model behavior, not biological cause.
"""
from __future__ import annotations

import itertools
import json
from functools import lru_cache
from typing import Any, Callable

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import shap  # noqa: E402
from scipy.stats import spearmanr  # noqa: E402
from sklearn.base import clone  # noqa: E402
from sklearn.model_selection import StratifiedKFold  # noqa: E402

from . import config, data  # noqa: E402

BACKGROUND_CSV = config.ARTIFACTS_DIR / "shap_background.csv"
STATS_JSON = config.ARTIFACTS_DIR / "feature_stats.json"
GLOBAL_JSON = config.ARTIFACTS_DIR / "shap_global.json"
STABILITY_JSON = config.ARTIFACTS_DIR / "shap_stability.json"
REPORT_MD = config.ROOT / "docs" / "explainability_report.md"
FIG_DIR = config.ROOT / "docs" / "figures"

BACKGROUND_ROWS = 100
CAPTION = "Shows model sensitivity, not medical advice."
UNITS = {"logreg": "log-odds", "xgb": "log-odds", "lgbm": "log-odds", "rf": "probability"}


# ---------------------------------------------------------------- registry helpers

@lru_cache(maxsize=1)
def _spec() -> dict[str, dict]:
    return {f["name"]: f for f in data.features()}


@lru_cache(maxsize=1)
def _target_names_patient() -> dict[str, str]:
    anatomy = json.loads(config.ANATOMY_JSON.read_text(encoding="utf-8"))
    names = {v["id"]: "estimate for the " + v.get("patient_label", v["label"]).lower()
             for v in anatomy["vessels"]}
    return {config.overall_target(): "overall heart estimate", **names}


def range_status(name: str, value) -> str | None:
    rng = _spec()[name].get("normal_range")
    if not rng or value is None or isinstance(value, str) or pd.isna(value):
        return None
    lo, hi = rng
    if lo is not None and value < lo:
        return "below"
    if hi is not None and value > hi:
        return "above"
    return "within"


def _display_value(v):
    if v is None or (not isinstance(v, str) and pd.isna(v)):
        return None
    if isinstance(v, (np.integer, np.floating)):
        v = v.item()
    if isinstance(v, float) and v.is_integer():
        return int(v)
    return v


# ---------------------------------------------------------------- per-target SHAP

class TargetExplainer:
    """SHAP for one fitted Pipeline(pre -> clf), aggregated to registry features."""

    def __init__(self, target: str, pipeline, family: str, background: pd.DataFrame):
        self.target = target
        self.family = family
        self.units = UNITS[family]
        self.pre = pipeline.named_steps["pre"]
        self.clf = pipeline.named_steps["clf"]
        self.columns = list(self.pre.get_feature_names_out())
        self.owner = data.transformed_to_feature(self.columns)
        bg = self._transform(background)
        if family == "logreg":
            self.explainer = shap.LinearExplainer(self.clf, shap.maskers.Independent(bg, max_samples=len(bg)))
        else:
            self.explainer = shap.TreeExplainer(self.clf)
        # Anchor the base value to what the model actually outputs. SHAP's expected_value
        # can be offset by a constant (XGBoost 3.x: output margin != logit(predict_proba)).
        sv_bg = self._class1(self.explainer.shap_values(bg)).sum(axis=1)
        self.base_value = float(np.mean(self._model_output(bg) - sv_bg))

    def _model_output(self, Xt: np.ndarray) -> np.ndarray:
        p = self.clf.predict_proba(Xt)[:, 1]
        if self.units == "probability":
            return p
        p = np.clip(p, 1e-12, 1 - 1e-12)
        return np.log(p / (1 - p))

    def _transform(self, X: pd.DataFrame) -> np.ndarray:
        Xt = self.pre.transform(X)
        return Xt.toarray() if hasattr(Xt, "toarray") else np.asarray(Xt, dtype=float)

    @staticmethod
    def _class1(v, scalar: bool = False):
        """Normalize SHAP outputs across model types and library versions to class 1."""
        if isinstance(v, list):
            v = v[1]
        v = np.asarray(v)
        if scalar:
            return float(v.ravel()[-1])  # class 1 when both classes are given
        if v.ndim == 3:
            v = v[:, :, 1]
        return v

    def shap_frame(self, X: pd.DataFrame) -> pd.DataFrame:
        """rows x registry features. One-hot dummies are summed back to their feature."""
        sv = self._class1(self.explainer.shap_values(self._transform(X)))
        per_col = pd.DataFrame(sv, columns=self.columns, index=X.index)
        return per_col.T.groupby(self.owner).sum().T.reindex(columns=data.feature_names(), fill_value=0.0)

    def explain(self, X_row: pd.DataFrame, top_n: int | None = None) -> dict:
        """Payload for one patient (module 03, section 4)."""
        sv = self.shap_frame(X_row).iloc[0]
        row = X_row.iloc[0]
        feats = []
        for name in data.feature_names():
            v = _display_value(row[name])
            feats.append({"name": name, "value": v, "shap": round(float(sv[name]), 4),
                          "group": _spec()[name]["group"], "range_status": range_status(name, v)})
        feats.sort(key=lambda f: abs(f["shap"]), reverse=True)
        groups = {g: 0.0 for g in config.feature_groups()}
        for f in feats:
            groups[f["group"]] += f["shap"]
        return {
            "groups": {g: round(v, 4) for g, v in groups.items()},
            "features": feats[:top_n] if top_n else feats,
            "text": clinician_text(self.target, feats, self.units),
            "text_patient": patient_text(self.target, feats),
            "base_value": round(self.base_value, 4),
            "units": self.units,
        }


# ---------------------------------------------------------------- wording

def _fmt_value(name: str, value) -> str:
    spec = _spec()[name]
    if value is None:
        return "missing"
    if spec["type"] == "binary":
        return "present" if value == 1 else "absent"
    unit = spec.get("unit")
    return f"{value} {unit}" if unit else str(value)


def clinician_text(target: str, feats: list[dict], units: str, n: int = 3) -> str:
    top = [f for f in feats if f["shap"] != 0][:n]
    if not top:
        return f"No single measurement moved the {target} estimate."
    parts = [f"{_spec()[f['name']]['label']} {_fmt_value(f['name'], f['value'])} "
             f"({f['shap']:+.2f})" for f in top]
    return f"Largest drivers of the {target} estimate ({units}): " + "; ".join(parts) + "."


def _join(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _patient_phrase(f: dict) -> str:
    """Registry patient_text, negated when a yes/no or count finding is absent, so a
    missing finding is never described as if it were present."""
    spec = _spec()[f["name"]]
    text = spec["patient_text"]
    if spec["type"] in ("binary", "ordinal") and f["value"] == 0:
        for article in ("A ", "An "):
            if text.startswith(article):
                text = text[len(article):]
        return "No " + text[0].lower() + text[1:]
    return text


def patient_text(target: str, feats: list[dict]) -> str:
    where = _target_names_patient()[target]
    up = [f for f in feats if f["shap"] > 0][:2]
    down = [f for f in feats if f["shap"] < 0][:1]
    sentences = []
    if up:
        names = [_patient_phrase(f) for f in up]
        names = [names[0]] + [n[0].lower() + n[1:] for n in names[1:]]
        sentences.append(f"{_join(names)} raised the {where} the most.")
    if down:
        n = _patient_phrase(down[0])
        sentences.append(f"{n} lowered it." if up else f"{n} lowered the {where} the most.")
    if not sentences:
        return f"No single measurement stood out for the {where}."
    return " ".join(sentences) + " Please discuss these results with your doctor."


# ---------------------------------------------------------------- what-if and counterfactuals

ProbaFn = Callable[[pd.DataFrame], np.ndarray]


def modifiable_features() -> list[str]:
    return [f["name"] for f in data.features() if f.get("modifiable")]


def whatif(proba_fns: dict[str, ProbaFn], X_row: pd.DataFrame, overrides: dict[str, Any]) -> dict:
    """Probabilities before/after overriding modifiable inputs. Non-modifiable keys are rejected."""
    bad = set(overrides) - set(modifiable_features())
    if bad:
        raise ValueError(f"not modifiable: {sorted(bad)}")
    X_new = X_row.copy()
    for k, v in overrides.items():
        X_new[k] = float(v)
    before = {t: float(fn(X_row)[0]) for t, fn in proba_fns.items()}
    after = {t: float(fn(X_new)[0]) for t, fn in proba_fns.items()}
    return {"before": before, "after": after,
            "deltas": {t: round(after[t] - before[t], 4) for t in proba_fns}, "caption": CAPTION}


def _candidate_values(name: str, current: float, stats: dict) -> list[float]:
    """Grid within the observed data range (no extrapolation), moving only toward
    or within the normal range, so suggestions are never "raise LDL"."""
    spec, st = _spec()[name], stats[name]
    if spec["type"] == "binary":
        return [0.0] if current == 1 else []
    step = spec.get("step", 1)
    lo, hi = st["p01"], st["p99"]
    grid = np.round(np.arange(np.floor(lo / step) * step, hi + step / 2, step), 6)
    nr = spec.get("normal_range") or [None, None]
    n_lo = -np.inf if nr[0] is None else nr[0]
    n_hi = np.inf if nr[1] is None else nr[1]
    if current > n_hi:
        grid = grid[(grid < current) & (grid >= n_lo)]
    elif current < n_lo:
        grid = grid[(grid > current) & (grid <= n_hi)]
    else:
        grid = grid[(grid != current) & (grid >= n_lo) & (grid <= n_hi)]
    return grid.tolist()


def _effort(name: str, frm: float, to: float, stats: dict) -> float:
    if _spec()[name]["type"] == "binary":
        return 1.0
    return abs(to - frm) / max(stats[name]["std"], 1e-9)


def counterfactual(proba_fn: ProbaFn, X_row: pd.DataFrame, threshold: float, stats: dict,
                   max_options: int = 3, pair_grid: int = 5) -> dict:
    """Smallest change in modifiable features (one, then two at a time) that moves the
    probability below `threshold`. Effort = change in standard deviations of the data."""
    current = X_row.iloc[0]
    p0 = float(proba_fn(X_row)[0])
    out = {"threshold": threshold, "current_prob": round(p0, 4), "already_below": p0 < threshold,
           "options": [], "note": "", "caption": CAPTION}
    if p0 < threshold:
        return out

    feats = [n for n in modifiable_features() if not pd.isna(current[n])]
    grids = {n: _candidate_values(n, float(current[n]), stats) for n in feats}
    grids = {n: g for n, g in grids.items() if g}

    candidates: list[list[tuple[str, float]]] = [[(n, v)] for n, g in grids.items() for v in g]
    for a, b in itertools.combinations(grids, 2):
        ga = _thin(grids[a], current[a], pair_grid)
        gb = _thin(grids[b], current[b], pair_grid)
        candidates += [[(a, va), (b, vb)] for va in ga for vb in gb]
    if not candidates:
        return out

    X = pd.concat([X_row] * len(candidates), ignore_index=True)
    for i, changes in enumerate(candidates):
        for n, v in changes:
            X.at[i, n] = v
    p = proba_fn(X)

    hits = []
    for changes, pi in zip(candidates, p):
        if pi < threshold:
            effort = sum(_effort(n, float(current[n]), v, stats) for n, v in changes)
            hits.append((effort, len(changes), changes, float(pi)))
    hits.sort(key=lambda h: (h[0], h[1]))

    seen = set()
    for effort, _, changes, pi in hits:
        key = frozenset(n for n, _ in changes)
        if key in seen:
            continue
        seen.add(key)
        out["options"].append({
            "changes": [{"feature": n, "from": _display_value(current[n]), "to": _display_value(v)}
                        for n, v in changes],
            "new_prob": round(pi, 4), "effort_sd": round(effort, 3)})
        if len(out["options"]) >= max_options:
            break
    if not out["options"]:
        out["note"] = ("No change of one or two modifiable measurements, within the range seen in "
                       "the data, moves this estimate below the threshold.")
    return out


def _thin(grid: list[float], current: float, k: int) -> list[float]:
    """k grid values spread from nearest to farthest from the current value."""
    g = sorted(grid, key=lambda v: abs(v - current))
    if len(g) <= k:
        return g
    idx = np.unique(np.linspace(0, len(g) - 1, k).round().astype(int))
    return [g[i] for i in idx]


# ---------------------------------------------------------------- artifacts used at serving time

def load_background() -> pd.DataFrame:
    return pd.read_csv(BACKGROUND_CSV)[data.feature_names()]


def load_stats() -> dict:
    return json.loads(STATS_JSON.read_text(encoding="utf-8"))


def feature_stats(df: pd.DataFrame) -> dict:
    out = {}
    for f in data.features():
        if f["type"] == "categorical":
            continue
        s = df[f["name"]].astype(float)
        out[f["name"]] = {"min": float(s.min()), "max": float(s.max()), "median": float(s.median()),
                          "std": float(s.std()), "p01": float(s.quantile(0.01)),
                          "p99": float(s.quantile(0.99))}
    return out


class Explainers:
    """One TargetExplainer per registry model, built once (cache at server start)."""

    def __init__(self, predictor):
        bg = load_background()
        self.by_target = {t: TargetExplainer(t, b["base"], b["family"], bg)
                          for t, b in predictor.bundles.items()}

    def explain(self, X_row: pd.DataFrame, top_n: int | None = None) -> dict[str, dict]:
        return {t: e.explain(X_row, top_n) for t, e in self.by_target.items()}


# ---------------------------------------------------------------- offline analysis

def global_importance(expl: TargetExplainer, X: pd.DataFrame) -> dict:
    sv = expl.shap_frame(X)
    feats = sv.abs().mean().sort_values(ascending=False)
    grp = sv.T.groupby(lambda n: _spec()[n]["group"]).sum().T.abs().mean()
    return {"units": expl.units, "base_value": round(expl.base_value, 4),
            "features": {k: round(float(v), 5) for k, v in feats.items()},
            "groups": {g: round(float(grp.get(g, 0.0)), 5) for g in config.feature_groups()}}


def stability(target: str, bundle: dict, X: pd.DataFrame, y: pd.Series, n_splits: int = 5) -> dict:
    """Refit the final configuration on each CV fold, rank features by mean |SHAP| on the
    held-out fold, and compare rankings between folds (Spearman) and top-5 overlap."""
    cv = StratifiedKFold(n_splits, shuffle=True, random_state=config.seed())
    imps, tops = [], []
    for tr, te in cv.split(X, y):
        pipe = clone(bundle["base"]).fit(X.iloc[tr], y.iloc[tr])
        bg = X.iloc[tr].sample(min(BACKGROUND_ROWS, len(tr)), random_state=config.seed())
        e = TargetExplainer(target, pipe, bundle["family"], bg)
        imp = e.shap_frame(X.iloc[te]).abs().mean()
        imps.append(imp)
        tops.append(set(imp.sort_values(ascending=False).index[:5]))
    rhos = [spearmanr(a, b).statistic for a, b in itertools.combinations(imps, 2)]
    jacc = [len(a & b) / len(a | b) for a, b in itertools.combinations(tops, 2)]
    freq = pd.Series([f for t in tops for f in t]).value_counts()
    mean_rho = float(np.nanmean(rhos))
    verdict = "stable" if mean_rho >= 0.7 else "moderately stable" if mean_rho >= 0.5 else "unstable"
    return {"spearman_mean": round(mean_rho, 3), "spearman_min": round(float(np.nanmin(rhos)), 3),
            "top5_jaccard_mean": round(float(np.mean(jacc)), 3),
            "top5_frequency": {k: int(v) for k, v in freq.items()}, "folds": n_splits,
            "verdict": verdict}


def _figures(expls: dict[str, TargetExplainer], X: pd.DataFrame, glob: dict) -> list[str]:
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    labels = [_spec()[n]["label"] for n in data.feature_names()]
    X_plot = X.copy()
    for c in data.columns_by_type("categorical"):
        X_plot[c] = X_plot[c].astype("category").cat.codes
    written = []
    for t, e in expls.items():
        sv = e.shap_frame(X)
        shap.summary_plot(sv.values, X_plot.values.astype(float), feature_names=labels,
                          max_display=12, show=False, plot_size=(7, 5))
        plt.title(f"{t}: SHAP summary ({e.units})", fontsize=10)
        plt.tight_layout(); plt.savefig(FIG_DIR / f"shap_summary_{t.lower()}.png", dpi=130); plt.close("all")
        written.append(f"shap_summary_{t.lower()}.png")

    groups = config.feature_groups()
    fig, ax = plt.subplots(figsize=(7, 3.4))
    w = 0.8 / len(expls)
    for j, t in enumerate(expls):
        vals = np.array([glob[t]["groups"][g] for g in groups])
        ax.bar(np.arange(len(groups)) + j * w, vals / vals.sum(), w, label=t)
    ax.set_xticks(np.arange(len(groups)) + 0.4 - w / 2, groups, fontsize=8)
    ax.set_ylabel("share of mean |SHAP|"); ax.set_title("Grouped contributions per model"); ax.legend(fontsize=8)
    fig.tight_layout(); fig.savefig(FIG_DIR / "shap_groups.png", dpi=150); plt.close(fig)
    written.append("shap_groups.png")
    return written


def _lime() -> str:
    """LIME cross-check section, if `python -m src.lime_check` has been run."""
    path = config.ARTIFACTS_DIR / "lime_check.json"
    if not path.exists():
        return "## LIME cross-check\n\nNot run yet: `python -m src.lime_check`."
    from .lime_check import lime_section
    return lime_section(json.loads(path.read_text(encoding="utf-8")))


def _report(glob: dict, stab: dict, figs: list[str], version: str) -> str:
    rows = []
    for t, g in glob.items():
        top = list(g["features"])[:5]
        rows.append(f"| {t} | {g['units']} | " + ", ".join(_spec()[n]["label"] for n in top) + " |")
    groups = config.feature_groups()
    grows = []
    for t, g in glob.items():
        total = sum(g["groups"].values()) or 1
        grows.append(f"| {t} | " + " | ".join(f"{g['groups'][x] / total:.0%}" for x in groups) + " |")
    srows = [f"| {t} | {s['spearman_mean']:.2f} (min {s['spearman_min']:.2f}) | "
             f"{s['top5_jaccard_mean']:.2f} | {s['verdict']} |" for t, s in stab.items()]
    return f"""# Explainability report (module 03)

Generated by `python -m src.explain` for model version **{version}**. Do not edit by hand.

> SHAP describes **model behavior**, not biological cause. The what-if and counterfactual tools show
> **model sensitivity, not medical advice**.

## Method

- SHAP is computed separately for each of the four models, so clicking the LAD shows LAD-specific drivers.
- It explains the uncalibrated base model: `LinearExplainer` (with a {BACKGROUND_ROWS}-patient background) for
  logistic regression, and `TreeExplainer` for tree models. The calibrated probability is shown separately.
- One-hot columns (bundle branch block) are summed back to the original feature. Group totals are sums of
  feature SHAP values, and `tests/test_explain.py` checks this.
- Units are log-odds for logistic regression, XGBoost and LightGBM, and probability for random forest.

## Top drivers per model (mean |SHAP|, all patients)

| Model | Units | Top 5 features |
|---|---|---|
{chr(10).join(rows)}

## Grouped contributions (share of mean |SHAP|)

| Model | {" | ".join(groups)} |
|---|{"---|" * len(groups)}
{chr(10).join(grows)}

![groups](figures/shap_groups.png)

## Explanation stability

The final configuration was refitted on each of 5 folds, and features were ranked by mean |SHAP| on the
held-out fold. Rankings are compared pairwise (Spearman ρ), along with the overlap of the top-5 features (Jaccard).

| Model | Spearman ρ | Top-5 Jaccard | Verdict |
|---|---|---|---|
{chr(10).join(srows)}

ρ ≥ 0.7 is called stable, and 0.5–0.7 moderately stable. Rankings of low-importance features are noisy on
~240 training patients. The top drivers are what the dashboard shows first.

## What-if and counterfactuals

- Only features marked `modifiable: true` in `features.yaml` get sliders: {", ".join(modifiable_features())}.
- The counterfactual search tries single-feature changes and then pairs. Values stay within the observed 1st–99th
  percentile of the data (no extrapolation) and only move toward, or stay within, the normal range. It
  returns the smallest change, measured in standard deviations, that moves the probability below the target's threshold.
- The models learn associations. Moving a slider does not mean an intervention would lower real risk.

{_lime()}

## Figures

{chr(10).join(f"![{f}](figures/{f})" for f in figs)}
"""


def main() -> None:
    from .inference import Predictor
    from .leakage_guard import make_xy

    df = pd.read_csv(data.PROCESSED_CSV)
    X = df[data.feature_names()]
    X.sample(BACKGROUND_ROWS, random_state=config.seed()).to_csv(BACKGROUND_CSV, index=False)
    STATS_JSON.write_text(json.dumps(feature_stats(df), indent=2) + "\n", encoding="utf-8")

    pred = Predictor()
    expls = Explainers(pred).by_target
    glob = {t: global_importance(e, X) for t, e in expls.items()}
    GLOBAL_JSON.write_text(json.dumps({"version": pred.version, "targets": glob}, indent=2) + "\n",
                           encoding="utf-8")

    stab = {}
    for t, b in pred.bundles.items():
        Xt, yt = make_xy(df, t)
        stab[t] = stability(t, b, Xt, yt)
        print(f"{t}: stability rho={stab[t]['spearman_mean']} ({stab[t]['verdict']})")
    STABILITY_JSON.write_text(json.dumps(stab, indent=2) + "\n", encoding="utf-8")

    figs = _figures(expls, X, glob)
    REPORT_MD.write_text(_report(glob, stab, figs, pred.version), encoding="utf-8")
    print(f"wrote {REPORT_MD.relative_to(config.ROOT)}")


if __name__ == "__main__":
    main()
