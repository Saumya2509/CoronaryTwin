// Present mode (md/10.md section 20): a self-driving walkthrough on the stage, for judges and the
// demo video. Steps: overview, one per artery, why, what-if. Every caption is generated from the
// loaded patient's real numbers and never claims more than they show. Space / arrows move steps,
// Esc exits, auto-advance every 9 s with a pause button. The safety banner stays visible.
import { useEffect, useMemo, useRef, useState } from "react";
import { getDemoPatients } from "../api/client";
import type { FeatureSpec, PatientRecord, PredictResponse } from "../api/types";
import { anatomy } from "../anatomy";
import { patientPhrase, pct, specMap } from "../features";
import { groupShares } from "../scene/Overlays";
import { overallKey, useRisk } from "../store/risk";
import { rangeText } from "./ui";
import { fixedDrivers } from "./WhatIf";

const STEP_MS = 9000;
const st = () => useRisk.getState();

interface Step { id: string; label: string }

const STEPS: Step[] = [
  { id: "overview", label: "Overview" },
  ...anatomy.vessels.map((v) => ({ id: v.id, label: v.patient_label })),
  { id: "why", label: "Why" },
  { id: "whatif", label: "What-if" },
];

/** Move every modifiable value that lies outside its normal range back to that range. */
function normalizingOverrides(inputs: PatientRecord): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of st().spec?.features ?? []) {
    const v = inputs[f.name];
    if (!f.modifiable || typeof v !== "number") continue;
    if (f.type === "binary" && v === 1) out[f.name] = 0;
    const [lo, hi] = f.normal_range ?? [null, null];
    if (f.type === "numeric" && hi != null && v > hi) out[f.name] = hi;
    if (f.type === "numeric" && lo != null && v < lo) out[f.name] = lo;
  }
  return out;
}

const join = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function caption(step: Step, r: PredictResponse, patient: boolean, labels: Record<string, string>, applied: Record<string, number>, deltas: Record<string, number> | null, base: PredictResponse | null, fixed: string[] = [], specs: Record<string, FeatureSpec> = {}): string {
  const okey = overallKey(r);
  const words = { Likely: patient ? "higher" : "likely", Unlikely: patient ? "lower" : "unlikely", Uncertain: patient ? "unclear" : "uncertain" };
  if (step.id === "overview") {
    const n = anatomy.vessels.filter((v) => r.vessels[v.id]?.state === "Uncertain").length;
    const range = r.overall.range && !patient ? `, sub-model range ${rangeText(r.overall.range)}` : "";
    return `Overall estimate for any main heart artery: ${pct(r.overall.prob)} (${words[r.overall.state]}${range}). ` +
      (n === 0 ? "All three arteries have a definite estimate." : `${n} of ${anatomy.vessels.length} arteries are uncertain: both outcomes stay possible.`);
  }
  const v = anatomy.vessels.find((x) => x.id === step.id);
  if (v) {
    const vr = r.vessels[v.id];
    const top = r.explanations[v.id]?.features.find((f) => f.shap !== 0);
    const highest = anatomy.vessels.every((x) => (r.vessels[x.id]?.prob ?? 0) <= vr.prob);
    const parts = [`${v.patient_label} (${v.id}): ${pct(vr.prob)}, ${words[vr.state]}${vr.range && !patient ? `, range ${rangeText(vr.range)}` : ""}.`];
    if (highest) parts.push("This is the artery the model is most concerned about.");
    if (vr.state === "Uncertain") parts.push("The model is less sure here: note the dashed, translucent artery.");
    const topName = top && (patient && specs[top.name] ? patientPhrase(specs[top.name], top.value, top.name) : labels[top.name] ?? top.name);
    if (top) parts.push(`${topName} ${top.shap > 0 ? "raised" : "lowered"} this estimate the most.`);
    return parts.join(" ");
  }
  if (step.id === "why") {
    const shares = groupShares(r.explanations[okey]).sort((a, b) => b.share - a.share);
    if (!shares.length) return "No measurement group stood out.";
    const [a, b] = shares;
    return `${a.group} measurements moved the overall estimate the most (${pct(a.share)} of the explanation, ${a.value >= 0 ? "upward" : "downward"})` +
      (b ? `, then ${b.group} (${pct(b.share)}).` : ".") + " The glows on the heart show the same shares. These are associations, not causes.";
  }
  // what-if
  const names = Object.keys(applied).map((n) => labels[n] ?? n);
  if (!names.length) return "None of the modifiable values is outside its normal range, so there is nothing to move. Try the What-if tab yourself.";
  if (!deltas || !base) return `Moving ${join(names)} back to normal…`;
  const d = deltas[okey] ?? 0;
  const why = Math.abs(d) < 0.05 && fixed.length
    ? ` The change is small because the strongest drivers here (${join(fixed.map((x) => x.toLowerCase()))}) cannot be modified.`
    : "";
  return `Moving ${join(names)} back to normal changes the overall estimate from ${pct(base.overall.prob)} to ${pct(base.overall.prob + d)}.${why} ` +
    "This shows model sensitivity, not treatment advice.";
}

function enter(step: Step, applied: { current: Record<string, number> }) {
  const s = st();
  if (step.id !== "whatif" && Object.keys(applied.current).length) {
    s.resetWhatIf();
    applied.current = {};
  }
  if (step.id === "overview") {
    s.requestView("anterior");
  } else if (anatomy.vessels.some((v) => v.id === step.id)) {
    s.select(step.id);
  } else if (step.id === "why") {
    s.select(null);
    s.requestView("anterior");
    s.setView({ overlays: true });
    s.setTab("explain");
  } else if (step.id === "whatif") {
    s.select(null);
    s.setTab("whatif");
    const o = normalizingOverrides(s.inputs);
    applied.current = o;
    if (Object.keys(o).length) s.setWhatIf(o, null, null);
  }
}

export function PresentBar() {
  const present = useRisk((s) => s.present);
  const setPresent = useRisk((s) => s.setPresent);
  const result = useRisk((s) => s.result);
  const base = useRisk((s) => s.base);
  const deltas = useRisk((s) => s.deltas);
  const patient = useRisk((s) => s.audience === "patient");
  const spec = useRisk((s) => s.spec);
  const [paused, setPaused] = useState(false);
  const applied = useRef<Record<string, number>>({});
  const labels = useMemo(() => {
    const m = specMap(spec);
    return Object.fromEntries(Object.values(m).map((f) => [f.name, patient ? f.patient_text : f.label]));
  }, [spec, patient]);

  const active = present !== null && result !== null;
  const step = present ?? 0;

  // Enter the step: drive the same store actions a user would.
  useEffect(() => {
    if (present === null) return;
    enter(STEPS[present], applied);
  }, [present]);

  // Leaving Present mode undoes its what-if and releases the camera.
  useEffect(() => {
    if (present !== null) {
      document.querySelector(".stage")?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setPaused(false);
    if (Object.keys(applied.current).length) {
      st().resetWhatIf();
      applied.current = {};
    }
  }, [present === null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-advance.
  useEffect(() => {
    if (!active || paused || step >= STEPS.length - 1) return;
    const t = window.setTimeout(() => setPresent(step + 1), STEP_MS);
    return () => window.clearTimeout(t);
  }, [active, paused, step, setPresent]);

  // Keyboard: Space / arrows move steps, Esc exits (ignored while typing in a field).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, select, textarea, [role='slider']")) return;
      if (e.key === "Escape") setPresent(null);
      else if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        setPresent(Math.min(step + 1, STEPS.length - 1));
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setPresent(Math.max(step - 1, 0));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, step, setPresent]);

  if (!active || !result) return null;
  const s = STEPS[step];
  return (
    <div className="present glass" role="region" aria-label="Present mode" aria-roledescription="presentation">
      <ol className="present-steps">
        {STEPS.map((x, i) => (
          <li key={x.id}>
            <button type="button" aria-current={i === step ? "step" : undefined} className={i < step ? "done" : ""} onClick={() => setPresent(i)}>
              <span className="present-n">{i + 1}</span> {x.label}
            </button>
          </li>
        ))}
      </ol>
      <p className="present-caption" aria-live="polite">{caption(s, result, patient, labels, applied.current, deltas, base, fixedDrivers(base, specMap(spec)), specMap(spec))}</p>
      <div className="present-controls">
        <span className="present-progress" aria-hidden="true">
          {!paused && step < STEPS.length - 1 && <span key={step} style={{ animationDuration: `${STEP_MS}ms` }} />}
        </span>
        <button type="button" className="btn small" onClick={() => setPresent(Math.max(step - 1, 0))} disabled={step === 0}>Back</button>
        <button type="button" className="btn small" onClick={() => setPaused((p) => !p)} aria-pressed={paused} disabled={step === STEPS.length - 1}>{paused ? "Resume" : "Pause"}</button>
        {step < STEPS.length - 1
          ? <button type="button" className="btn small primary" onClick={() => setPresent(step + 1)}>Next</button>
          : <button type="button" className="btn small primary" onClick={() => setPresent(null)}>Finish</button>}
        <button type="button" className="linkbtn small" onClick={() => setPresent(null)}>Exit (Esc)</button>
      </div>
    </div>
  );
}

/**
 * Header "Guided tour": with no patient loaded, load a real dataset patient (GET /demo-patients,
 * only on request) and then start Present mode; otherwise present the current patient.
 */
export async function startGuidedTour(): Promise<void> {
  const s = st();
  if (!s.result) {
    const d = await getDemoPatients();
    // "mixed": one confident artery and two uncertain ones, so both visual channels appear.
    const p = d.mixed ?? d.high ?? Object.values(d)[0];
    if (!p?.features) throw new Error("no demo patient available");
    s.loadPatient(p.features, `tour-${p.patient_id}`, "Guided tour: a real, anonymized patient from the dataset.");
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        unsub();
        reject(new Error("the API did not return an estimate in time"));
      }, 20000);
      const unsub = useRisk.subscribe((x) => {
        if (x.result) {
          window.clearTimeout(timer);
          unsub();
          resolve();
        }
      });
    });
  }
  st().setDrawer(false);
  st().setPresent(0);
}
