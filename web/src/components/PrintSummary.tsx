import { anatomy } from "../anatomy";
import { pct, specMap } from "../features";
import { overallKey, useRisk } from "../store/risk";
import { DISCLAIMER } from "./Disclaimer";

/** One-page export (module 06 §3.8): only visible when printing / saving as PDF. */
export function PrintSummary({ snapshot }: { snapshot: string | null }) {
  const result = useRisk((s) => s.result);
  const spec = useRisk((s) => s.spec);
  const patientId = useRisk((s) => s.patientId);
  const overrides = useRisk((s) => s.overrides);
  if (!result) return null;
  const specs = specMap(spec);
  const okey = overallKey(result);
  const rows = [
    { key: okey, name: `Overall ${okey}`, r: result.overall },
    ...anatomy.vessels.map((v) => ({ key: v.id, name: `${v.id} (${v.label})`, r: result.vessels[v.id] })),
  ];
  return (
    <div className="print-only print-summary">
      <p className="print-disclaimer">{DISCLAIMER}</p>
      <h1>CoronaryTwin summary</h1>
      <p>
        Patient: <strong>{patientId}</strong> · Model {result.model_version} · {new Date().toLocaleString()}
        {Object.keys(overrides).length > 0 && " · includes what-if changes (model sensitivity, not advice)"}
      </p>
      {snapshot && <img src={snapshot} alt="3D view of the heart with arteries colored by estimated probability (schematic)" />}
      <table>
        <thead><tr><th>Estimate</th><th>Probability</th><th>State</th><th>Top drivers</th></tr></thead>
        <tbody>
          {rows.map(({ key, name, r }) => (
            <tr key={key}>
              <td>{name}</td>
              <td>{pct(r.prob)}</td>
              <td>{r.state}</td>
              <td>
                {result.explanations[key]?.features.slice(0, 3)
                  .map((f) => `${specs[f.name]?.label ?? f.name} (${f.shap > 0 ? "raised" : "lowered"})`).join("; ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.guideline && (
        <p>Guideline scores for comparison (age, sex, symptoms{result.guideline.scores.some((g) => g.id === "cadc_rf") ? ", risk factors" : ""}):{" "}
          {result.guideline.scores.map((g) => `${g.short} ${pct(g.prob)}`).join(" · ")}. ESC 2019 band: {result.guideline.esc2019_band}.</p>
      )}
      {result.coherence.flag && <p>Note: {result.coherence.note}</p>}
      {result.ood?.flag && <p>Caution, input is unlike the training data: {result.ood.reasons.join(" ")}</p>}
      {result.imputed && result.imputed.length > 0 && (
        <p>Imputed (missing) values: {result.imputed.map((n) => specs[n]?.label ?? n).join(", ")}.</p>
      )}
      <p className="print-disclaimer">{DISCLAIMER} The 3D mapping is schematic. Explanations describe model behavior, not cause.</p>
    </div>
  );
}
