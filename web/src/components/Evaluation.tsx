// Speciality S4, the deeper half of the Model trust tab, as charts: evidence tiles for the special
// features, a dot strip comparing model families, an ablation heatmap, decision and learning curves.
// All read from artifacts/experiments.json (GET /experiments); exact numbers sit behind "Show numbers".
import { useEffect, useState } from "react";
import { getExperiments } from "../api/client";
import type { ExperimentsResponse } from "../api/types";
import { pct } from "../features";
import { heat, InfoTip, Title } from "./charts";
import { Plot } from "./Plot";
import { Segmented } from "./ui";

const signed = (v: number, d = 3) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;
const ciText = (c: [number, number]) => `${signed(c[0])} to ${signed(c[1])}`;
const FAMILY_SHORT: Record<string, string> = { logreg: "LR", rf: "RF", xgb: "XGB", lgbm: "LGBM" };

function Tile({ big, small, label, info }: { big: string; small?: string; label: string; info: string }) {
  return (
    <div className="ev-tile">
      <span className="ev-big">{big}{small && <small>{small}</small>}</span>
      <span className="ev-label">{label}<InfoTip>{info}</InfoTip></span>
    </div>
  );
}

export function Evaluation() {
  const [x, setX] = useState<ExperimentsResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dcaTarget, setDcaTarget] = useState<string>("CAD");

  useEffect(() => {
    getExperiments().then(setX).catch((e: Error) => setErr(e.message));
  }, []);

  if (err) return <p className="muted small">Deeper evaluation not available ({err}). Run <code>python tasks.py experiments</code>.</p>;
  if (!x) return <div className="skeleton-block" aria-busy="true" aria-label="Loading evaluation" />;

  const targets = Object.keys(x.targets);
  const families = Object.keys(x.targets[targets[0]].comparison);
  const groups = Object.keys(x.targets[targets[0]].refit.ablation);
  const dca = x.targets[dcaTarget] ?? x.targets[targets[0]];
  const dcaMin = Math.min(-0.1, ...dca.decision.model);
  const flips = Math.max(...Object.values(x.robustness).map((r) => r["10pct_sd"]?.likely_unlikely_flip_rate ?? 0));
  const lime = x.lime ? Object.values(x.lime.targets).map((r) => r.top3_overlap) : null;

  const anyBetter = targets.some((t) => Object.values(x.targets[t].comparison).some((c) => !c.selected && c.ci95[0] > 0));
  // Dot strip domain for the family comparison.
  const aucs = targets.flatMap((t) => families.map((f) => x.targets[t].comparison[f].auc));
  const lo = Math.floor(Math.min(...aucs) * 20) / 20, hi = Math.ceil(Math.max(...aucs) * 20) / 20;
  const sx = (v: number) => ((v - lo) / (hi - lo)) * 100;

  return (
    <section className="evaluation" aria-labelledby="eval-title">
      <Title info={`From src/experiments.py (${x.mode} run, ${x.created.slice(0, 10)}). Refit experiments use each selected model family with its final settings across ${x.targets[targets[0]].refit.folds} held-out folds.`}>
        <span id="eval-title">Deeper evaluation</span>
      </Title>

      <div className="ev-tiles">
        <Tile big={pct(x.nextbest.top_is_best_test)} small=" vs 33%" label="Next best test picks the most informative test"
          info={`ECG, Echo and Labs blanked for ${x.nextbest.n} real patients: the top-ranked test was the single most informative one ${pct(x.nextbest.top_is_best_test)} of the time (chance 33%), and brought the estimate within ${x.nextbest.mean_gap.top.toFixed(3)} of the full-record estimate (random other test: ${x.nextbest.mean_gap.random.toFixed(3)}).`} />
        <Tile big={pct(x.ood.synthetic_extreme_detection)} small={` · ${pct(x.ood.false_alarm_rate_training, 1)} false alarms`} label="Out-of-range inputs caught"
          info={`Fires on ${pct(x.ood.false_alarm_rate_training, 1)} of real training patients and on ${pct(x.ood.synthetic_extreme_detection)} of synthetic patients with a value beyond the training range. Deliberately conservative for odd combinations of normal-looking values (${pct(x.ood.shuffled_combination_detection)} of shuffled patients flagged).`} />
        {lime && (
          <Tile big={`${pct(Math.min(...lime))}–${pct(Math.max(...lime))}`} label="LIME agrees with SHAP (top-3)"
            info={`On ${x.lime!.n_patients} patients per model, LIME and SHAP share this share of their top-3 drivers (chance about 6%), so the explanations are not an artifact of one method.`} />
        )}
        <Tile big={pct(flips)} label="Likely↔Unlikely flips under 10% noise"
          info="Gaussian noise of 10% of each numeric measurement's spread, added to all 303 patients: no estimate flips between Likely and Unlikely." />
      </div>

      <div className="ev-grid">
        <section className="vt-card">
          <Title info={`Cross-validated ROC-AUC of each model family on the same patients. Filled dot = the family in use (simplest one within one standard error of the best). ${anyBetter ? "Paired bootstrap: some families score reliably higher; see Show numbers." : "Paired bootstrap: no other family is reliably better."}`}>
            Model families
          </Title>
          <div className="strip" role="img" aria-label={targets.map((t) => `${t}: ${families.map((f) => `${FAMILY_SHORT[f] ?? f} ${x.targets[t].comparison[f].auc.toFixed(3)}`).join(", ")}`).join(". ")}>
            {targets.map((t) => (
              <div key={t} className="strip-row">
                <span className="strip-label">{t}</span>
                <span className="strip-track">
                  {families.map((f) => {
                    const c = x.targets[t].comparison[f];
                    return (
                      <span key={f} className={`strip-dot fam-${f} ${c.selected ? "is-sel" : ""}`} style={{ left: `${sx(c.auc)}%` }}
                        title={`${c.label}: ${c.auc.toFixed(3)}${c.selected ? " (in use)" : ` (Δ ${signed(c.delta_vs_selected)}, CI ${ciText(c.ci95)})`}`} />
                    );
                  })}
                </span>
              </div>
            ))}
            <div className="strip-row strip-axis" aria-hidden="true">
              <span />
              <span className="strip-track">{[lo, (lo + hi) / 2, hi].map((v) => <span key={v} style={{ left: `${sx(v)}%` }}>{v.toFixed(2)}</span>)}</span>
            </div>
            <p className="strip-legend" aria-hidden="true">
              {families.map((f) => <span key={f}><span className={`strip-dot fam-${f}`} />{FAMILY_SHORT[f] ?? f}</span>)}
              <span><span className="strip-dot is-sel" />in use</span>
            </p>
          </div>
        </section>

        <section className="vt-card">
          <Title info="AUC change when one measurement group is blanked. Teal = the group helps (removing it hurts); bold = reliable (whole 95% CI below zero). The groups the models lean on are the ones whose removal hurts.">
            What each group adds
          </Title>
          <div className="heatmap" style={{ gridTemplateColumns: `52px repeat(${groups.length}, 1fr)` }} role="table" aria-label="Ablation: AUC change per removed group">
            <span role="columnheader" />
            {groups.map((g) => <span key={g} className="hm-col" role="columnheader" title={g}>{g.slice(0, 5)}</span>)}
            {targets.map((t) => (
              <div key={t} className="hm-rowwrap" role="row">
                <span className="hm-row" role="rowheader">{t}</span>
                {groups.map((g) => {
                  const a = x.targets[t].refit.ablation[g];
                  return (
                    <span key={g} role="cell" className={`hm-cell ${a.ci95[1] < 0 ? "strong" : ""}`} style={heat(-a.delta * 15)}
                      title={`${t} without ${g}: ΔAUC ${signed(a.delta)} (CI ${ciText(a.ci95)})`}>
                      {signed(a.delta, 2)}
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="plots">
        <div className="plot-col">
          <Plot
            title={`Decision curve · ${dcaTarget}`}
            xLabel="Threshold probability"
            yLabel="Net benefit"
            desc={`Decision curve for ${dcaTarget}: net benefit of acting on the model compared with acting on everyone or no one.`}
            series={[
              { name: dcaTarget, x: dca.decision.thresholds, y: dca.decision.model },
              { name: "Treat all", x: dca.decision.thresholds, y: dca.decision.treat_all },
            ]}
            x={[0, 1]}
            y={[Math.floor(dcaMin * 10) / 10, Math.ceil(dca.decision.prevalence * 10) / 10]}
            diagonal={false}
            zero
          />
          <Segmented label="Decision curve estimate" value={dcaTarget} options={targets.map((t) => ({ value: t, label: t }))} onChange={setDcaTarget} />
        </div>
        <Plot
          title="Learning curve"
          xLabel="Share of training data"
          yLabel="ROC-AUC"
          desc={`Learning curves. ${targets.map((t) => `${t}: ${x.targets[t].refit.learning.map((l) => l.auc.toFixed(2)).join(", ")}`).join(". ")}.`}
          series={targets.map((t) => ({ name: t, x: x.targets[t].refit.learning.map((l) => l.fraction), y: x.targets[t].refit.learning.map((l) => l.auc), points: true }))}
          x={[0.2, 1]}
          y={[0.5, 1]}
          diagonal={false}
        />
      </div>
      <p className="plot-notes">
        <span><b>Decision curve:</b> above both lines = acting on the model helps.</span>
        <span><b>Learning curve:</b> still rising = more patients would help.</span>
      </p>

      <details className="numbers">
        <summary>Show numbers</summary>
        <div className="table-scroll">
          <table className="metrics-table compact">
            <thead>
              <tr>
                <th scope="col">Estimate</th><th scope="col">Mean |Δp| at 10% noise</th><th scope="col">State changes</th>
                <th scope="col">Brier: none / Platt / isotonic</th><th scope="col">Engineered ΔAUC</th>
                {x.chain && <th scope="col">Chain ΔAUC</th>}
              </tr>
            </thead>
            <tbody>
              {targets.map((t) => {
                const rb = x.robustness[t]?.["10pct_sd"];
                const c = x.targets[t].refit.calibration;
                const e = x.targets[t].refit.engineered;
                const ch = x.chain?.[t];
                return (
                  <tr key={t}>
                    <th scope="row">{t}</th>
                    <td className="tabular">{rb ? pct(rb.mean_abs_change, 1) : "–"}</td>
                    <td className="tabular">{rb ? pct(rb.state_change_rate, 1) : "–"}</td>
                    <td className="tabular">{c.none.brier.toFixed(3)} / {c.sigmoid.brier.toFixed(3)} / {c.isotonic.brier.toFixed(3)}</td>
                    <td className="tabular">{signed(e.delta)} <span className="muted">({ciText(e.ci95)})</span></td>
                    {x.chain && <td className="tabular">{ch ? <>{signed(ch.delta)} <span className="muted">({ciText(ch.ci95)})</span></> : "–"}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="muted small">Engineered features and the classifier chain bring no reliable gain, so the served models do not use them.</p>
      </details>
    </section>
  );
}
