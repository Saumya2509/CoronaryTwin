// Single source of truth (module 05 §3.8, module 06). The 3D scene, risk cards, SHAP panel,
// what-if and patient view all read this store, so they update together and can never
// disagree. A click on a vessel and a click on a risk card call the same `select`.
import { create } from "zustand";
import type { Source } from "../api/client";
import type { CohortSummary, FeaturesResponse, PatientRecord, PredictResponse, TargetResult } from "../api/types";

export type VesselId = string; // validated against anatomy.json VESSEL_IDS
export type ViewPreset = "anterior" | "posterior" | "left";
export type Audience = "clinician" | "patient";
export type Tab = "explain" | "whatif" | "trust" | "patient";

export interface ViewSettings {
  ghost: boolean;    // fade the heart so arteries are easy to see
  overlays: boolean; // explanation-on-anatomy overlays
  pulse: boolean;    // uncertainty pulse (off for reduced motion)
  lite: boolean;     // Lite mode: no blur, glow, heartbeat or idle drift; all information kept
}

interface RiskStore {
  // ---- prediction shown everywhere (3D colors, cards, panels)
  result: PredictResponse | null;
  /** Prediction for the entered values, before any what-if overrides. */
  base: PredictResponse | null;
  source: Source | null;
  loading: boolean;
  error: string | null;

  // ---- patient input
  spec: FeaturesResponse | null;
  inputs: PatientRecord;
  patientId: string;
  patientNote: string;
  /** Values confirmed from an uploaded report: feature -> file name (cleared when the value is edited). */
  provenance: Record<string, string>;

  // ---- what-if
  overrides: Record<string, number>;
  deltas: Record<string, number> | null;

  // ---- UI
  selected: VesselId | null;
  hovered: VesselId | null;
  audience: Audience;
  tab: Tab;
  view: ViewSettings;
  cameraRequest: { preset: ViewPreset; token: number };
  /** Patient record drawer (md/10.md: inputs live in a slide-over). */
  drawerOpen: boolean;
  /** Present mode step index, or null when not presenting. */
  present: number | null;
  /** Set once the user touches the 3D scene: stops the idle camera drift. */
  touched: boolean;
  /** Explanation group hovered in the waterfall or drivers card; its glow/gauge lights up in 3D. */
  hoverGroup: string | null;
  /** Cohort mode: the 3D heart shows the cohort averages instead of one patient (md/improve.md P1.11). */
  cohort: { name: string; summary: CohortSummary } | null;
  /** Feature 3: a saved earlier visit of this patient (kept in memory only, never stored). */
  visit: VisitSnapshot | null;
  /** Visit comparison: 0 = the saved visit, 1 = now; null when not comparing. */
  compare: number | null;
  /** The inputs `base` was computed from (same object as `inputs` once the estimate is current). */
  baseInputs: PatientRecord | null;
  /** Navigation sidebar (md/final.md part 1): collapsed to an icon rail; open as a drawer on phones. */
  sidebarCollapsed: boolean;
  sidebarOpen: boolean;
  /** The "Read reports" dialog, so the sidebar can open it too. */
  reportsOpen: boolean;
  /** Demo mode (md/final.md part 2): the sample patients and which one is shown. */
  demo: { sets: DemoPatientSet[]; active: number } | null;
  /** Short status message shown as a toast (e.g. a demo file that failed to load). */
  toast: string | null;

  setSpec: (spec: FeaturesResponse) => void;
  loadPatient: (inputs: PatientRecord, patientId: string, note: string) => void;
  setPatientId: (id: string) => void;
  setInput: (name: string, value: PatientRecord[string]) => void;
  /** Merge confirmed report values into the record (starting a new one if none is loaded). */
  applyReport: (values: PatientRecord, provenance: Record<string, string>, note: string) => void;
  setPrediction: (result: PredictResponse, source: Source, scored?: PatientRecord) => void;
  setWhatIf: (overrides: Record<string, number>, result: PredictResponse | null, deltas: Record<string, number> | null) => void;
  resetWhatIf: () => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  select: (id: VesselId | null) => void;
  hover: (id: VesselId | null) => void;
  setAudience: (a: Audience) => void;
  setTab: (t: Tab) => void;
  setView: (patch: Partial<ViewSettings>) => void;
  requestView: (preset: ViewPreset) => void;
  setDrawer: (open: boolean) => void;
  setPresent: (step: number | null) => void;
  touch: () => void;
  setHoverGroup: (g: string | null) => void;
  setCohort: (c: RiskStore["cohort"]) => void;
  setSidebarCollapsed: (v: boolean) => void;
  setSidebarOpen: (v: boolean) => void;
  setReportsOpen: (v: boolean) => void;
  setDemo: (d: RiskStore["demo"]) => void;
  setToast: (t: string | null) => void;
  /** Back to "no patient loaded". */
  clearPatient: () => void;
  saveVisit: () => void;
  clearVisit: () => void;
  setCompare: (t: number | null) => void;
}

export interface DemoPatientSet {
  file: string;
  label: string;
  description: string;
  record: PatientRecord;
  patientId: string;
}

const SIDEBAR_KEY = "coronarytwin.sidebar";
function initialCollapsed(): boolean {
  try {
    return typeof window !== "undefined" && window.localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export interface VisitSnapshot {
  label: string;
  savedAt: number;
  inputs: PatientRecord;
  result: PredictResponse;
}

const prefersReducedMotion =
  typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export const useRisk = create<RiskStore>((set) => ({
  result: null,
  base: null,
  source: null,
  loading: false,
  error: null,
  spec: null,
  inputs: {},
  patientId: "",
  patientNote: "",
  provenance: {},
  overrides: {},
  deltas: null,
  selected: null,
  hovered: null,
  audience: "clinician",
  tab: "explain",
  view: { ghost: false, overlays: true, pulse: !prefersReducedMotion, lite: false },
  cameraRequest: { preset: "anterior", token: 0 },
  drawerOpen: false,
  present: null,
  touched: false,
  hoverGroup: null,
  cohort: null,
  visit: null,
  compare: null,
  baseInputs: null,
  sidebarCollapsed: initialCollapsed(),
  sidebarOpen: false,
  reportsOpen: false,
  demo: null,
  toast: null,

  setSpec: (spec) => set({ spec }),
  loadPatient: (inputs, patientId, patientNote) =>
    set({ inputs: { ...inputs }, patientId, patientNote, provenance: {}, overrides: {}, deltas: null, cohort: null, visit: null, compare: null, demo: null }),
  setPatientId: (patientId) => set({ patientId }),
  setInput: (name, value) =>
    set((s) => {
      const { [name]: _edited, ...provenance } = s.provenance;
      return { inputs: { ...s.inputs, [name]: value }, provenance, patientId: s.patientId, overrides: {}, deltas: null };
    }),
  applyReport: (values, provenance, note) =>
    set((s) => {
      const fresh = Object.keys(s.inputs).length === 0;
      const blank = fresh && s.spec ? Object.fromEntries(s.spec.features.map((f) => [f.name, null])) : {};
      return {
        inputs: { ...blank, ...s.inputs, ...values },
        provenance: { ...(fresh ? {} : s.provenance), ...provenance },
        patientId: fresh ? "from-reports" : s.patientId,
        patientNote: note,
        overrides: {}, deltas: null, cohort: null,
        ...(fresh ? { visit: null, compare: null } : {}),
        demo: null,
      };
    }),
  // A new baseline prediction replaces any what-if state. While it loads, the previous
  // result stays on screen (no flash of empty values).
  setPrediction: (result, source, scored) =>
    set((s) => ({ result, base: result, baseInputs: scored ?? s.inputs, source, loading: false, error: null, overrides: {}, deltas: null, compare: null })),
  setWhatIf: (overrides, result, deltas) =>
    set((s) => ({ overrides, deltas: deltas ?? s.deltas, result: result ?? s.result, loading: false, error: null })),
  resetWhatIf: () => set((s) => ({ overrides: {}, deltas: null, result: s.base })),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  select: (selected) => set({ selected }),
  hover: (hovered) => set({ hovered }),
  // Patient view starts with explanation overlays off (one soft glow, fewer marks); clinician on.
  setAudience: (audience) => set((s) => ({ audience, view: { ...s.view, overlays: audience === "clinician" } })),
  setTab: (tab) => set({ tab }),
  setView: (patch) => set((s) => ({ view: { ...s.view, ...patch } })),
  requestView: (preset) => set((s) => ({ cameraRequest: { preset, token: s.cameraRequest.token + 1 }, selected: null })),
  setDrawer: (drawerOpen) => set({ drawerOpen }),
  setPresent: (present) => set({ present }),
  touch: () => set({ touched: true }),
  setHoverGroup: (hoverGroup) => set({ hoverGroup }),
  setCohort: (cohort) => set({ cohort, selected: null }),
  setSidebarCollapsed: (sidebarCollapsed) => {
    try {
      window.localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "collapsed" : "open");
    } catch { /* storage blocked */ }
    set({ sidebarCollapsed });
  },
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setReportsOpen: (reportsOpen) => set({ reportsOpen }),
  setDemo: (demo) => set({ demo }),
  setToast: (toast) => set({ toast }),
  clearPatient: () =>
    set({ inputs: {}, patientId: "", patientNote: "", provenance: {}, result: null, base: null, baseInputs: null,
      overrides: {}, deltas: null, cohort: null, visit: null, compare: null, demo: null, selected: null }),
  saveVisit: () =>
    set((s) => (s.base ? {
      visit: { label: "Visit 1", savedAt: Date.now(), inputs: { ...(s.baseInputs ?? s.inputs) }, result: s.base },
      compare: null,
    } : {})),
  clearVisit: () => set((s) => ({ visit: null, compare: null, result: s.base })),
  // Endpoints show real model outputs; positions in between only blend the colors for the animation.
  setCompare: (t) =>
    set((s) => {
      if (t === null || !s.visit || !s.base) return { compare: null, result: s.base };
      return { compare: t, result: blendResult(s.visit.result, s.base, t), overrides: {}, deltas: null, cohort: null };
    }),
}));

// ---------------------------------------------------------------- visit comparison (feature 3)

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function blendTarget<T extends TargetResult>(a: T, b: T, t: number): T {
  const near = t < 0.5 ? a : b;
  return {
    ...near,
    prob: lerp(a.prob, b.prob, t),
    uncertainty: lerp(a.uncertainty, b.uncertainty, t),
    range: a.range && b.range ? [lerp(a.range[0], b.range[0], t), lerp(a.range[1], b.range[1], t)] : near.range,
  };
}

/** The visit result at position t between the saved visit (0) and now (1). Exact at both ends. */
export function blendResult(a: PredictResponse, b: PredictResponse, t: number): PredictResponse {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const near = t < 0.5 ? a : b;
  return {
    ...near,
    overall: blendTarget(a.overall, b.overall, t),
    vessels: Object.fromEntries(Object.keys(b.vessels).map((v) => [v, a.vessels[v] ? blendTarget(a.vessels[v], b.vessels[v], t) : b.vessels[v]])),
  };
}

export const prefersReducedMotionNow = (): boolean =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------- cohort mode

const cohortCache = new WeakMap<CohortSummary, Record<string, TargetResult>>();

/**
 * One target of a cohort summary as a TargetResult: the mean probability, and the state most
 * patients in the cohort have (ties count as Uncertain). Cached per summary so store selectors
 * return a stable object.
 */
export function cohortResult(summary: CohortSummary, target: string): TargetResult | null {
  let byTarget = cohortCache.get(summary);
  if (!byTarget) {
    byTarget = {};
    for (const [t, c] of Object.entries(summary.targets)) {
      const max = Math.max(c.likely, c.uncertain, c.unlikely);
      const state = c.likely === max && c.likely > c.uncertain && c.likely > c.unlikely ? "Likely"
        : c.unlikely === max && c.unlikely > c.uncertain && c.unlikely > c.likely ? "Unlikely" : "Uncertain";
      byTarget[t] = {
        prob: c.mean_prob, uncertainty: c.uncertain / Math.max(1, summary.n), state,
        set: state === "Likely" ? ["CAD"] : state === "Unlikely" ? ["No CAD"] : ["CAD", "No CAD"], range: null,
      };
    }
    cohortCache.set(summary, byTarget);
  }
  return byTarget[target] ?? null;
}

/** Result for one vessel (the cohort average in cohort mode), or null before the first prediction. */
export const useVessel = (id: VesselId): TargetResult | null =>
  useRisk((s) => (s.cohort ? cohortResult(s.cohort.summary, id) : s.result?.vessels[id] ?? null));

/** Overall-model key (the explanation key that is not a vessel), e.g. "CAD". */
export const overallKey = (r: PredictResponse | null): string =>
  (r && Object.keys(r.explanations).find((k) => !(k in r.vessels))) ?? "CAD";
