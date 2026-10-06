// 03 Model trust: headline numbers, operating-point bars, ROC and calibration plots, a subgroup heatmap,
// then the deeper evaluation. Every exact number stays available behind "Show numbers".
import { useEffect, useState } from "react";
import { getMetrics } from "../api/client";
import type { MetricsResponse, TargetMetrics } from "../api/types";
import { pct } from "../features";
import { heat, InfoTip, Title } from "./charts";
import { Evaluation } from "./Evaluation";
import { GuidelineEvidence } from "./Guideline";
import { Plot } from "./Plot";

const ci = (m: { mean: number; ci95: [number, number] }, p = false) =>
  p ? `${pct(m.mean)} (${pct(m.ci95[0])}–${pct(m.ci95[1])})` : `${m.mean.toFixed(2)} (${m.ci95[0].toFixed(2)}–${m.ci95[1].toFixed(2)})`;

/** One horizontal 0–100% bar with its CI as a lighter band. */
function MiniBar({ m, label }: { m: { mean: number; ci95?: [number, number] }; label: string }) {
  return (
    <span className="mb" title={`${label}: ${m.ci95 ? ci(m as { mean: number; ci95: [number, number] }, true) : pct(m.mean, 1)}`}>
      <span className="mb-track">
        {m.ci95 && <span className="mb-ci" style={{ left: `${m.ci95[0] * 100}%`, width: `${(m.ci95[1] - m.ci95[0]) * 100}%` }} />}
        <span className="mb-fill" style={{ width: `${m.mean * 100}%` }} />
      </span>
      <span className="mb-num">{pct(m.mean)}</span>
    </span>
  );
}

export function TrustTab({ online }: { online: boolean | null }) {
  const [m, setM] = useState<MetricsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!online) return;
    getMetrics().then(setM).catch((e: Error) => setErr(e.message));
  }, [online]);

  if (!online) return <p className="muted">Model metrics are served by the API. Start it with <code>python tasks.py serve</code>.</p>;
  if (err) return <p className="field-error" role="alert">Could not load metrics: {err}</p>;
  if (!m) return <div className="skeleton-block" aria-busy="true" aria-label="Loading metrics" />;

  const T = Object.values(m.targets) as TargetMetrics[];
  const first = T[0];
  const weak = T.filter((t) => t["metrics_at_0.5"].roc_auc.mean < 0.8).map((t) => t.target);
  return (
    <div className="trust">
      <p className="trust-badges">
        <span className="chip">Out-of-fold only</span>
        <span className="chip">Nested {m.settings.outer_splits}×{m.settings.outer_repeats} CV</span>
        <span className="chip">95% CIs</span>
        <span className="chip">Model {m.version}</span>
        <InfoTip>
          Every number on this tab comes from patients the model never saw: nested, repeated cross-validation with no tuning on test folds.
          {weak.length > 0 && ` ${weak.join(" and ")} ${weak.length > 1 ? "are" : "is"} harder to predict from routine data; their learning curves still rise, and these models mark more patients Uncertain rather than guessing.`}
        </InfoTip>
      </p>

      <dl className="glance" aria-label="Results at a glance">
        {T.map((t) => {
          const a = t["metrics_at_0.5"].roc_auc;
          return (
            <div key={t.target}>
              <dt>{t.target} · ROC-AUC</dt>
              <dd>{a.mean.toFixed(2)}<small>{a.ci95[0].toFixed(2)}–{a.ci95[1].toFixed(2)} · {t.family_label}</small></dd>
            </div>
          );
        })}
      </dl>

      <GuidelineEvidence />

      <section className="vt-card">
        <Title info={<>At each model's threshold (chosen so recall stays ≥ {pct(m.settings.min_recall)}: a missed narrowing costs more than a false alarm).
          Light band = 95% CI. Coverage = how often the conformal set contains the true outcome (target {pct(1 - first.conformal.alpha)}).
          Uncertain = share of patients for whom both outcomes stay possible.</>}>Operating point</Title>
        <div className="op-grid" role="table" aria-label="Operating point per model">
          <div className="op-head" role="row">
            <span role="columnheader">Estimate</span><span role="columnheader">Recall</span><span role="columnheader">Precision</span>
            <span role="columnheader">Coverage</span><span role="columnheader">Uncertain</span><span role="columnheader">Threshold</span>
          </div>
          {T.map((t) => (
            <div key={t.target} className="op-row" role="row">
              <span className="op-name" role="rowheader">{t.target}</span>
              <MiniBar m={t.metrics_at_threshold.recall} label="Recall" />
              <MiniBar m={t.metrics_at_threshold.precision} label="Precision" />
              <MiniBar m={{ mean: t.conformal.coverage }} label="Coverage" />
              <MiniBar m={{ mean: t.conformal.uncertain_rate }} label="Uncertain" />
              <span className="op-thr">{pct(t.threshold)}</span>
            </div>
          ))}
        </div>
      </section>

      <div className="plots">
        <Plot
          title="ROC curves"
          xLabel="False positive rate"
          yLabel="True positive rate"
          desc={`ROC curves. AUC: ${T.map((t) => `${t.target} ${t["metrics_at_0.5"].roc_auc.mean.toFixed(2)}`).join(", ")}.`}
          series={T.map((t) => ({ name: t.target, x: t.curves.roc.fpr, y: t.curves.roc.tpr }))}
        />
        <Plot
          title="Calibration"
          xLabel="Predicted probability"
          yLabel="Observed rate"
          desc="Reliability curves: points near the diagonal mean predicted probabilities match observed rates."
          series={T.map((t) => ({ name: t.target, x: t.calibration.calibrated.mean_predicted, y: t.calibration.calibrated.fraction_positive, points: true }))}
        />
        <section className="vt-card subgroup-card">
          <Title info="ROC-AUC per subgroup (per-patient out-of-fold estimates). Hatched cells: too small to judge (fewer than 40 patients or 10 of either class).">
            Subgroups
          </Title>
          <div className="heatmap" style={{ gridTemplateColumns: `minmax(90px, auto) repeat(${T.length}, 1fr)` }} role="table" aria-label="ROC-AUC by subgroup">
            <span role="columnheader" />
            {T.map((t) => <span key={t.target} className="hm-col" role="columnheader">{t.target}</span>)}
            {first.subgroups.map((g, i) => (
              <div key={`${g.subgroup}-${g.level}`} className="hm-rowwrap" role="row">
                <span className="hm-row" role="rowheader">{g.subgroup === "sex" ? g.level : `age ${g.level}`} <small>n={g.n}</small></span>
                {T.map((t) => {
                  const sg = t.subgroups[i];
                  const v = sg.roc_auc ?? 0.5;
                  return (
                    <span key={t.target} role="cell" className={`hm-cell ${sg.small ? "small-group" : ""}`}
                      style={heat((v - 0.7) * 3.3)} title={`${t.target} ${g.level}: AUC ${sg.roc_auc?.toFixed(2) ?? "n/a"}, recall ${sg.recall !== null ? pct(sg.recall) : "n/a"}${sg.small ? " (too small to judge)" : ""}`}>
                      {sg.roc_auc?.toFixed(2) ?? "–"}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </div>

      <details className="numbers">
        <summary>Show numbers</summary>
        <div className="table-scroll">
          <table className="metrics-table compact">
            <thead>
              <tr>
                <th scope="col">Estimate</th><th scope="col">Model</th><th scope="col">ROC-AUC</th><th scope="col">Brier</th>
                <th scope="col">Threshold</th><th scope="col">Recall</th><th scope="col">Precision</th><th scope="col">Coverage</th><th scope="col">Uncertain</th>
              </tr>
            </thead>
            <tbody>
              {T.map((t) => (
                <tr key={t.target}>
                  <th scope="row">{t.target}</th>
                  <td>{t.family_label}</td>
                  <td className="tabular">{ci(t["metrics_at_0.5"].roc_auc)}</td>
                  <td className="tabular">{ci(t["metrics_at_0.5"].brier)}</td>
                  <td className="tabular">{pct(t.threshold)}</td>
                  <td className="tabular">{ci(t.metrics_at_threshold.recall, true)}</td>
                  <td className="tabular">{ci(t.metrics_at_threshold.precision, true)}</td>
                  <td className="tabular">{pct(t.conformal.coverage, 1)}</td>
                  <td className="tabular">{pct(t.conformal.uncertain_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>

      <Evaluation />

      <section className="limits" aria-labelledby="limits-title">
        <Title info="Stated in the app, the docs and the video.">
          <span id="limits-title">Known limits</span>
        </Title>
        <ul className="limit-chips">
          <li><span aria-hidden="true">🏥</span> {first.n} patients · one center · no external validation</li>
          <li><span aria-hidden="true">🫀</span> Vessel-level labels · 3D coloring is schematic</li>
          <li><span aria-hidden="true">⇄</span> Four separate models · disagreements flagged</li>
          <li><span aria-hidden="true">≈</span> Explanations = associations, not causes</li>
        </ul>
      </section>
    </div>
  );
}
