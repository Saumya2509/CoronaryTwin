// Speciality A2: the most similar training patients, as coarse de-identified summaries with their
// catheterization outcomes. Case-based reasoning next to the model's estimate, not a diagnosis.
import { similarCases } from "../api/client";
import { anatomy } from "../anatomy";
import { overallKey, useRisk } from "../store/risk";
import { useLive } from "../useLive";
import { OutcomeDots, Title } from "./charts";

export function SimilarCases() {
  const base = useRisk((s) => s.base);
  const { data, error } = useLive((inputs, signal) => similarCases(inputs, 5, signal));
  if (!base) return null;
  const okey = overallKey(base);
  const ids = [okey, ...anatomy.vessels.map((v) => v.id)];
  const maxD = data ? Math.max(...data.cases.map((c) => c.distance), 0.01) : 1;

  return (
    <section className="similar" aria-labelledby="similar-title">
      <Title info={<>The 5 training patients closest to this one on the recorded values, weighted by how much each measurement matters to the
        models. Coarse, de-identified summaries; outcomes are the dataset's catheterization labels (stenosis ≥ 50%). Not a diagnosis.</>}>
        <span id="similar-title">Similar historical cases</span>
      </Title>
      {error && <p className="field-error small" role="alert">Could not load similar cases: {error}</p>}
      {!data && !error && <div className="skeleton-block" aria-label="Loading similar cases" />}
      {data && (
        <>
          <ul className="sim-rates" aria-label="Outcomes among the similar patients">
            {ids.map((t) => {
              const n = Math.round(data.outcome_rates[t] * data.k);
              return (
                <li key={t}>
                  <span className="sim-rate-num">{n}<small>/{data.k}</small></span>
                  <span className="sim-rate-bar" aria-hidden="true">
                    {Array.from({ length: data.k }, (_, i) => <span key={i} className={i < n ? "on" : ""} />)}
                  </span>
                  <span className="sim-rate-label">{t === okey ? "had CAD" : `${t} narrowed`}</span>
                </li>
              );
            })}
          </ul>
          <ol className="sim-cards">
            {data.cases.map((c) => {
              const [who, rest = ""] = c.summary.split("; ");
              return (
                <li key={c.rank} className="sim-card">
                  <span className="sim-who">{who.replace("-year-old", " y")}</span>
                  <span className="sim-tags">{rest.split(", ").slice(0, 3).map((t) => <span key={t}>{t}</span>)}</span>
                  <OutcomeDots outcomes={c.outcomes} order={ids} />
                  <span className="sim-close" title={`Weighted distance ${c.distance.toFixed(2)}`}>
                    <span style={{ width: `${Math.max(8, 100 - (c.distance / maxD) * 70)}%` }} />
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
