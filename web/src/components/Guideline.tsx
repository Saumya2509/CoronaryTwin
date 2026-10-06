// Feature 1: CoronaryTwin next to the guideline pre-test probability scores clinicians use today
// (ESC 2019, ESC 2013 / updated Diamond-Forrester, CAD Consortium). Per patient (Why tab) and as
// evidence on the same 303 patients (Model trust tab, from experiments.json "baselines").
import { useEffect, useState } from "react";
import { getExperiments } from "../api/client";
import type { ExperimentsResponse } from "../api/types";
import { pct } from "../features";
import { overallKey, useRisk } from "../store/risk";
import { InfoTip, Title } from "./charts";
import { Segmented } from "./ui";

const SYMPTOM: Record<string, string> = {
  typical: "typical angina", atypical: "atypical angina", nonanginal: "non-anginal chest pain", dyspnoea: "dyspnoea (no chest pain)",
};
const signed = (v: number, d = 3) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(d)}`;

/** This patient's model estimate beside each guideline score. */
export function GuidelinePatient() {
  const result = useRisk((s) => s.result);
  if (!result?.guideline) return null;
  const g = result.guideline;
  const rows = [{ id: "model", label: "CoronaryTwin", prob: result.overall.prob }, ...g.scores.map((s) => ({ id: s.id, label: s.label, prob: s.prob }))];
  return (
    <section className="vt-card guideline" aria-labelledby="gl-title">
      <Title info={<>{g.note} Symptom class used: {SYMPTOM[g.symptom]}. The Model trust tab compares them on all 303 patients.</>}>
        <span id="gl-title">Versus guideline scores</span>
      </Title>
      <ul className="gl-bars" aria-label={`Overall ${overallKey(result)} estimate by method`}>
        {rows.map((r) => (
          <li key={r.id} className={r.id === "model" ? "is-model" : ""}>
            <span className="gl-name">{r.label}</span>
            <span className="gl-track"><span className="gl-fill" style={{ width: `${r.prob * 100}%` }} /></span>
            <span className="gl-num">{pct(r.prob)}</span>
          </li>
        ))}
      </ul>
      <p className="small muted">ESC 2019 band: {g.esc2019_band}.</p>
    </section>
  );
}

/** Compact line for the hero card. */
export function GuidelineLine() {
  const g = useRisk((s) => s.result?.guideline);
  const esc = g?.scores.find((s) => s.id === "esc2019");
  if (!g || !esc) return null;
  return (
    <span className="hero-guideline" title={`${esc.label}: ${g.esc2019_band}. Uses age, sex and symptom type only.`}>
      ESC 2019 guideline {pct(esc.prob)}
    </span>
  );
}

/** Evidence on the dataset: AUC with 95% CI per method, the headline gain and the honest caveats. */
export function GuidelineEvidence() {
  const [x, setX] = useState<ExperimentsResponse | null>(null);
  const [target, setTarget] = useState("CAD");
  useEffect(() => {
    getExperiments().then(setX).catch(() => setX(null));
  }, []);
  const b = x?.baselines;
  if (!b) return null;
  const T = b.targets[target] ?? Object.values(b.targets)[0];
  const ids = Object.keys(T.baselines);
  const rows = [{ id: "model", label: "CoronaryTwin", auc: T.model.auc, ci: T.model.auc_ci95, delta: null as null | { d: number; ci: [number, number] } },
    ...ids.map((k) => ({ id: k, label: b.scores[k].label, auc: T.baselines[k].auc, ci: T.baselines[k].auc_ci95,
      delta: { d: T.baselines[k].delta_auc, ci: T.baselines[k].delta_ci95 } }))];
  const lo = 0.5, hi = 1;
  const sx = (v: number) => `${((Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo)) * 100}%`;
  const cad = b.targets.CAD;
  const esc = cad.baselines.esc2019, refit = cad.baselines.refit, rf = cad.baselines.cadc_rf;
  const beatsAll = Object.entries(cad.baselines).filter(([k]) => k !== "refit").every(([, r]) => r.delta_ci95[0] > 0);
  const vesselsNoGain = Object.entries(b.targets).filter(([t, r]) => t !== "CAD" && r.baselines.refit.delta_ci95[0] <= 0).map(([t]) => t);

  return (
    <section className="vt-card guideline-evidence" aria-labelledby="gle-title">
      <Title info={<>Same 303 patients. CoronaryTwin numbers are out-of-fold; the published scores are fixed formulas (nothing is fitted);
        the refitted clinical model uses age, sex, symptom type and five risk factors in the same cross-validation. Δ = CoronaryTwin minus the score, paired bootstrap 95% CI.
        Published scores were derived where far fewer patients had CAD, so they run low here; AUC compares ranking only.</>}>
        <span id="gle-title">Versus what doctors use today</span>
      </Title>
      <div className="ev-tiles gl-tiles">
        <div className="ev-tile">
          <span className="ev-big">{signed(esc.delta_auc, 2)}<small> AUC</small></span>
          <span className="ev-label">over the ESC 2019 guideline score ({signed(esc.delta_ci95[0], 2)} to {signed(esc.delta_ci95[1], 2)})</span>
        </div>
        <div className="ev-tile">
          <span className="ev-big">{signed(rf.delta_auc, 2)}<small> AUC</small></span>
          <span className="ev-label">over CAD Consortium with risk factors ({signed(rf.delta_ci95[0], 2)} to {signed(rf.delta_ci95[1], 2)})</span>
        </div>
        <div className="ev-tile">
          <span className="ev-big">{b.bands.model.cad[0]}<small> vs {b.bands.esc2019.cad[0]}</small></span>
          <span className="ev-label">CAD patients placed below 15% (CoronaryTwin vs ESC 2019)
            <InfoTip>{`Below 15% is the band where the 2013 guideline advises no further testing. ESC 2019 puts ${b.bands.esc2019.cad[0]} of ${b.bands.esc2019.cad.reduce((a, c) => a + c, 0)} patients with CAD there; CoronaryTwin puts ${b.bands.model.cad[0]}. Part of that gap is calibration: the published scores were built for lower-risk populations.`}</InfoTip>
          </span>
        </div>
      </div>
      <Segmented label="Estimate" value={target} onChange={setTarget}
        options={Object.keys(b.targets).map((t) => ({ value: t, label: t }))} />
      <ul className="gl-auc" aria-label={`${target} ROC-AUC by method`}>
        {rows.map((r) => (
          <li key={r.id} className={r.id === "model" ? "is-model" : ""}>
            <span className="gl-name">{r.label}</span>
            <span className="gl-axis">
              <span className="gl-ci" style={{ left: sx(r.ci[0]), width: `calc(${sx(r.ci[1])} - ${sx(r.ci[0])})` }} />
              <span className="gl-dot" style={{ left: sx(r.auc) }} />
            </span>
            <span className="gl-num">{r.auc.toFixed(3)}
              {r.delta && <small className={r.delta.ci[0] > 0 ? "gl-sig" : ""}> Δ {signed(r.delta.d)}</small>}
            </span>
          </li>
        ))}
      </ul>
      <p className="gl-axis-label small muted">ROC-AUC from 0.5 (chance) to 1.0 · line = 95% CI · bold Δ = CoronaryTwin reliably better</p>
      <p className="small">
        {beatsAll ? "For overall CAD, CoronaryTwin ranks patients reliably better than every published score. " : "For overall CAD, see Δ above for each published score. "}Against a clinical model refitted on this
        same data it is {signed(refit.delta_auc)} AUC ({signed(refit.delta_ci95[0])} to {signed(refit.delta_ci95[1])}): similar ranking, but more cautious
        at the extremes.{vesselsNoGain.length > 0 && ` For ${vesselsNoGain.join(" and ")}, it is not reliably better than the clinical baseline: the per-artery models add the map, not extra accuracy.`}
      </p>
    </section>
  );
}
