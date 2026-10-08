// Sample patients behind the CSV button: the ten invented patients listed in csv/demo.json (served by
// GET /demo-set). The dialog lists them, the judge picks one, and it opens like an uploaded CSV. A file
// that fails to load or parse is left out with a message; the dashboard never ends up half-loaded.
import { getDemoSet } from "./api/client";
import { parsePatientCsv } from "./csv";
import { useRisk, type DemoPatientSet } from "./store/risk";

let cache: DemoPatientSet[] | null = null;

/** The sample patients, fetched and parsed once. Null (with a toast) when they cannot be loaded. */
export async function getSamples(): Promise<DemoPatientSet[] | null> {
  if (cache) return cache;
  const st = useRisk.getState();
  if (!st.spec) {
    st.setToast("The samples need the API: start it with python tasks.py serve.");
    return null;
  }
  let res;
  try {
    res = await getDemoSet();
  } catch (e) {
    st.setToast(`Sample files could not be loaded: ${(e as Error).message}`);
    return null;
  }
  const skipped = [...res.errors];
  const sets: DemoPatientSet[] = [];
  res.demo.forEach((d, i) => {
    try {
      const row = parsePatientCsv(d.csv, st.spec!).rows[0];
      if (!row || row.issues.length) throw new Error(row ? row.issues.join("; ") : "no patient row");
      sets.push({ file: d.file, label: d.label, description: d.description, record: row.record,
        patientId: `sample-${String(i + 1).padStart(2, "0")}`, csv: d.csv });
    } catch (e) {
      skipped.push(`${d.file}: ${(e as Error).message}`);
    }
  });
  if (!sets.length) {
    st.setToast(`Sample files not found or unreadable${skipped.length ? ` (${skipped.join("; ")})` : ""}.`);
    return null;
  }
  if (skipped.length) st.setToast(`Loaded ${sets.length} of ${sets.length + skipped.length} samples. Skipped: ${skipped.join("; ")}`);
  cache = sets;
  return sets;
}

/** Open sample i (0-based) in the report. */
export async function openSample(i: number): Promise<void> {
  const sets = await getSamples();
  if (!sets || !sets[i]) return;
  const st = useRisk.getState();
  const s = sets[i];
  st.loadPatient(s.record, s.patientId, `Sample ${i + 1} of ${sets.length} · ${s.label}: ${s.description}`);
  st.setDemo({ sets, active: i });
}

export function showDemo(i: number) {
  void openSample(i);
}

export function exitDemo() {
  useRisk.getState().clearPatient();
}

/** Let the judge look at the actual file: download sample i as CSV. */
export function downloadSample(s: DemoPatientSet) {
  const url = URL.createObjectURL(new Blob([s.csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = s.file;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
