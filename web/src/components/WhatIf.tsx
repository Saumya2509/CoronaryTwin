import { useMemo, useState } from "react";
import { counterfactual } from "../api/client";
import type { CounterfactualResponse, FeatureSpec, PredictResponse } from "../api/types";
import { anatomy } from "../anatomy";
import { formatValue, normalRangeText, pct, specMap } from "../features";
import { riskCss } from "../scene/colorScale";
import { overallKey, useRisk } from "../store/risk";
import { InfoTip } from "./charts";
import { Switch } from "./ui";

const CAPTION = "Shows model sensitivity, not treatment advice.";

export function Slider({ f, base, value, onChange }: { f: FeatureSpec; base: number | null; value: number | null; onChange: (v: number) => void }) {
  const id = `wi-${f.name}`;
  if (f.type === "binary") {
    return (
      <div className="wi-row">
        <label htmlFor={id}>{f.label}</label>
        <Switch id={id} label={f.label} checked={(value ?? base) === 1} onChange={(v) => onChange(v ? 1 : 0)} />
        <span className="muted small">was {formatValue(f, base)}</span>
      </div>
    );
  }
  const lo = f.stats?.p01 ?? f.valid_range?.[0] ?? 0;
  const hi = f.stats?.p99 ?? f.valid_range?.[1] ?? 100;
  const cur = value ?? base ?? f.stats?.median ?? lo;
  const changed = value !== null && value !== base;
  return (
    <div className="wi-row">
      <label htmlFor={id}>
        {f.label}
        <span className="muted tiny"> {normalRangeText(f)}</span>
      </label>
      <input
        id={id}
        type="range"
        min={lo}
        max={hi}
        step={f.step ?? 1}
        value={cur}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-valuetext={formatValue(f, cur)}
      />
      <output htmlFor={id} className={`tabular ${changed ? "changed" : ""}`}>
        {formatValue(f, cur)}
        {changed && <span className="muted tiny"> (was {formatValue(f, base)})</span>}
      </output>
    </div>
  );
}

/** Dumbbell chart: hollow dot = before, filled dot = after, on one 0–100% axis per estimate. */
function BeforeAfter() {
  const base = useRisk((s) => s.base);
  const result = useRisk((s) => s.result);
  const audience = useRisk((s) => s.audience);
  if (!base || !result) return null;
  const okey = overallKey(base);
  const rows: [string, string, number, number][] = [
    [okey, audience === "patient" ? "Overall" : okey, base.overall.prob, result.overall.prob],
    ...anatomy.vessels.map((v) => [v.id, audience === "patient" ? v.patient_label : v.id, base.vessels[v.id]?.prob ?? 0, result.vessels[v.id]?.prob ?? 0] as [string, string, number, number]),
  ];
  return (
    <div className="dumbbell" role="img" aria-label={rows.map(([, l, b, a]) => `${l}: ${pct(b)} to ${pct(a)}`).join("; ")}>
      {rows.map(([key, label, b, a]) => {
        const d = a - b;
        const lo = Math.min(a, b), hi = Math.max(a, b);
        return (
          <div key={key} className="db-row">
            <span className="db-label">{label}</span>
            <span className="db-track">
              <span className="db-scale" />
              {Math.abs(d) >= 0.005 && <span className={`db-link ${d < 0 ? "down" : "up"}`} style={{ left: `${lo * 100}%`, width: `${(hi - lo) * 100}%` }} />}
              <span className="db-before" style={{ left: `${b * 100}%` }} />
              <span className="db-after" style={{ left: `${a * 100}%`, background: riskCss(a) }} />
            </span>
            <span className={`db-delta ${Math.abs(d) < 0.005 ? "" : d < 0 ? "good" : "bad"}`}>
              {Math.abs(d) < 0.005 ? pct(a) : `${d > 0 ? "+" : "−"}${pct(Math.abs(d), 1)}`}
            </span>
          </div>
        );
      })}
      <div className="db-row db-axis" aria-hidden="true">
        <span />
        <span className="db-track">{[0, 25, 50, 75, 100].map((t) => <span key={t} style={{ left: `${t}%` }}>{t}</span>)}</span>
        <span />
      </div>
      <p className="db-legend" aria-hidden="true"><span className="db-before-key" /> before <span className="db-after-key" /> after</p>
    </div>
  );
}

function Counterfactual() {
  const inputs = useRisk((s) => s.inputs);
  const spec = useRisk((s) => s.spec);
  const base = useRisk((s) => s.base);
  const overrides = useRisk((s) => s.overrides);
  const setWhatIf = useRisk((s) => s.setWhatIf);
  const [target, setTarget] = useState<string>(anatomy.vessels[0].id);
  const [res, setRes] = useState<CounterfactualResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const specs = useMemo(() => specMap(spec), [spec]);
  const okey = overallKey(base);

  const run = async () => {
    setBusy(true);
    setErr(null);
    try {
      setRes(await counterfactual(inputs, target));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cf" aria-labelledby="cf-title">
      <h3 id="cf-title">Smallest change below the threshold</h3>
      <div className="cf-controls">
        <label htmlFor="cf-target" className="sr-only">Estimate</label>
        <select id="cf-target" value={target} onChange={(e) => { setTarget(e.target.value); setRes(null); }}>
          {[okey, ...anatomy.vessels.map((v) => v.id)].map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button type="button" className="btn" onClick={run} disabled={busy} aria-busy={busy}>
          {busy ? "Searching…" : "Find"}
        </button>
      </div>
      {err && <p className="field-error" role="alert">{err}</p>}
      {res && (
        <div role="status">
          {res.already_below ? (
            <p className="muted small">{target} is already below its threshold ({pct(res.threshold)}).</p>
          ) : res.options.length === 0 ? (
            <p className="muted small">{res.note}</p>
          ) : (
            <ol className="cf-list">
              {res.options.map((o, i) => (
                <li key={i}>
                  <span>
                    {o.changes.map((c) => `${specs[c.feature]?.label ?? c.feature} ${formatValue(specs[c.feature], c.from)} → ${formatValue(specs[c.feature], c.to)}`).join(" and ")}
                  </span>
                  <span className="tabular muted small">{target} {pct(res.current_prob)} → {pct(o.new_prob)}</span>
                  <button
                    type="button"
                    className="btn ghost small"
                    onClick={() => setWhatIf({ ...overrides, ...Object.fromEntries(o.changes.map((c) => [c.feature, c.to])) }, null, null)}
                  >
                    Try it
                  </button>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}

/** Top drivers of the overall estimate that no slider can change (data-driven, for the what-if note). */
export function fixedDrivers(base: PredictResponse | null, specs: Record<string, FeatureSpec>, n = 2): string[] {
  if (!base) return [];
  const exp = base.explanations[overallKey(base)];
  return (exp?.features ?? []).filter((f) => f.shap !== 0 && !specs[f.name]?.modifiable).slice(0, n).map((f) => specs[f.name]?.label ?? f.name);
}

/** One line on why what-if changes are small or go the "wrong" way; the detail is in a tooltip. */
function WhatIfNote() {
  const base = useRisk((s) => s.base);
  const deltas = useRisk((s) => s.deltas);
  const spec = useRisk((s) => s.spec);
  const specs = useMemo(() => specMap(spec), [spec]);
  if (!base || !deltas) return null;
  const d = deltas[overallKey(base)] ?? 0;
  if (Math.abs(d) >= 0.05) return null;
  const fixed = fixedDrivers(base, specs);
  return (
    <p className="whatif-chip" role="note">
      {d > 0.004 ? "Slightly up" : "Small change"}
      {fixed.length > 0 && <>: top drivers ({fixed.join(", ").toLowerCase()}) can't be modified</>}
      <InfoTip>
        The model learned associations from 303 patients. For this patient the strongest drivers cannot be changed with a slider, so the
        estimate moves only a little, and values moving toward normal are not guaranteed to lower it.
      </InfoTip>
    </p>
  );
}

export function WhatIf({ online }: { online: boolean | null }) {
  const spec = useRisk((s) => s.spec);
  const inputs = useRisk((s) => s.inputs);
  const overrides = useRisk((s) => s.overrides);
  const setWhatIf = useRisk((s) => s.setWhatIf);
  const resetWhatIf = useRisk((s) => s.resetWhatIf);
  const specs = useMemo(() => specMap(spec), [spec]);

  if (!online || !spec) {
    return <p className="muted">What-if analysis needs the API with trained models. Start it with <code>python tasks.py serve</code>.</p>;
  }
  const active = Object.keys(overrides).length > 0;

  return (
    <div className="whatif">
      <p className="sens-pill" role="note">
        <span aria-hidden="true">⚠</span> {CAPTION}
        <InfoTip>The model learns associations, so changing a value here does not mean a treatment would change real risk. Arteries and cards recolor live.</InfoTip>
      </p>
      <div className="whatif-grid">
        <section aria-labelledby="wi-title">
          <div className="section-head">
            <h3 id="wi-title">Modifiable measurements</h3>
            <button type="button" className="btn ghost small" onClick={resetWhatIf} disabled={!active}>
              Reset all
            </button>
          </div>
          {spec.modifiable.map((name) => {
            const f = specs[name];
            if (!f) return null;
            const base = inputs[name];
            return (
              <Slider
                key={name}
                f={f}
                base={typeof base === "number" ? base : null}
                value={overrides[name] ?? null}
                onChange={(v) => setWhatIf({ ...overrides, [name]: v }, null, null)}
              />
            );
          })}
        </section>
        <section aria-labelledby="ba-title">
          <h3 id="ba-title">{active ? "Before → after" : "Current estimates"}</h3>
          <BeforeAfter />
          <WhatIfNote />
          <Counterfactual />
        </section>
      </div>
    </div>
  );
}
