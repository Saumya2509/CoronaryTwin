// The answer, stated first (md/10.md sections 5.4, 17): a KPI strip across the top, the overall
// estimate floating over the 3D stage, and alerts (coherence, out-of-distribution) between them.
// Everything reads the single store, so the tiles, callouts and 3D colors always agree.
import type { CSSProperties } from "react";
import type { TargetResult } from "../api/types";
import { anatomy } from "../anatomy";
import { pct } from "../features";
import { riskCss, riskWord } from "../scene/colorScale";
import { cohortResult, overallKey, useRisk } from "../store/risk";
import { GuidelineLine } from "./Guideline";
import { Pill, rangeText, uncertaintyLevel, useCountUp } from "./ui";

const RANGE_HELP =
  "Lowest and highest estimate among the 5 calibrated sub-models that are averaged. It shows how much they disagree; it is not a confidence interval.";

/** 0–100% ramp bar: fill to the estimate, lighter segment for the sub-model range, threshold tick. */
export function RiskBar({ r, threshold = false, thick = false }: { r: TargetResult; threshold?: boolean; thick?: boolean }) {
  const uncertain = r.state === "Uncertain";
  return (
    <div className={`riskbar ${thick ? "thick" : ""} ${uncertain ? "is-uncertain" : ""}`} aria-hidden="true" style={{ "--risk": riskCss(r.prob) } as CSSProperties}>
      <div className="riskbar-fill" style={{ width: `${r.prob * 100}%` }} />
      {r.range && <div className="riskbar-range" style={{ left: `${r.range[0] * 100}%`, width: `${(r.range[1] - r.range[0]) * 100}%` }} />}
      {threshold && r.threshold != null && <div className="riskbar-threshold" style={{ left: `${r.threshold * 100}%` }} />}
    </div>
  );
}

function Num({ p, className }: { p: number; className: string }) {
  const shown = useCountUp(p);
  return (
    <span className={className}>
      {Math.round((shown ?? p) * 100)}
      <small>%</small>
    </span>
  );
}

/** KPI strip: overall, one tile per artery, and how many arteries are uncertain. Tiles select arteries. */
export function KpiStrip() {
  const result = useRisk((s) => s.result);
  const selected = useRisk((s) => s.selected);
  const select = useRisk((s) => s.select);
  const audience = useRisk((s) => s.audience);
  const loading = useRisk((s) => s.loading);
  const cohort = useRisk((s) => s.cohort);
  const patient = audience === "patient";
  const okey = overallKey(result);
  const pick = (t: string, r: TargetResult | null | undefined) => (cohort ? cohortResult(cohort.summary, t) : r ?? null);

  const tiles: { id: string | null; label: string; sub: string; r: TargetResult | null }[] = [
    { id: null, label: `${patient ? "Overall" : `Overall ${okey}`}${cohort ? " · avg" : ""}`, sub: patient ? "Any main artery" : "Any vessel ≥ 50%", r: pick(okey, result?.overall) },
    ...anatomy.vessels.map((v) => ({
      id: v.id,
      label: `${patient ? v.patient_label : `${v.patient_label} · ${v.id}`}${cohort ? " · avg" : ""}`,
      sub: patient ? v.territory : v.label,
      r: pick(v.id, result?.vessels[v.id]),
    })),
  ];
  const nUncertain = cohort
    ? anatomy.vessels.filter((v) => cohortResult(cohort.summary, v.id)?.state === "Uncertain").length
    : result ? anatomy.vessels.filter((v) => result.vessels[v.id]?.state === "Uncertain").length : null;

  return (
    <section id="sec-estimate" className={`kpi-strip ${loading && !result ? "is-loading" : ""}`} aria-label="Estimates at a glance">
      {tiles.map((t) => {
        const isSel = t.id !== null && selected === t.id;
        const body = t.r ? (
          <>
            <span className="kpi-label">{t.label}</span>
            <span className="kpi-row">
              <Num p={t.r.prob} className="kpi-num" />
              <Pill s={t.r.state} prob={t.r.prob} patient={patient} size="sm" />
            </span>
            <RiskBar r={t.r} />
            <span className="kpi-sub">{!patient && rangeText(t.r.range) ? `range ${rangeText(t.r.range)}` : t.sub}</span>
          </>
        ) : (
          <>
            <span className="kpi-label">{t.label}</span>
            <span className="kpi-row"><span className="kpi-num muted">–</span></span>
            <span className="kpi-sub">{t.sub}</span>
          </>
        );
        return t.id === null ? (
          <div key="overall" className="kpi kpi-overall" style={t.r ? ({ "--risk": riskCss(t.r.prob) } as CSSProperties) : undefined}>{body}</div>
        ) : (
          <button
            key={t.id}
            type="button"
            className={`kpi ${isSel ? "is-selected" : ""} ${t.r?.state === "Uncertain" ? "is-uncertain" : ""}`}
            data-vessel={t.id}
            aria-pressed={isSel}
            onClick={() => select(isSel ? null : t.id)}
            onKeyDown={(e) => { if (e.key === "Escape" && isSel) select(null); }}
            aria-label={t.r ? `${t.label}: ${pct(t.r.prob)}, ${t.r.state}. ${isSel ? "Selected." : "Select to focus in 3D."}` : `${t.label}: no estimate`}
            style={t.r ? ({ "--risk": riskCss(t.r.prob) } as CSSProperties) : undefined}
            disabled={!t.r}
          >
            {body}
          </button>
        );
      })}
      <div className="kpi kpi-confidence">
        <span className="kpi-label">{patient ? "Unclear arteries" : "Uncertain arteries"}</span>
        <span className="kpi-row">
          <span className="kpi-num">{nUncertain ?? "–"}<small> of {anatomy.vessels.length}</small></span>
        </span>
        <span className="kpi-sub">
          {nUncertain === null ? "No patient loaded" : nUncertain === 0 ? "All arteries have a definite estimate" : "Both outcomes still possible at 90% confidence"}
        </span>
      </div>
    </section>
  );
}

/** Overall estimate, floating over the stage. Shrinks to a badge while an artery is selected. */
export function Hero() {
  const result = useRisk((s) => s.result);
  const audience = useRisk((s) => s.audience);
  const selected = useRisk((s) => s.selected);
  const select = useRisk((s) => s.select);
  const deltas = useRisk((s) => s.deltas);
  const loading = useRisk((s) => s.loading);
  const setDrawer = useRisk((s) => s.setDrawer);
  const cohort = useRisk((s) => s.cohort);
  const setCohort = useRisk((s) => s.setCohort);
  const shown = useCountUp(result?.overall.prob ?? null);
  const compare = useRisk((s) => s.compare);
  const visitLabel = useRisk((s) => s.visit?.label);

  if (cohort) {
    const s = cohort.summary;
    const ok = Object.keys(s.targets).find((t) => !anatomy.vessels.some((v) => v.id === t)) ?? "CAD";
    const o = s.targets[ok];
    return (
      <section className="hero glass hero-cohort" aria-label="Cohort average" style={{ "--risk": riskCss(o.mean_prob) } as CSSProperties}>
        <p className="hero-caption">Cohort average · {cohort.name} · {s.n} patients</p>
        <div className="hero-row">
          <p className="hero-number">{Math.round(o.mean_prob * 100)}<span className="hero-pct">%</span></p>
          <div className="hero-side">
            <span className="hero-range">{o.likely} likely · {o.uncertain} uncertain · {o.unlikely} unlikely</span>
          </div>
        </div>
        <p className="hero-text">
          Arteries are colored by the cohort's mean estimate and drawn uncertain when most patients are. This summarizes a group; it describes no single patient.
        </p>
        <div className="hero-actions">
          <button type="button" className="btn primary small" onClick={() => setCohort(null)}>Back to patient view</button>
        </div>
      </section>
    );
  }

  if (!result) {
    return (
      <section className={`hero glass hero-empty ${loading ? "is-loading" : ""}`} aria-label="No patient loaded">
        <p className="hero-caption">No patient loaded</p>
        <h2>Add a patient to see the estimate</h2>
        <p className="hero-text">Type values or upload a CSV in the patient record. Sample files are in the <code>csv/</code> folder.</p>
        <div className="hero-actions">
          <button type="button" className="btn primary" onClick={() => setDrawer(true)}>Open patient record</button>
        </div>
      </section>
    );
  }

  const o = result.overall;
  const okey = overallKey(result);
  const patient = audience === "patient";
  const d = deltas?.[okey];
  const compact = selected !== null;
  return (
    <section className={`hero glass ${compact ? "is-compact" : ""}`} aria-labelledby="hero-caption" style={{ "--risk": riskCss(o.prob) } as CSSProperties}>
      <p id="hero-caption" className="hero-caption">
        {patient ? "Overall estimate · any main heart artery" : `Overall ${okey} · any vessel ≥ 50% stenosis`}
        {compare !== null && ` · ${compare <= 0 ? visitLabel : compare >= 1 ? "now" : "changing"}`}
      </p>
      <div className="hero-row">
        <p className="hero-number" aria-label={`${pct(o.prob)} estimated`}>
          {Math.round((shown ?? o.prob) * 100)}<span className="hero-pct">%</span>
        </p>
        <div className="hero-side">
          <Pill s={o.state} prob={o.prob} patient={patient} />
          {d !== undefined && Math.abs(d) >= 0.005 && (
            <span className={`delta ${d < 0 ? "down" : "up"}`}>{d < 0 ? "−" : "+"}{pct(Math.abs(d))} what-if</span>
          )}
          {o.range && (
            <span className="hero-range" title={RANGE_HELP}>
              {patient ? "Likely range" : "Sub-model range"} {rangeText(o.range)}
            </span>
          )}
          {!patient && <GuidelineLine />}
        </div>
      </div>
      {!compact && (
        <p className="hero-text">
          {patient
            ? "The computer model's estimate. Not a diagnosis."
            : `${riskWord(o.prob)} · ${uncertaintyLevel(o.uncertainty).toLowerCase()} uncertainty${o.threshold != null ? ` · threshold ${pct(o.threshold)}` : ""}`}
        </p>
      )}
      {compact && (
        <button type="button" className="linkbtn small" onClick={() => select(null)}>Back to overall</button>
      )}
    </section>
  );
}

/** Coherence and out-of-distribution notices: kept visible above the stage, never inside it. */
export function Alerts() {
  const result = useRisk((s) => s.result);
  const audience = useRisk((s) => s.audience);
  const cohort = useRisk((s) => s.cohort);
  if (!result || cohort) return null;
  const patient = audience === "patient";
  const coh = result.coherence.flag;
  const ood = result.ood?.flag;
  if (!coh && !ood) return null;
  return (
    <div className="alerts">
      {coh && (
        <p className="alert" role="status">
          <strong>Overall and artery estimates differ.</strong> {result.coherence.note}
        </p>
      )}
      {ood && (
        <div className="alert alert-ood" role="status">
          <strong>{patient ? "These values are unusual for this model." : "Input is unlike the training data."}</strong>{" "}
          {patient
            ? "The model saw few or no patients like this, so treat the estimate with extra caution."
            : "The model is extrapolating; estimates may be unreliable."}
          {!patient && (
            <ul>
              {result.ood!.reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export { RANGE_HELP };
