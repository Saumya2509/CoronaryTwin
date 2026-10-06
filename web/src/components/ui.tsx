import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { RiskState } from "../api/types";
import { riskCss } from "../scene/colorScale";

const STATE_WORD: Record<RiskState, { clinician: string; patient: string }> = {
  Likely: { clinician: "Likely", patient: "Higher" },
  Uncertain: { clinician: "Uncertain", patient: "Unclear" },
  Unlikely: { clinician: "Unlikely", patient: "Lower" },
};

/** Square marker + word: state is never carried by color alone. */
export function State({ s, patient = false }: { s: RiskState; patient?: boolean }) {
  return (
    <span className={`state state-${s.toLowerCase()}`}>
      <span className="state-mark" aria-hidden="true" />
      {STATE_WORD[s][patient ? "patient" : "clinician"]}
    </span>
  );
}

/** Conformal state as marker + word (kept for panels that import it). */
export function StateBadge({ state, patient = false }: { state: RiskState; patient?: boolean }) {
  return <State s={state} patient={patient} />;
}

/** Text tabs used as a single-choice control (e.g. which model to explain). */
export function Segmented<T extends string>({
  label, value, options, onChange,
}: { label: string; value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    <div className="textswitch" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Yes/no control as a compact segmented pair. `checked = null` means not recorded:
 * neither option is selected, so a missing value never looks like a recorded "No".
 */
export function Switch({ id, checked, onChange, label }: { id: string; checked: boolean | null; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="yesno" role="radiogroup" aria-label={label} id={id}>
      <button type="button" role="radio" aria-checked={checked === false} onClick={() => onChange(false)}>No</button>
      <button type="button" role="radio" aria-checked={checked === true} onClick={() => onChange(true)}>Yes</button>
    </span>
  );
}

export function uncertaintyLevel(u: number): "Low" | "Moderate" | "High" {
  return u < 0.35 ? "Low" : u < 0.7 ? "Moderate" : "High";
}

// ---------------------------------------------------------------- md/10.md shared pieces

const PILL_ICON: Record<RiskState, string> = { Likely: "▲", Uncertain: "◇", Unlikely: "▼" };

/**
 * Status pill: filled with the risk color for a definite state, dashed outline for Uncertain.
 * The word (and an icon) always carry the meaning, never the color alone.
 */
export function Pill({ s, prob, patient = false, size = "md" }: { s: RiskState; prob: number; patient?: boolean; size?: "sm" | "md" }) {
  const style = s === "Uncertain" ? undefined : ({ "--risk": riskCss(prob) } as CSSProperties);
  return (
    <span className={`pill pill-${s.toLowerCase()} pill-${size}`} style={style}>
      <span aria-hidden="true" className="pill-icon">{PILL_ICON[s]}</span>
      {STATE_WORD[s][patient ? "patient" : "clinician"]}
    </span>
  );
}

/** Count a number up to its new value in ~400 ms (instant with reduced motion). */
export function useCountUp(value: number | null, ms = 400): number | null {
  const [shown, setShown] = useState(value);
  const from = useRef(value ?? 0);
  useEffect(() => {
    if (value === null) {
      setShown(null);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      from.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let id = 0;
    const tick = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const v = a + (value - a) * e;
      setShown(v);
      if (k < 1) id = requestAnimationFrame(tick);
      else from.current = value;
    };
    id = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(id);
      from.current = value;
    };
  }, [value, ms]);
  return shown;
}

/** Small on/off toggle (role="switch") replacing browser checkboxes in toolbars. */
export function Toggle({ label, checked, onChange, title }: { label: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="toggle" onClick={() => onChange(!checked)} title={title}>
      <span className="toggle-track" aria-hidden="true"><span className="toggle-knob" /></span>
      {label}
    </button>
  );
}

/** "70–92%" from a sub-model range. */
export const rangeText = (r: [number, number] | null | undefined): string | null =>
  r ? `${Math.round(r[0] * 100)}–${Math.round(r[1] * 100)}%` : null;
