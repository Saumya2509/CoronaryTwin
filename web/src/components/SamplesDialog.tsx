// The CSV button: ten sample patient files (csv/demo.json) for judges to choose from. Open one in the
// report, or download the file itself to see the format or upload it through the patient record.
import { useEffect, useRef, useState } from "react";
import { downloadSample, getSamples, openSample } from "../demo";
import { useRisk, type DemoPatientSet } from "../store/risk";

const band = (label: string) =>
  /^low/i.test(label) ? "low" : /^moderate/i.test(label) ? "moderate" : /^high/i.test(label) ? "high" : "other";

export function SamplesDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const active = useRisk((s) => (s.demo ? s.demo.active : -1));
  const [sets, setSets] = useState<DemoPatientSet[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    getSamples().then((s) => (s ? setSets(s) : setFailed(true)));
  }, []);

  const close = () => {
    dialog.current?.close();
    onClose();
  };

  return (
    <dialog ref={dialog} className="modal samples-modal" aria-labelledby="samples-title" onClose={onClose}>
      <p className="kicker">Sample patients</p>
      <h2 id="samples-title">Choose a CSV</h2>
      <p className="small muted">
        Ten invented patients, from low to high risk. <b>Open</b> one to see it in the report, or <b>Download</b> the CSV to
        look at the file and upload it yourself with <i>Upload CSV</i> in the patient record.
      </p>
      {failed && <p className="field-error" role="alert">The sample files could not be loaded. Is the API running?</p>}
      {!sets && !failed && <div className="skeleton-block" aria-busy="true" aria-label="Loading samples" />}
      {sets && (
        <ol className="samples-list">
          {sets.map((s, i) => (
            <li key={s.file} className={i === active ? "is-active" : ""}>
              <span className="samples-num tabular" aria-hidden="true">{i + 1}</span>
              <span className="samples-text">
                <span className={`samples-band band-${band(s.label)}`}>{s.label}</span>
                <span className="samples-desc">{s.description}</span>
                <span className="samples-file mono">{s.file}</span>
              </span>
              <span className="samples-actions">
                <button type="button" className="btn small primary" onClick={() => { void openSample(i); close(); }}
                  aria-label={`Open sample ${i + 1}: ${s.label}`}>
                  {i === active ? "Open again" : "Open"}
                </button>
                <button type="button" className="btn small ghost" onClick={() => downloadSample(s)}
                  aria-label={`Download ${s.file}`}>
                  Download
                </button>
              </span>
            </li>
          ))}
        </ol>
      )}
      <div className="batch-actions">
        <button type="button" className="btn" onClick={close}>Close</button>
      </div>
    </dialog>
  );
}
