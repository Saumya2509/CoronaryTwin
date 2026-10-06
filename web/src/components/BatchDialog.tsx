// Results for an uploaded CSV with several patients: every row scored by POST /predict/batch,
// rows with problems listed with the reason, and any patient openable in the full report.
import { useEffect, useMemo, useRef, useState } from "react";
import { predictBatch } from "../api/client";
import type { BatchResponse, CohortSummary, FeaturesResponse, TargetResult } from "../api/types";
import { anatomy } from "../anatomy";
import { downloadText, toBatchCsv, type ParsedCsv, type ParsedRow } from "../csv";
import { pct } from "../features";
import { riskCss } from "../scene/colorScale";
import { useRisk } from "../store/risk";
import { State } from "./ui";

function Cell({ r }: { r: TargetResult | undefined }) {
  if (!r) return <td>–</td>;
  return (
    <td className="tabular">
      <span className="lp-dot" style={{ background: riskCss(r.prob), marginRight: 6 }} aria-hidden="true" />
      {pct(r.prob)} <State s={r.state} />
    </td>
  );
}

/** Speciality A4: the "population heart", average estimate and state counts per artery. */
function Cohort({ s, name, onShow }: { s: CohortSummary; name: string; onShow: () => void }) {
  const ids = Object.keys(s.targets);
  const setCohort = useRisk((st) => st.setCohort);
  return (
    <section className="cohort" aria-labelledby="cohort-title">
      <h3 id="cohort-title">Cohort overview · {s.n} patients</h3>
      <ul className="cohort-list">
        {ids.map((t) => {
          const r = s.targets[t];
          const label = anatomy.vessels.find((v) => v.id === t)?.label ?? "Overall CAD";
          return (
            <li key={t}>
              <span className="cohort-name"><span className="mono">{t}</span> <span className="muted small">{label}</span></span>
              <span className="cohort-bar" aria-hidden="true"><span style={{ width: `${r.mean_prob * 100}%`, background: riskCss(r.mean_prob) }} /></span>
              <span className="tabular">{pct(r.mean_prob)} avg</span>
              <span className="small cohort-counts">
                <State s="Likely" /> {r.likely} · <State s="Uncertain" /> {r.uncertain} · <State s="Unlikely" /> {r.unlikely}
              </span>
            </li>
          );
        })}
      </ul>
      {(s.coherence_flags > 0 || s.ood_flags > 0) && (
        <p className="small muted">
          {s.coherence_flags} with overall/vessel disagreement · {s.ood_flags} unlike the training data (interpret with caution).
        </p>
      )}
      <button type="button" className="btn small" onClick={() => { setCohort({ name, summary: s }); onShow(); }}>
        Show cohort averages on the 3D heart
      </button>
    </section>
  );
}

export function BatchDialog({ fileName, parsed, spec, onOpen, onClose }: {
  fileName: string;
  parsed: ParsedCsv;
  spec: FeaturesResponse;
  onOpen: (row: ParsedRow) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [res, setRes] = useState<BatchResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const valid = useMemo(() => parsed.rows.filter((r) => r.issues.length === 0), [parsed]);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  useEffect(() => {
    if (!valid.length) return;
    predictBatch(toBatchCsv(valid, spec)).then(setRes).catch((e: Error) => setErr(e.message));
  }, [valid, spec]);

  // Server rows come back in the order sent; map them to the parsed rows.
  const resultFor = (row: ParsedRow) => {
    if (!res) return undefined;
    const i = valid.indexOf(row);
    const serverErr = res.errors.find((e) => e.row === i);
    if (serverErr) return { error: Array.isArray(serverErr.error) ? serverErr.error.join(" ") : serverErr.error };
    const before = res.errors.filter((e) => e.row < i).length;
    return { row: res.rows[i - before] };
  };

  const exportResults = () => {
    if (!res) return;
    const head = ["patient_id", "CAD_prob", "CAD_state", ...anatomy.vessels.flatMap((v) => [`${v.id}_prob`, `${v.id}_state`]), "coherence_flag", "unlike_training_data", "imputed"];
    const lines = res.rows.map((r) => [
      r.patient_id, r.overall.prob, r.overall.state,
      ...anatomy.vessels.flatMap((v) => [r.vessels[v.id]?.prob ?? "", r.vessels[v.id]?.state ?? ""]),
      r.coherence.flag, r.ood ?? "", r.imputed.join(" "),
    ]);
    const note = `# ${res.disclaimer} Model ${res.model_version}.`;
    downloadText(fileName.replace(/\.csv$/i, "") + "-estimates.csv", [note, head.join(","), ...lines.map((l) => l.join(","))].join("\r\n") + "\r\n");
  };

  const close = () => {
    dialog.current?.close();
    onClose();
  };

  return (
    <dialog ref={dialog} className="modal batch-modal" aria-labelledby="batch-title" onClose={onClose}>
      <p className="kicker">Uploaded file · {fileName}</p>
      <h2 id="batch-title">{parsed.rows.length} patients</h2>
      <p className="small muted">
        {valid.length} ready to score{parsed.rows.length - valid.length ? `, ${parsed.rows.length - valid.length} with problems (listed below)` : ""}.
        {parsed.missingFeatures.length > 0 && ` ${parsed.missingFeatures.length} of ${spec.features.length} measurements have no column and will be imputed.`}
        {parsed.unknownColumns.length > 0 && ` Ignored columns: ${parsed.unknownColumns.join(", ")}.`}
      </p>
      {err && <p className="field-error" role="alert">Scoring failed: {err}</p>}
      {res?.summary && <Cohort s={res.summary} name={fileName} onShow={close} />}

      <div className="table-scroll batch-table-wrap">
        <table className="metrics-table batch-table">
          <thead>
            <tr>
              <th scope="col">Line</th><th scope="col">Patient</th><th scope="col">Overall CAD</th>
              {anatomy.vessels.map((v) => <th key={v.id} scope="col">{v.id}</th>)}
              <th scope="col"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {parsed.rows.map((row) => {
              const out = row.issues.length ? null : resultFor(row);
              return (
                <tr key={row.line}>
                  <td className="tabular muted">{row.line}</td>
                  <th scope="row" className="mono">
                    {row.patientId}
                    {out?.row?.ood && <span className="tag tag-ood" title="Unlike the training data: interpret with caution">unusual</span>}
                  </th>
                  {row.issues.length || out?.error ? (
                    <td colSpan={anatomy.vessels.length + 1} className="batch-issue">{row.issues.length ? row.issues.join("; ") : out?.error}</td>
                  ) : out?.row ? (
                    <>
                      <Cell r={out.row.overall} />
                      {anatomy.vessels.map((v) => <Cell key={v.id} r={out.row!.vessels[v.id]} />)}
                    </>
                  ) : (
                    <td colSpan={anatomy.vessels.length + 1} className="muted">{err ? "not scored" : "scoring…"}</td>
                  )}
                  <td>
                    <button type="button" className="linkbtn" disabled={row.issues.length > 0} onClick={() => { onOpen(row); close(); }}
                      aria-label={`Open ${row.patientId || `line ${row.line}`}`}>
                      Open
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="batch-actions">
        <button type="button" className="btn" onClick={exportResults} disabled={!res}>Download estimates (CSV)</button>
        <button type="button" className="btn primary" onClick={close}>Close</button>
      </div>
      <p className="small muted">Estimates only, not a diagnosis. Uploaded data is processed by your CoronaryTwin API and is not stored.</p>
    </dialog>
  );
}
