// Speciality S3: for a partially filled record, which missing measurement would most change the
// estimate. The API fills each blank with values seen in similar training patients and measures
// how far the probabilities move (src/nextbest.py). Ranked by model uncertainty, not clinical need.
import { nextBestTest } from "../api/client";
import type { NextBestItem, PredictResponse } from "../api/types";
import { anatomy } from "../anatomy";
import { pct } from "../features";
import { overallKey, useRisk } from "../store/risk";
import { useLive } from "../useLive";

const hasMissing = (b: PredictResponse) => (b.imputed?.length ?? 0) > 0;

function focusField(name: string) {
  useRisk.getState().setDrawer(true);
  // The drawer slides in first; focus once it is laid out.
  window.setTimeout(() => focusFieldNow(name), 260);
}

function focusFieldNow(name: string) {
  const el = document.getElementById(`f-${name}`);
  if (!el) return;
  const group = el.closest("details");
  if (group) group.open = true;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  (el.querySelector("button, input, select") as HTMLElement | null ?? el).focus({ preventScroll: true });
}

/** "LCX would become definite for 72% of plausible values" for targets that are Uncertain now. */
function settles(item: NextBestItem, current: Record<string, { state: string }>): string | null {
  const best = Object.entries(item.per_target)
    .filter(([t]) => current[t]?.state === "Uncertain")
    .sort((a, b) => b[1].p_definite - a[1].p_definite)[0];
  if (!best || best[1].p_definite < 0.2) return null;
  return `would settle ${best[0]} for ${pct(best[1].p_definite)} of plausible values`;
}

function Row({ item, max, current, okey, patient }: {
  item: NextBestItem; max: number; current: Record<string, { state: string }>; okey: string; patient: boolean;
}) {
  const ids = [okey, ...anatomy.vessels.map((v) => v.id)];
  const widest = ids.reduce((a, t) => (item.per_target[t].spread > item.per_target[a].spread ? t : a), ids[0]);
  const r = item.per_target[widest].range;
  const note = settles(item, current);
  const field = item.fills?.[0] ?? item.name;
  return (
    <li className="nbt-row">
      <button type="button" className="nbt-name linkbtn" onClick={() => focusField(field)} title="Go to this field in the patient record">
        {item.label}
      </button>
      <span className="nbt-bar" aria-hidden="true"><span style={{ width: `${Math.max(4, (item.score / max) * 100)}%` }} /></span>
      <span className="nbt-detail small muted">
        {patient
          ? `could change the estimate by up to ${pct(Math.abs(r[1] - r[0]))}`
          : `${widest} could land between ${pct(r[0])} and ${pct(r[1])}${note ? `; ${note}` : ""}`}
      </span>
    </li>
  );
}

export function NextBestTest() {
  const audience = useRisk((s) => s.audience);
  const base = useRisk((s) => s.base);
  const { data, loading, error } = useLive((inputs, signal) => nextBestTest(inputs, signal), hasMissing, 400);
  if (!base || !hasMissing(base)) return null;
  const patient = audience === "patient";
  const okey = overallKey(base);
  const n = base.imputed?.length ?? 0;

  return (
    <section className="nbt" aria-labelledby="nbt-title" aria-busy={loading}>
      <header className="nbt-head">
        <h2 id="nbt-title">{patient ? "Which missing result matters most" : "Next best test"}</h2>
        <span className="small muted">{n} {n === 1 ? "value is" : "values are"} missing and imputed</span>
      </header>
      {error && <p className="field-error small" role="alert">Could not rank missing values: {error}</p>}
      {!data && !error && <div className="skeleton-block nbt-skeleton" aria-label="Ranking missing measurements" />}
      {data && (data.tests.length > 0 || data.features.length > 0) && (
        <>
          <p className="nbt-lead">
            Entering <strong>{(data.tests[0] ?? data.features[0]).label.replace(/ \(\d+ values\)$/, "")}</strong> would change the
            model's estimate the most.
          </p>
          <div className="nbt-cols">
            {data.tests.length > 0 && (
              <div>
                <h3 className="nbt-sub">Whole tests</h3>
                <ol className="nbt-list">
                  {data.tests.slice(0, 3).map((t) => (
                    <Row key={t.name} item={t} max={data.tests[0].score || 1} current={data.current} okey={okey} patient={patient} />
                  ))}
                </ol>
              </div>
            )}
            <div>
              <h3 className="nbt-sub">Single measurements</h3>
              <ol className="nbt-list">
                {data.features.slice(0, 5).map((f) => (
                  <Row key={f.name} item={f} max={data.features[0].score || 1} current={data.current} okey={okey} patient={patient} />
                ))}
              </ol>
            </div>
          </div>
          <p className="tiny muted">{data.caption} Plausible values come from the most similar training patients.</p>
        </>
      )}
    </section>
  );
}
