// Feature 3: compare two visits of the same patient on the 3D heart. Save the current record as a visit,
// update the record (new values, or newer reports via "Read reports"), then scrub or play between them:
// the arteries, callouts, KPI tiles and hero all follow one slider. Kept in memory only.
import { useEffect, useMemo, useRef } from "react";
import { anatomy } from "../anatomy";
import { formatValue, pct, specMap } from "../features";
import { overallKey, prefersReducedMotionNow, useRisk } from "../store/risk";
import { InfoTip } from "./charts";

const PLAY_MS = 2600;
const time = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function Visits() {
  const base = useRisk((s) => s.base);
  const inputs = useRisk((s) => s.inputs);
  const scored = useRisk((s) => s.baseInputs);
  const visit = useRisk((s) => s.visit);
  const compare = useRisk((s) => s.compare);
  const cohort = useRisk((s) => s.cohort);
  const spec = useRisk((s) => s.spec);
  const saveVisit = useRisk((s) => s.saveVisit);
  const clearVisit = useRisk((s) => s.clearVisit);
  const setCompare = useRisk((s) => s.setCompare);
  const raf = useRef<number | null>(null);
  const specs = useMemo(() => specMap(spec), [spec]);

  // Compare against the inputs the current estimate was computed from, never values still being scored.
  const now = scored ?? inputs;
  const pending = scored !== null && scored !== inputs;
  const changes = useMemo(() => {
    if (!visit) return [];
    const names = new Set([...Object.keys(visit.inputs), ...Object.keys(now)]);
    return [...names].filter((n) => (visit.inputs[n] ?? null) !== (now[n] ?? null))
      .map((n) => ({ n, label: specs[n]?.label ?? n, from: formatValue(specs[n], visit.inputs[n] ?? null), to: formatValue(specs[n], now[n] ?? null) }));
  }, [visit, now, specs]);

  useEffect(() => () => { if (raf.current) cancelAnimationFrame(raf.current); }, []);

  if (!base || cohort) return null;

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
  };
  const play = () => {
    stop();
    if (prefersReducedMotionNow()) return setCompare(1);
    const start = performance.now();
    setCompare(0);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / PLAY_MS);
      setCompare(t < 0.12 ? 0 : (t - 0.12) / 0.88);   // a short hold on the saved visit first
      raf.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    raf.current = requestAnimationFrame(step);
  };

  if (!visit) {
    return (
      <section className="visits glass-soft" aria-label="Compare visits">
        <span className="visits-text">Follow-up: save this record as a visit, update it later with new values or reports, then compare both on the heart.</span>
        <button type="button" className="btn small" onClick={saveVisit}>Save as visit 1</button>
      </section>
    );
  }

  const okey = overallKey(base);
  const a = visit.result;
  const targets = [
    { id: okey, from: a.overall.prob, to: base.overall.prob },
    ...anatomy.vessels.map((v) => ({ id: v.id, from: a.vessels[v.id]?.prob ?? 0, to: base.vessels[v.id]?.prob ?? 0 })),
  ];
  const t = compare ?? 1;

  if (!changes.length || (pending && compare === null)) {
    return (
      <section className="visits glass-soft" aria-label="Compare visits">
        <span className="visits-text" role="status">{pending ? "Updating the estimate for the changed values…"
          : `${visit.label} saved at ${time(visit.savedAt)}. Change values or read newer reports to compare with it.`}</span>
        <button type="button" className="linkbtn small" onClick={clearVisit}>Clear visit</button>
      </section>
    );
  }

  return (
    <section className="visits glass-soft is-comparing" aria-label="Compare visits">
      <div className="visits-row">
        <span className="visits-end">{visit.label}<small>{time(visit.savedAt)}</small></span>
        <input type="range" min={0} max={1} step={0.01} value={t} className="visits-slider"
          aria-label={`Position between ${visit.label} and now`} aria-valuetext={t <= 0 ? visit.label : t >= 1 ? "Now" : `${Math.round(t * 100)}% of the way to now`}
          onChange={(e) => { stop(); setCompare(Number(e.target.value)); }} />
        <span className="visits-end">Now<small>{changes.length} {changes.length === 1 ? "change" : "changes"}</small></span>
        <button type="button" className="btn small primary" onClick={play}>▶ Play</button>
        {compare !== null && <button type="button" className="linkbtn small" onClick={() => { stop(); setCompare(null); }}>Exit</button>}
        <button type="button" className="linkbtn small" onClick={() => { stop(); clearVisit(); }}>Clear visit</button>
        <InfoTip>Both ends show real model estimates. Positions in between only blend the colors to show the change; they are not estimates.
          Differences reflect changed inputs, not proof that a treatment worked.</InfoTip>
      </div>
      <ul className="visits-deltas" aria-live="polite">
        {targets.map((x) => {
          const d = x.to - x.from;
          return (
            <li key={x.id}>
              <span className="mono">{x.id}</span> {pct(x.from)} → {pct(x.to)}
              {Math.abs(d) >= 0.005 && <span className={`delta ${d < 0 ? "down" : "up"}`}>{d < 0 ? "−" : "+"}{pct(Math.abs(d))}</span>}
            </li>
          );
        })}
      </ul>
      <p className="visits-changes small muted">
        Changed: {changes.slice(0, 6).map((c) => `${c.label} ${c.from} → ${c.to}`).join(" · ")}
        {changes.length > 6 && ` · +${changes.length - 6} more`}
      </p>
    </section>
  );
}
