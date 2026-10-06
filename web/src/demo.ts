// "Try Demo" (md/final.md part 2): one click loads the five sample patients listed in csv/demo.json
// (served by GET /demo-set), shows the first, and lets judges switch between them. A file that fails
// to load or parse is skipped with a message; the dashboard never ends up half-loaded.
import { getDemoSet } from "./api/client";
import { parsePatientCsv } from "./csv";
import { useRisk, type DemoPatientSet } from "./store/risk";

export function showDemo(i: number) {
  const st = useRisk.getState();
  const d = st.demo;
  if (!d || !d.sets[i]) return;
  const s = d.sets[i];
  st.loadPatient(s.record, s.patientId, `Demo data · ${s.label}: ${s.description}`);
  st.setDemo({ ...d, active: i });
}

export async function loadDemo(): Promise<void> {
  const st = useRisk.getState();
  if (!st.spec) {
    st.setToast("The demo needs the API: start it with python tasks.py serve.");
    return;
  }
  let res;
  try {
    res = await getDemoSet();
  } catch (e) {
    st.setToast(`Demo files could not be loaded: ${(e as Error).message}`);
    return;
  }
  const skipped = [...res.errors];
  const sets: DemoPatientSet[] = [];
  res.demo.forEach((d, i) => {
    try {
      const row = parsePatientCsv(d.csv, st.spec!).rows[0];
      if (!row || row.issues.length) throw new Error(row ? row.issues.join("; ") : "no patient row");
      sets.push({ file: d.file, label: d.label, description: d.description, record: row.record,
        patientId: `demo-${i + 1}` });
    } catch (e) {
      skipped.push(`${d.file}: ${(e as Error).message}`);
    }
  });
  if (!sets.length) {
    st.setToast(`Demo files not found or unreadable${skipped.length ? ` (${skipped.join("; ")})` : ""}.`);
    return;
  }
  st.setDemo({ sets, active: 0 });
  showDemo(0);
  if (skipped.length) st.setToast(`Demo loaded ${sets.length} of ${sets.length + skipped.length} samples. Skipped: ${skipped.join("; ")}`);
}

export function exitDemo() {
  useRisk.getState().clearPatient();
}
