// Feature 2: read clinical reports (lab PDF, ECG / echo printout, referral letter, photo or scan) into
// the patient record. The API proposes values with the line each came from; nothing is applied until the
// user confirms. Local reading (PDF text + on-device OCR) is the default; Claude vision is opt-in.
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { extractReports, getExtractCapabilities } from "../api/client";
import type { ExtractCapabilities, ExtractFinding, ExtractResponse, FeaturesResponse, PatientRecord } from "../api/types";
import { formatValue, specMap } from "../features";
import { useRisk } from "../store/risk";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.txt,application/pdf,image/*,text/plain";
const METHOD: Record<ExtractFinding["method"], string> = { text: "PDF/text", ocr: "OCR", claude: "Claude" };

export function ReportDialog({ spec, onClose }: { spec: FeaturesResponse; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const inputs = useRisk((s) => s.inputs);
  const applyReport = useRisk((s) => s.applyReport);
  const specs = useMemo(() => specMap(spec), [spec]);
  const [caps, setCaps] = useState<ExtractCapabilities | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [useClaude, setUseClaude] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [res, setRes] = useState<ExtractResponse | null>(null);
  const [keep, setKeep] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState(false);

  useEffect(() => {
    dialog.current?.showModal();
    getExtractCapabilities().then(setCaps).catch(() => setCaps(null));
  }, []);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const max = caps?.max_files ?? 8;
    const picked = Array.from(list);   // copy now: the input is reset right after, which empties its FileList
    setFiles((cur) => [...cur, ...picked].filter((f, i, a) => a.findIndex((g) => g.name === f.name) === i).slice(0, max));
    setRes(null);
  };

  const read = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await extractReports(files, useClaude);
      setRes(r);
      // Low-confidence readings (unit assumed, count assumed) start unticked.
      setKeep(Object.fromEntries(r.findings.map((f) => [f.name, f.confidence !== "low"])));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const chosen = res?.findings.filter((f) => keep[f.name]) ?? [];
  const apply = () => {
    const values: PatientRecord = Object.fromEntries(chosen.map((f) => [f.name, f.value]));
    const prov = Object.fromEntries(chosen.map((f) => [f.name, f.source]));
    const sources = [...new Set(chosen.map((f) => f.source))];
    applyReport(values, prov, `From reports: ${sources.join(", ")} · ${chosen.length} values confirmed.`);
    close();
  };

  const close = () => {
    dialog.current?.close();
    onClose();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    addFiles(e.dataTransfer.files);
  };

  return (
    <dialog ref={dialog} className="modal report-modal" aria-labelledby="report-title" onClose={onClose}>
      <p className="kicker">Multimodal input</p>
      <h2 id="report-title">Read reports</h2>
      <p className="small muted">
        Lab results, ECG and echo reports or a referral letter, as PDF, photo, scan or text. Values are read on this server
        {caps && !caps.ocr ? " (OCR is not installed, so only PDFs with text and text files can be read)" : " with on-device OCR"}, and
        you confirm each one before it enters the record. Files are not stored.
      </p>

      {!res && (
        <>
          <div className={`dropzone ${drag ? "is-drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)} onDrop={onDrop}>
            <p>Drop report files here, or</p>
            <button type="button" className="btn small" onClick={() => picker.current?.click()}>Choose files</button>
            <input ref={picker} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
            <p className="small muted">Samples: <code>samples/reports/</code> (one invented patient: lab PDF, ECG, echo, referral)</p>
          </div>
          {files.length > 0 && (
            <ul className="report-files">
              {files.map((f) => (
                <li key={f.name}>
                  <span className="mono">{f.name}</span> <span className="muted small">{Math.max(1, Math.round(f.size / 1024))} KB</span>
                  <button type="button" className="linkbtn small" onClick={() => setFiles((cur) => cur.filter((g) => g !== f))} aria-label={`Remove ${f.name}`}>Remove</button>
                </li>
              ))}
            </ul>
          )}
          {caps?.claude && (
            <label className="report-claude">
              <input type="checkbox" checked={useClaude} onChange={(e) => setUseClaude(e.target.checked)} />
              <span>Read with Claude ({caps.claude_model}) instead. <b>This sends the files to Anthropic.</b> Use only with consent and de-identified documents.</span>
            </label>
          )}
          {err && <p className="field-error" role="alert">{err}</p>}
          <div className="batch-actions">
            <button type="button" className="btn" onClick={close}>Cancel</button>
            <button type="button" className="btn primary" onClick={read} disabled={!files.length || busy} aria-busy={busy}>
              {busy ? "Reading…" : `Read ${files.length || ""} ${files.length === 1 ? "file" : "files"}`}
            </button>
          </div>
        </>
      )}

      {res && (
        <>
          <p className="small">
            {res.findings.length} values found in {res.files.length} {res.files.length === 1 ? "file" : "files"}
            {" "}({res.files.map((f) => `${f.name}: ${f.found ?? "?"}${f.method ? ` via ${METHOD[f.method as ExtractFinding["method"]] ?? f.method}` : ""}`).join(" · ")}).
            {" "}Check each against its source line.
          </p>
          {res.warnings.length > 0 && (
            <ul className="report-warnings" role="status">{res.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          )}
          <div className="table-scroll report-table-wrap">
            <table className="metrics-table report-table">
              <thead>
                <tr>
                  <th scope="col"><input type="checkbox" aria-label="Select all" checked={chosen.length === res.findings.length && chosen.length > 0}
                    onChange={(e) => setKeep(Object.fromEntries(res.findings.map((f) => [f.name, e.target.checked])))} /></th>
                  <th scope="col">Measurement</th><th scope="col">Value</th><th scope="col">Read from</th>
                </tr>
              </thead>
              <tbody>
                {res.findings.map((f) => {
                  const s = specs[f.name];
                  const cur = inputs[f.name];
                  const replaces = cur !== null && cur !== undefined && String(cur) !== String(f.value);
                  return (
                    <tr key={f.name} className={keep[f.name] ? "" : "is-off"}>
                      <td><input type="checkbox" checked={!!keep[f.name]} aria-label={`Use ${s?.label ?? f.name}`}
                        onChange={(e) => setKeep((k) => ({ ...k, [f.name]: e.target.checked }))} /></td>
                      <th scope="row">{s?.label ?? f.name}
                        {f.confidence === "low" && <span className="tag tag-low" title={f.note}>check</span>}
                      </th>
                      <td className="tabular">
                        {formatValue(s, f.value)}
                        {replaces && <span className="small muted report-replaces">replaces {formatValue(s, cur)}</span>}
                        {f.note && <span className="small muted report-note">{f.note}</span>}
                      </td>
                      <td className="report-evidence">
                        <q>{f.evidence}</q>
                        <span className="small muted">{f.source} · {METHOD[f.method]}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="batch-actions">
            <button type="button" className="btn" onClick={() => { setRes(null); setErr(null); }}>Back</button>
            <button type="button" className="btn primary" onClick={apply} disabled={!chosen.length}>
              Use {chosen.length} {chosen.length === 1 ? "value" : "values"}
            </button>
          </div>
          <p className="small muted">Values not found stay as they are (missing ones are imputed and marked "auto"). {res.disclaimer}</p>
        </>
      )}
    </dialog>
  );
}
