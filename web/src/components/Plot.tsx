// Small SVG line plot for the Model trust tab. Series differ by color AND dash pattern,
// so they stay distinguishable without color.

const SERIES: Record<string, { color: string; dash?: string }> = {
  CAD: { color: "var(--series-1)" },
  LAD: { color: "var(--series-2)", dash: "6 3" },
  LCX: { color: "var(--series-3)", dash: "2 3" },
  RCA: { color: "var(--series-4)", dash: "8 3 2 3" },
  "Treat all": { color: "var(--ink-3)", dash: "4 3" },
  "Treat none": { color: "var(--rule-strong)", dash: "1 3" },
};

const style = (name: string) => SERIES[name] ?? { color: "currentColor" };

/** Round tick values (steps of 0.05, 0.1, 0.2, 0.25 or 0.5) inside the domain, at most 6. */
function ticks([lo, hi]: [number, number]): number[] {
  const step = [0.05, 0.1, 0.2, 0.25, 0.5, 1].find((s) => (hi - lo) / s <= 5) ?? 1;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export interface Series { name: string; x: number[]; y: number[]; points?: boolean }

export function Plot({ title, xLabel, yLabel, series, desc, diagonal = true, x = [0, 1], y = [0, 1], zero = false }: {
  title: string; xLabel: string; yLabel: string; desc: string; series: Series[];
  diagonal?: boolean; x?: [number, number]; y?: [number, number]; zero?: boolean;
}) {
  const W = 270, H = 220, L = 50, B = 32, T = 8, R = 8;
  const sx = (v: number) => L + ((v - x[0]) / (x[1] - x[0])) * (W - L - R);
  const sy = (v: number) => T + (1 - (Math.min(Math.max(v, y[0]), y[1]) - y[0]) / (y[1] - y[0])) * (H - T - B);
  return (
    <figure className="plot">
      <figcaption>{title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc}>
        {ticks(y).map((t) => (
          <g key={`y${t}`}>
            <line x1={sx(x[0])} x2={sx(x[1])} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={L - 4} y={sy(t) + 3} textAnchor="end" className="tick">{t}</text>
          </g>
        ))}
        {ticks(x).map((t) => (
          <text key={`x${t}`} x={sx(t)} y={H - B + 12} textAnchor="middle" className="tick">{t}</text>
        ))}
        {diagonal && <line x1={sx(x[0])} y1={sy(y[0])} x2={sx(x[1])} y2={sy(y[1])} className="diag" />}
        {zero && <line x1={sx(x[0])} x2={sx(x[1])} y1={sy(0)} y2={sy(0)} className="diag" />}
        {series.map((s) => (
          <g key={s.name}>
            <polyline
              fill="none"
              stroke={style(s.name).color}
              strokeDasharray={style(s.name).dash}
              strokeWidth={2}
              points={s.x.map((xi, i) => `${sx(xi)},${sy(s.y[i])}`).join(" ")}
            />
            {s.points && s.x.map((xi, i) => <circle key={i} cx={sx(xi)} cy={sy(s.y[i])} r={2.5} fill={style(s.name).color} />)}
          </g>
        ))}
        <text x={(L + W - R) / 2} y={H - 4} textAnchor="middle" className="axis">{xLabel}</text>
        <text x={11} y={(T + H - B) / 2} textAnchor="middle" className="axis" transform={`rotate(-90 11 ${(T + H - B) / 2})`}>{yLabel}</text>
      </svg>
      <div className="plot-legend">
        {series.map((s) => (
          <span key={s.name}>
            <svg width="22" height="8" aria-hidden="true"><line x1="0" y1="4" x2="22" y2="4" stroke={style(s.name).color} strokeWidth="2" strokeDasharray={style(s.name).dash} /></svg>
            {s.name}
          </span>
        ))}
      </div>
    </figure>
  );
}
