// "How we got here" waterfall (md/10.md section 19). It starts at the model's average output, each
// measurement group adds its summed SHAP value, and it ends at this patient's model score. It is
// drawn in the model's own units (log-odds, or probability points for random forest), because
// log-odds steps do not add up in percent; no percent steps are invented.
import { useState, type CSSProperties } from "react";
import type { Explanation, FeatureSpec } from "../api/types";
import { formatValue, patientPhrase, pct } from "../features";
import { useRisk } from "../store/risk";

const fmt = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;

export function Waterfall({ exp, prob, targetName, specs, patient }: {
  exp: Explanation; prob: number; targetName: string; specs: Record<string, FeatureSpec>; patient: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const setHoverGroup = useRisk((s) => s.setHoverGroup);

  if (patient) {
    const up = exp.features.filter((f) => f.shap > 0).slice(0, 3);
    const down = exp.features.filter((f) => f.shap < 0).slice(0, 2);
    return (
      <div className="wf-plain">
        <h4>What raised this the most</h4>
        <ul>{up.length ? up.map((f) => <li key={f.name}>{patientPhrase(specs[f.name], f.value, f.name)}</li>) : <li>Nothing stood out.</li>}</ul>
        {down.length > 0 && (
          <>
            <h4>What lowered it</h4>
            <ul>{down.map((f) => <li key={f.name}>{patientPhrase(specs[f.name], f.value, f.name)}</li>)}</ul>
          </>
        )}
      </div>
    );
  }

  const start = exp.base_value ?? 0;
  const groups = Object.entries(exp.groups).filter(([, v]) => v !== 0).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
  let acc = start;
  const steps = groups.map(([g, v]) => {
    const from = acc;
    acc += v;
    return { g, v, from, to: acc };
  });
  const end = acc;
  const values = [start, end, ...steps.flatMap((s) => [s.from, s.to])];
  const pad = (Math.max(...values) - Math.min(...values)) * 0.06 || 0.1;
  const lo = Math.min(...values) - pad;
  const hi = Math.max(...values) + pad;
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const units = exp.units === "probability" ? "probability points" : "log-odds";
  const zeroIn = lo < 0 && hi > 0 && exp.units !== "probability";

  return (
    <div className="waterfall">
      <ol className="wf-rows" aria-label={`Waterfall for the ${targetName}, in ${units}`}>
        <li className="wf-row wf-total">
          <span className="wf-label">Average patient</span>
          <span className="wf-track">
            {zeroIn && <span className="wf-zero" style={{ left: `${x(0)}%` }} />}
            <span className="wf-marker" style={{ left: `${x(start)}%` }} />
          </span>
          <span className="wf-val tabular">{start.toFixed(2)}</span>
        </li>
        {steps.map((s) => {
          const feats = exp.features.filter((f) => f.group === s.g && f.shap !== 0).slice(0, 5);
          const isOpen = open === s.g;
          return (
            <li key={s.g} className="wf-row" onMouseEnter={() => setHoverGroup(s.g)} onMouseLeave={() => setHoverGroup(null)}>
              <button type="button" className="wf-label wf-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : s.g)}>
                <span className="wf-swatch" style={{ background: `var(--g-${s.g})` }} aria-hidden="true" />
                {s.g}
              </button>
              <span className="wf-track">
                {zeroIn && <span className="wf-zero" style={{ left: `${x(0)}%` }} />}
                <span
                  className={`wf-bar ${s.v >= 0 ? "up" : "down"}`}
                  style={{ left: `${x(Math.min(s.from, s.to))}%`, width: `${Math.max(0.6, Math.abs(x(s.to) - x(s.from)))}%`, "--g": `var(--g-${s.g})` } as CSSProperties}
                />
              </span>
              <span className="wf-val tabular">{fmt(s.v)}</span>
              {isOpen && (
                <ul className="wf-feats">
                  {feats.map((f) => (
                    <li key={f.name}>
                      <span>{specs[f.name]?.label ?? f.name}</span>
                      <span className="muted">{formatValue(specs[f.name], f.value)}{f.range_status && f.range_status !== "within" ? ` (${f.range_status})` : ""}</span>
                      <span className="tabular">{fmt(f.shap)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
        <li className="wf-row wf-total">
          <span className="wf-label"><strong>This patient</strong></span>
          <span className="wf-track">
            {zeroIn && <span className="wf-zero" style={{ left: `${x(0)}%` }} />}
            <span className="wf-marker strong" style={{ left: `${x(end)}%` }} />
          </span>
          <span className="wf-val tabular"><strong>{end.toFixed(2)}</strong></span>
        </li>
      </ol>
      <p className="wf-foot">
        <span>score in {units}</span>
        <span>calibrated estimate <strong>{pct(prob)}</strong></span>
      </p>
    </div>
  );
}
