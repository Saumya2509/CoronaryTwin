// Small presentational pieces shared by the analysis tabs: the explanation lives in a tooltip,
// the chart carries the message.
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { riskCss } from "../scene/colorScale";

/** ⓘ button: details on hover/focus/click instead of a paragraph on the page. */
export function InfoTip({ children, label = "More information" }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className="infotip" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="infotip-btn" aria-label={label} aria-expanded={open} aria-describedby={open ? id : undefined}
        onClick={() => setOpen((o) => !o)} onBlur={() => setOpen(false)}>i</button>
      {open && <span role="tooltip" id={id} className="infotip-pop">{children}</span>}
    </span>
  );
}

/** Section title with an optional info tooltip. */
export function Title({ children, info, as: As = "h3" }: { children: ReactNode; info?: ReactNode; as?: "h3" | "h4" }) {
  return (
    <As className="vt-title">
      {children}
      {info && <InfoTip>{info}</InfoTip>}
    </As>
  );
}

/** Semicircle gauge for a probability, in the risk color. Dashed track when uncertain. */
export function Gauge({ p, size = 120, uncertain = false, label }: { p: number; size?: number; uncertain?: boolean; label?: string }) {
  const r = 44, cx = 50, cy = 50;
  const a = Math.PI * (1 - Math.min(1, Math.max(0, p)));
  const x = cx + r * Math.cos(a), y = cy - r * Math.sin(a);
  return (
    <svg viewBox="0 0 100 58" width={size} height={(size * 58) / 100} role="img" aria-label={label ?? `${Math.round(p * 100)}%`} className="gauge">
      <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} className="gauge-track" strokeDasharray={uncertain ? "4 3" : undefined} />
      {p > 0.005 && <path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}`} className="gauge-fill" style={{ stroke: riskCss(p) }} />}
      <text x={cx} y={cy - 4} textAnchor="middle" className="gauge-num">{Math.round(p * 100)}<tspan className="gauge-pct">%</tspan></text>
    </svg>
  );
}

export interface ForestRow { label: ReactNode; key: string; mean: number; lo: number; hi: number; strong?: boolean; color?: string }

/** Point estimate with a confidence-interval bar on a shared axis (forest plot). */
export function Forest({ rows, domain, ticks, zero, fmt = (v) => v.toFixed(2), ariaLabel }: {
  rows: ForestRow[]; domain: [number, number]; ticks: number[]; zero?: number; fmt?: (v: number) => string; ariaLabel: string;
}) {
  const x = (v: number) => ((Math.min(domain[1], Math.max(domain[0], v)) - domain[0]) / (domain[1] - domain[0])) * 100;
  return (
    <div className="forest" role="img" aria-label={ariaLabel}>
      {rows.map((r) => (
        <div key={r.key} className={`forest-row ${r.strong ? "is-strong" : ""}`}>
          <span className="forest-label">{r.label}</span>
          <span className="forest-track">
            {zero !== undefined && <span className="forest-zero" style={{ left: `${x(zero)}%` }} />}
            <span className="forest-ci" style={{ left: `${x(r.lo)}%`, width: `${x(r.hi) - x(r.lo)}%`, background: r.color }} />
            <span className="forest-dot" style={{ left: `${x(r.mean)}%`, background: r.color }} />
          </span>
          <span className="forest-val">{fmt(r.mean)}</span>
        </div>
      ))}
      <div className="forest-row forest-axis" aria-hidden="true">
        <span />
        <span className="forest-track">
          {ticks.map((t) => <span key={t} className="forest-tick" style={{ left: `${x(t)}%` }}>{fmt(t)}</span>)}
        </span>
        <span />
      </div>
    </div>
  );
}

/** Background for a heatmap cell: diverging teal (helps / good) ↔ amber (hurts / bad). `v` in [-1, 1]. */
export function heat(v: number): CSSProperties {
  const a = Math.min(1, Math.abs(v));
  const c = v >= 0 ? "45, 212, 191" : "245, 165, 36";
  return { background: `rgba(${c}, ${0.08 + 0.55 * a})` };
}

/** Yes/no outcome dots (filled = yes) for similar cases. */
export function OutcomeDots({ outcomes, order }: { outcomes: Record<string, number>; order: string[] }) {
  return (
    <span className="odots">
      {order.map((t) => (
        <span key={t} className={`odot ${outcomes[t] ? "yes" : "no"}`} title={`${t}: ${outcomes[t] ? "yes" : "no"}`}>
          <span aria-hidden="true" />{t}
        </span>
      ))}
    </span>
  );
}
