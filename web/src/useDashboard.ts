// Data flow (module 07 §2.6): edit a value -> debounce ~250 ms -> POST /predict ->
// one store update -> 3D colors and every panel re-render together.
// There are no built-in demo patients: the report starts empty until a patient is
// entered (New patient) or uploaded (Upload CSV; sample files live in csv/).
import { useEffect, useRef, useState } from "react";
import { apiReady, getFeatures, predict, whatIf } from "./api/client";
import { VESSEL_IDS } from "./anatomy";
import { specMap, validate } from "./features";
import { useRisk } from "./store/risk";

const DEBOUNCE_MS = 250;

export function useDashboard() {
  const [online, setOnline] = useState<boolean | null>(null);
  const inputs = useRisk((s) => s.inputs);
  const overrides = useRisk((s) => s.overrides);
  const spec = useRisk((s) => s.spec);
  const predictCtl = useRef<AbortController | null>(null);
  const whatifCtl = useRef<AbortController | null>(null);

  // Boot: health -> feature registry. View settings can be deep-linked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const q = new URLSearchParams(window.location.search);
      const st = useRisk.getState();
      const view = q.get("view");
      if (view === "anterior" || view === "posterior" || view === "left") st.requestView(view);
      if (q.get("ghost") === "1") st.setView({ ghost: true });
      if (q.get("lite") === "1") st.setView({ lite: true });
      // Wide screens start with the patient record docked open, so the first step is visible.
      if (window.innerWidth >= 1280 && q.get("drawer") !== "0") st.setDrawer(true);
      if (q.get("audience") === "patient") st.setAudience("patient");
      const tab = q.get("tab");
      if (tab === "explain" || tab === "whatif" || tab === "trust" || tab === "patient") st.setTab(tab);
      const sel = q.get("select");
      if (sel && VESSEL_IDS.includes(sel)) st.select(sel);

      const ready = await apiReady();
      if (cancelled) return;
      setOnline(ready);
      if (ready) {
        const features = await getFeatures();
        if (!cancelled) st.setSpec(features);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Debounced prediction whenever the entered values change (and are all valid).
  useEffect(() => {
    if (!online || !spec || Object.keys(inputs).length === 0) return;
    const specs = specMap(spec);
    const invalid = Object.entries(inputs).some(([k, v]) => specs[k] && validate(specs[k], v));
    if (invalid) return;
    const t = window.setTimeout(async () => {
      predictCtl.current?.abort();
      const ctl = new AbortController();
      predictCtl.current = ctl;
      const st = useRisk.getState();
      st.setLoading(true);
      try {
        st.setPrediction(await predict(inputs, st.patientId || "patient", ctl.signal), "api", inputs);
      } catch (e) {
        if ((e as Error).name !== "AbortError") st.setError((e as Error).message);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [inputs, online, spec]);

  // Debounced what-if whenever overrides change.
  useEffect(() => {
    if (!online || Object.keys(overrides).length === 0) return;
    const t = window.setTimeout(async () => {
      whatifCtl.current?.abort();
      const ctl = new AbortController();
      whatifCtl.current = ctl;
      const st = useRisk.getState();
      st.setLoading(true);
      try {
        const res = await whatIf(st.inputs, overrides, st.patientId || "patient", ctl.signal);
        if (useRisk.getState().overrides === overrides) st.setWhatIf(overrides, res.whatif, res.deltas);
      } catch (e) {
        if ((e as Error).name !== "AbortError") st.setError((e as Error).message);
      }
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [overrides, online]);

  return { online };
}
