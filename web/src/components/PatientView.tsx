// 04 Patient summary: one card per estimate with a gauge, a plain-word status and what raised or
// lowered it, instead of paragraphs. Few numbers, a clear next step.
import { useMemo } from "react";
import type { Explanation, FeatureSpec, TargetResult } from "../api/types";
import { anatomy } from "../anatomy";
import { patientPhrase, specMap } from "../features";
import { overallKey, useRisk } from "../store/risk";
import { Gauge } from "./charts";
import { DISCLAIMER } from "./Disclaimer";
import { Pill } from "./ui";

// States come from the conformal prediction set (how sure the model is), not from a cut-off.
const MEANING: Record<string, { icon: string; text: string }> = {
  Likely: { icon: "●", text: "Leans toward a narrowing" },
  Uncertain: { icon: "?", text: "Can't tell yet: more tests would help" },
  Unlikely: { icon: "○", text: "Leans away from a narrowing" },
};

function Card({ title, sub, r, exp, specs }: { title: string; sub: string; r: TargetResult; exp?: Explanation; specs: Record<string, FeatureSpec> }) {
  const up = (exp?.features ?? []).filter((f) => f.shap > 0).slice(0, 2);
  const down = (exp?.features ?? []).filter((f) => f.shap < 0).slice(0, 1);
  const m = MEANING[r.state];
  return (
    <li className={`pv-card pv-${r.state.toLowerCase()}`}>
      <div className="pv-top">
        <strong className="pv-title">{title}</strong>
        <Pill s={r.state} prob={r.prob} patient size="sm" />
      </div>
      <Gauge p={r.prob} size={150} uncertain={r.state === "Uncertain"} label={`${title}: ${Math.round(r.prob * 100)}%, ${r.state}`} />
      <p className="pv-meaning"><span aria-hidden="true">{m.icon}</span> {m.text}</p>
      <ul className="pv-why">
        {up.map((f) => <li key={f.name} className="up"><span aria-hidden="true">▲</span> {patientPhrase(specs[f.name], f.value, f.name)}</li>)}
        {down.map((f) => <li key={f.name} className="down"><span aria-hidden="true">▼</span> {patientPhrase(specs[f.name], f.value, f.name)}</li>)}
      </ul>
      <span className="pv-sub">{sub}</span>
    </li>
  );
}

/** Plain-language summary for patients (module 06 §3.5). */
export function PatientView() {
  const result = useRisk((s) => s.result);
  const spec = useRisk((s) => s.spec);
  const specs = useMemo(() => specMap(spec), [spec]);
  if (!result) return <p className="muted">Load a patient to see a plain-language summary.</p>;
  const okey = overallKey(result);
  return (
    <div className="patient-view">
      <ul className="pv-grid">
        <Card title="All heart arteries" sub="Any of the main arteries" r={result.overall} exp={result.explanations[okey]} specs={specs} />
        {anatomy.vessels.map((v) => {
          const r = result.vessels[v.id];
          return r ? <Card key={v.id} title={v.patient_label} sub={v.territory} r={r} exp={result.explanations[v.id]} specs={specs} /> : null;
        })}
      </ul>
      <p className="pv-key" aria-hidden="true"><span className="up">▲ raised the estimate</span><span className="down">▼ lowered it</span></p>
      {result.coherence.flag && <p className="notice">The overall and artery estimates don't fully agree. Your doctor can help interpret this.</p>}
      <div className="talk" title={DISCLAIMER}>
        <p><strong>Please talk to your doctor about these results.</strong> Only tests such as an angiogram or CT scan can show a narrowing.</p>
      </div>
    </div>
  );
}
