// The hero's live readout: a real dataset patient scored by the trained models, shown beside the
// 3D heart. It is kept apart from the report's store, so the report still starts empty unless the
// visitor chooses "Open this patient in the report".
import { useEffect, useMemo, useRef, useState } from "react";
import { getDemoPatients, predictTimed } from "../api/client";
import type { DemoPatient, FeaturesResponse, PredictResponse, TargetResult } from "../api/types";
import { anatomy } from "../anatomy";
import { riskCss } from "../scene/colorScale";
import { Icon, useCountUp } from "./parts";

const ORDER = ["high", "mixed", "low", "discordant"] as const;
const NAMES: Record<string, string> = { high: "High risk", mixed: "Mixed", low: "Low risk", discordant: "Disagreement" };

export interface LivePatient {
  demos: Record<string, DemoPatient> | null;
  key: string;
  setKey: (k: string) => void;
  result: PredictResponse | null;
  /** Server processing time for the latest prediction (round trip if the header is not exposed). */
  latencyMs: number | null;
  loading: boolean;
  error: boolean;
}

/** Loads the four dataset patients and scores the chosen one live. */
export function useLivePatient(online: boolean | null): LivePatient {
  const [demos, setDemos] = useState<Record<string, DemoPatient> | null>(null);
  const [key, setKey] = useState<string>("high");
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [latencyMs, setLatency] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!online) return;
    getDemoPatients().then(setDemos).catch(() => setError(true));
  }, [online]);

  useEffect(() => {
    const d = demos?.[key];
    if (!d?.features) return;
    const ctl = new AbortController();
    setLoading(true);
    const t0 = performance.now();
    predictTimed(d.features, d.patient_id, ctl.signal)
      .then(({ result: r, serverMs }) => {
        setLatency(Math.round(serverMs ?? performance.now() - t0));
        setResult(r);
        setError(false);
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") setError(true); })
      .finally(() => { if (!ctl.signal.aborted) setLoading(false); });
    return () => ctl.abort();
  }, [demos, key]);

  return { demos, key, setKey, result, latencyMs, loading, error };
}

function StatePill({ r }: { r: TargetResult }) {
  const cls = r.state === "Likely" ? "is-likely" : r.state === "Uncertain" ? "is-uncertain" : "is-unlikely";
  return (
    <span className={`lp-pill ${cls}`} style={r.state === "Likely" ? { background: riskCss(r.prob) } : undefined}>
      {r.state}
    </span>
  );
}

function ArteryRow({ id, label, r, active, onFocus }: { id: string; label: string; r: TargetResult; active: boolean; onFocus: (id: string | null) => void }) {
  const n = useCountUp(r.prob * 100);
  const [lo, hi] = r.range ?? [r.prob, r.prob];
  return (
    <li>
      <button
        type="button"
        className={`lp-artery${active ? " is-active" : ""}${r.state === "Uncertain" ? " is-unsure" : ""}`}
        aria-pressed={active}
        onMouseEnter={() => onFocus(id)}
        onFocus={() => onFocus(id)}
        onClick={() => onFocus(active ? null : id)}
      >
        <span className="lp-artery-id lp-mono">{id}</span>
        <span className="lp-artery-name">{label}</span>
        <span className="lp-artery-num lp-mono">{n === null ? "" : `${Math.round(n)}%`}</span>
        <StatePill r={r} />
        <span className="lp-artery-bar" aria-hidden="true">
          <span className="lp-artery-range" style={{ left: `${lo * 100}%`, width: `${Math.max(0.5, (hi - lo) * 100)}%` }} />
          <span className="lp-artery-fill" style={{ width: `${r.prob * 100}%`, background: riskCss(r.prob) }} />
          {r.threshold != null && <span className="lp-artery-tick" style={{ left: `${r.threshold * 100}%` }} />}
        </span>
      </button>
    </li>
  );
}

interface PatientHudProps {
  live: LivePatient;
  spec: FeaturesResponse | null;
  focus: string | null;
  onFocus: (id: string | null) => void;
  onOpen: () => void;
}

export function PatientHud({ live, spec, focus, onFocus, onOpen }: PatientHudProps) {
  const { demos, key, setKey, result, latencyMs, loading, error } = live;
  const overall = useCountUp(result ? result.overall.prob * 100 : null);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);

  // Drivers for the focused artery, or the highest-risk artery when nothing is focused.
  const driverId = useMemo(() => {
    if (!result) return null;
    if (focus && result.explanations[focus]) return focus;
    return anatomy.vessels.map((v) => v.id).filter((id) => result.vessels[id])
      .sort((a, b) => result.vessels[b].prob - result.vessels[a].prob)[0] ?? null;
  }, [result, focus]);
  const drivers = useMemo(() => {
    const feats = driverId ? result?.explanations[driverId]?.features ?? [] : [];
    const top = [...feats].sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap)).slice(0, 3);
    const max = Math.max(1e-9, ...top.map((f) => Math.abs(f.shap)));
    return top.map((f) => ({ ...f, label: spec?.features.find((s) => s.name === f.name)?.label ?? f.name, w: Math.abs(f.shap) / max }));
  }, [driverId, result, spec]);

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    e.preventDefault();
    const next = (i + (e.key === "ArrowRight" ? 1 : ORDER.length - 1)) % ORDER.length;
    setKey(ORDER[next]);
    tabs.current[next]?.focus();
  };

  if (error && !result) {
    return (
      <aside className="lp-hud" aria-label="Live patient">
        <p className="lp-hud-empty">The live patient needs the API. Start it with <code>python tasks.py serve</code> and reload.</p>
      </aside>
    );
  }

  return (
    <aside className={`lp-hud${loading ? " is-loading" : ""}`} aria-label="Live patient" aria-busy={loading}>
      <div className="lp-hud-head">
        <span className="lp-live-label"><span className="lp-live" aria-hidden="true" /> Live</span>
        <span className="lp-hud-meta lp-mono">
          {result ? `${result.patient_id.replace("demo-", "patient ")} · ${latencyMs ?? "…"} ms` : "scoring…"}
        </span>
      </div>

      <div className="lp-seg" role="tablist" aria-label="Real patients from the dataset">
        {ORDER.map((k, i) => (
          <button
            key={k}
            ref={(el) => { tabs.current[i] = el; }}
            type="button"
            role="tab"
            aria-selected={key === k}
            tabIndex={key === k ? 0 : -1}
            className={key === k ? "is-on" : ""}
            onClick={() => setKey(k)}
            onKeyDown={(e) => onTabKey(e, i)}
            disabled={!demos}
          >
            {NAMES[k]}
          </button>
        ))}
      </div>
      <p className="lp-hud-desc">{demos?.[key]?.description ?? "Real patients from the dataset, scored live."}</p>

      {result ? (
        <>
          <div className="lp-overall">
            <span className="lp-overall-label">Overall disease</span>
            <span className="lp-overall-num lp-mono">{overall === null ? "" : `${Math.round(overall)}%`}</span>
            <StatePill r={result.overall} />
          </div>
          {result.coherence.flag && <p className="lp-hud-flag">Models disagree: {result.coherence.note}</p>}

          <ul className="lp-arteries" onMouseLeave={() => onFocus(null)}>
            {anatomy.vessels.map((v) => result.vessels[v.id] && (
              <ArteryRow key={v.id} id={v.id} label={v.label} r={result.vessels[v.id]} active={focus === v.id} onFocus={onFocus} />
            ))}
          </ul>

          {driverId && drivers.length > 0 && (
            <div className="lp-drivers-box">
              <p className="lp-hud-sub">Top reasons for <span className="lp-mono">{driverId}</span></p>
              <ul>
                {drivers.map((d) => (
                  <li key={d.name}>
                    <span className="lp-driver-name">{d.label}</span>
                    <span className="lp-driver-bar" aria-hidden="true">
                      <span className={d.shap >= 0 ? "up" : "down"} style={{ width: `${Math.max(8, d.w * 100)}%` }} />
                    </span>
                    <span className="lp-driver-dir">{d.shap >= 0 ? "raises" : "lowers"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <button type="button" className="lp-btn lp-btn-quiet lp-hud-open" onClick={onOpen}>
            Open this patient in the report <Icon name="arrow" size={16} />
          </button>
        </>
      ) : (
        <div className="lp-hud-skeleton" aria-label="Scoring the patient">
          {Array.from({ length: 4 }, (_, i) => <span key={i} />)}
        </div>
      )}
    </aside>
  );
}
