// 01 Why this estimate: chips for the top three drivers, the waterfall (how the score adds up)
// and a tornado chart of the strongest measurements. Explanatory text lives in ⓘ tooltips.
import { useMemo, useState } from "react";
import { anatomy } from "../anatomy";
import { formatValue, patientPhrase, specMap } from "../features";
import { overallKey, useRisk } from "../store/risk";
import { Title } from "./charts";
import { GuidelinePatient } from "./Guideline";
import { SimilarCases } from "./SimilarCases";
import { Waterfall } from "./Waterfall";
import { Segmented } from "./ui";

export function ShapPanel() {
  const result = useRisk((s) => s.result);
  const selected = useRisk((s) => s.selected);
  const select = useRisk((s) => s.select);
  const audience = useRisk((s) => s.audience);
  const spec = useRisk((s) => s.spec);
  const setHoverGroup = useRisk((s) => s.setHoverGroup);
  const [showAll, setShowAll] = useState(false);
  const specs = useMemo(() => specMap(spec), [spec]);

  if (!result) return <p className="muted">Load a patient to see what drives each estimate.</p>;
  const okey = overallKey(result);
  const target = selected ?? okey;
  const exp = result.explanations[target];
  if (!exp) return null;

  const patient = audience === "patient";
  const feats = exp.features.filter((f) => f.shap !== 0);
  const rows = showAll ? feats : feats.slice(0, 8);
  const fmax = Math.max(...feats.map((f) => Math.abs(f.shap)), 1e-9);
  const units = exp.units === "probability" ? "probability points" : "log-odds";
  const targetName = target === okey ? "overall estimate" : anatomy.vessels.find((v) => v.id === target)?.label ?? target;
  const prob = target === okey ? result.overall.prob : result.vessels[target]?.prob ?? 0;
  const name = (n: string, v: (typeof feats)[number]["value"]) => (patient ? patientPhrase(specs[n], v, n) : specs[n]?.label ?? n);

  return (
    <div className="shap">
      <div className="why-head">
        <Segmented
          label="Model to explain"
          value={target}
          options={[{ value: okey, label: patient ? "Overall" : okey }, ...anatomy.vessels.map((v) => ({ value: v.id, label: patient ? v.patient_label : v.id }))]}
          onChange={(v) => select(v === okey ? null : v)}
        />
        <ul className="driver-chips" aria-label="Top drivers">
          {feats.slice(0, 3).map((f) => (
            <li key={f.name} className={`driver-chip ${f.shap > 0 ? "up" : "down"}`}>
              <span className="dc-dir" aria-hidden="true">{f.shap > 0 ? "▲" : "▼"}</span>
              <span className="dc-name">{name(f.name, f.value)}</span>
              {!patient && <span className="dc-val">{formatValue(specs[f.name], f.value)}</span>}
              <span className="sr-only">{f.shap > 0 ? "raised" : "lowered"} the estimate</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="why-grid">
        <section aria-labelledby="groups-title" className="vt-card">
          <Title
            info={patient ? "Which kinds of measurements pushed the estimate up or down." : (
              <>Starts at the model's output for an average patient; each measurement group adds its summed SHAP value; it ends at this
                patient's model score ({units}, before calibration). The bars add up exactly. Hover a group to light it up on the heart.
                Model behavior, not cause.</>
            )}
          >
            <span id="groups-title">{patient ? "In short" : "How the score adds up"}</span>
          </Title>
          <Waterfall exp={exp} prob={prob} targetName={targetName} specs={specs} patient={patient} />
        </section>

        <section aria-labelledby="feats-title" className="vt-card">
          <Title info={<>SHAP contribution of each measurement to the {targetName}{patient ? "" : `, in ${units}`}. Right = raised it, left = lowered it.</>}>
            <span id="feats-title">{patient ? "What mattered most" : "Top drivers"}</span>
          </Title>
          <ol className="tornado" aria-label={`Measurements driving the ${targetName}`}>
            {rows.map((f) => {
              const w = (Math.abs(f.shap) / fmax) * 50;
              return (
                <li key={f.name} onMouseEnter={() => setHoverGroup(f.group)} onMouseLeave={() => setHoverGroup(null)}>
                  <span className="tn-label">
                    <span className="tn-name">{name(f.name, f.value)}</span>
                    {!patient && (
                      <span className="tn-value">
                        {formatValue(specs[f.name], f.value)}
                        {f.range_status && f.range_status !== "within" && <span className={`range range-${f.range_status}`}>{f.range_status}</span>}
                      </span>
                    )}
                  </span>
                  <span className="tn-bar" aria-hidden="true">
                    <span className="tn-axis" />
                    <span className={`tn-fill ${f.shap > 0 ? "up" : "down"}`} style={f.shap > 0 ? { left: "50%", width: `${w}%` } : { right: "50%", width: `${w}%` }} />
                  </span>
                  <span className={`tn-num ${f.shap > 0 ? "up" : "down"}`}>
                    {patient ? (f.shap > 0 ? "▲" : "▼") : `${f.shap > 0 ? "+" : "−"}${Math.abs(f.shap).toFixed(2)}`}
                    <span className="sr-only">{f.shap > 0 ? " raised" : " lowered"}</span>
                  </span>
                </li>
              );
            })}
          </ol>
          {feats.length > 8 && (
            <button type="button" className="linkbtn small" onClick={() => setShowAll((x) => !x)} aria-expanded={showAll}>
              {showAll ? "Top 8" : `All ${feats.length} measurements`}
            </button>
          )}
        </section>
      </div>
      {!patient && target === okey && <GuidelinePatient />}
      {!patient && <SimilarCases />}
    </div>
  );
}
