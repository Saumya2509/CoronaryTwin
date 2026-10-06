// Artery detail panel (md/10.md section 18): opens on the stage when an artery is selected.
// The one place where this artery's explanation, a what-if slider and the next steps meet.
import { useMemo, type CSSProperties } from "react";
import { vesselById } from "../anatomy";
import { formatValue, patientPhrase, pct, specMap } from "../features";
import { riskCss } from "../scene/colorScale";
import { useRisk, type Tab } from "../store/risk";
import { RANGE_HELP } from "./RiskCards";
import { Pill, rangeText } from "./ui";
import { Slider } from "./WhatIf";

function jump(setTab: (t: Tab) => void, tab: Tab, selector: string) {
  setTab(tab);
  window.setTimeout(() => document.querySelector(selector)?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
}

export function DetailPanel() {
  const selected = useRisk((s) => s.selected);
  const result = useRisk((s) => s.result);
  const base = useRisk((s) => s.base);
  const patient = useRisk((s) => s.audience === "patient");
  const spec = useRisk((s) => s.spec);
  const overrides = useRisk((s) => s.overrides);
  const setWhatIf = useRisk((s) => s.setWhatIf);
  const select = useRisk((s) => s.select);
  const setTab = useRisk((s) => s.setTab);
  const present = useRisk((s) => s.present);
  const cohort = useRisk((s) => s.cohort);
  const specs = useMemo(() => specMap(spec), [spec]);

  if (!selected || !result || present !== null || cohort) return null;
  const v = vesselById(selected);
  const r = result.vessels[selected];
  const exp = result.explanations[selected];
  if (!v || !r || !exp) return null;

  // Closing from inside the panel hands focus back to the artery's KPI tile, so keyboard users don't land on <body>.
  const close = () => {
    select(null);
    window.requestAnimationFrame(() => document.querySelector<HTMLElement>(`button.kpi[data-vessel="${selected}"]`)?.focus());
  };

  const drivers = exp.features.filter((f) => f.shap !== 0).slice(0, 5);
  const fmax = Math.max(...drivers.map((f) => Math.abs(f.shap)), 1e-9);
  const lever = exp.features.find((f) => specs[f.name]?.modifiable && f.value !== null && typeof f.value === "number");
  const leverSpec = lever ? specs[lever.name] : undefined;
  const before = base?.vessels[selected]?.prob;
  const missing = (base?.imputed?.length ?? 0) > 0;

  return (
    <aside className="detail glass" aria-labelledby="detail-title" style={{ "--risk": riskCss(r.prob) } as CSSProperties}
      onKeyDown={(e) => { if (e.key === "Escape") close(); }}>
      <header className="detail-head">
        <div>
          <h3 id="detail-title">{v.patient_label} <span className="muted">({v.id})</span></h3>
          <p className="muted small">{patient ? v.territory : `${v.label} · ${v.territory}`}</p>
        </div>
        <button type="button" className="icon-btn" onClick={close} aria-label="Close artery details">×</button>
      </header>
      <div className="detail-num-row">
        <span className="detail-num">{Math.round(r.prob * 100)}<small>%</small></span>
        <Pill s={r.state} prob={r.prob} patient={patient} />
        {!patient && r.range && <span className="muted small" title={RANGE_HELP}>range {rangeText(r.range)}</span>}
      </div>

      <h4 className="detail-sub">{patient ? "What mattered most" : "Why: top drivers"}</h4>
      <ul className="detail-drivers">
        {drivers.map((f) => (
          <li key={f.name}>
            <span className="dd-name">{patient ? patientPhrase(specs[f.name], f.value, f.name) : specs[f.name]?.label ?? f.name}</span>
            <span className="dd-bar" aria-hidden="true">
              <span className={f.shap > 0 ? "up" : "down"} style={{ width: `${(Math.abs(f.shap) / fmax) * 100}%` }} />
            </span>
            <span className="dd-dir">{f.shap > 0 ? "raised" : "lowered"}</span>
          </li>
        ))}
      </ul>

      {lever && leverSpec && !patient && (
        <div className="detail-whatif">
          <h4 className="detail-sub">What-if</h4>
          <Slider
            f={leverSpec}
            base={typeof lever.value === "number" ? lever.value : null}
            value={overrides[lever.name] ?? null}
            onChange={(x) => setWhatIf({ ...overrides, [lever.name]: x }, null, null)}
          />
          {before !== undefined && Object.keys(overrides).length > 0 && (
            <p className="small">
              {v.id}: {pct(before)} → <strong>{pct(r.prob)}</strong> <span className="muted">· model sensitivity, not advice</span>
            </p>
          )}
          {Object.keys(overrides).length === 0 && (
            <p className="muted small">Strongest modifiable driver for {v.id}, currently {formatValue(leverSpec, lever.value)}.</p>
          )}
        </div>
      )}

      <div className="detail-actions">
        <button type="button" className="btn small" onClick={() => jump(setTab, "explain", "#panel-explain")}>Full explanation</button>
        {!patient && <button type="button" className="btn small" onClick={() => jump(setTab, "whatif", "#panel-whatif")}>All what-ifs</button>}
        {missing && <button type="button" className="btn small" onClick={() => document.querySelector(".nbt")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Next best test</button>}
        {!patient && <button type="button" className="btn small" onClick={() => jump(setTab, "explain", ".similar")}>Similar patients</button>}
      </div>
    </aside>
  );
}
