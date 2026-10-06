// The patient record drawer: a patient card (initials, ID, completeness ring and per-group progress),
// three action tiles, search + quick filters, and one card per measurement group with a line icon and
// its own progress bar. Help text lives in tooltips; "imputed" is a small inline tag.
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import type { FeatureSpec, FeatureValue } from "../api/types";
import { downloadText, parsePatientCsv, templateCsv, type ParsedCsv, type ParsedRow } from "../csv";
import { normalRangeText, options, rangeStatus, specMap, validate } from "../features";
import { useRisk } from "../store/risk";
import { BatchDialog } from "./BatchDialog";
import { ReportDialog } from "./ReportDialog";
import { InfoTip } from "./charts";
import { Switch } from "./ui";

// ---------------------------------------------------------------- icons (24px line icons, currentColor)

const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const GROUP_ICON: Record<string, ReactNode> = {
  Demographics: I(<><circle cx="12" cy="8" r="3.5" /><path d="M5 20c1.2-3.6 3.8-5.5 7-5.5s5.8 1.9 7 5.5" /></>),
  History: I(<><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>),
  Symptoms: I(<path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.7-7 10-7 10Z" />),
  Vitals: I(<path d="M3 12h4l2-5 4 10 2-5h6" />),
  Labs: I(<><path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3" /><path d="M7.5 15h9" /></>),
  ECG: I(<path d="M2 13h4l1.5-3 2 7 2.5-12 2 8h2l1.5-2H22" />),
  Echo: I(<><path d="M12 12h.01" /><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.6 5.6a9 9 0 0 0 0 12.8M18.4 5.6a9 9 0 0 1 0 12.8" /></>),
};
const ICON_NEW = I(<><path d="M12 5v14M5 12h14" /></>);
const ICON_UP = I(<><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>);
const ICON_DOWN = I(<><path d="M12 4v12M7 11l5 5 5-5" /><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" /></>);
const ICON_SCAN = I(<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><path d="M8 9h8M8 12h8M8 15h5" /></>);
const ICON_FILE = I(<><path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7l-4-4Z" /><path d="M14 3v4h4" /></>);

type Filter = "all" | "missing" | "flagged" | "whatif";

// ---------------------------------------------------------------- one measurement

function Field({ f, value, onChange, from }: { f: FeatureSpec; value: FeatureValue; onChange: (v: FeatureValue) => void; from?: string }) {
  const [touched, setTouched] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const id = `f-${f.name}`;
  const error = validate(f, value);
  const showError = touched && error;
  const status = rangeStatus(f, value);
  const helper = normalRangeText(f);
  const missing = value === null || value === undefined;
  const describedBy = [helper && `${id}-help`, showError && `${id}-err`].filter(Boolean).join(" ") || undefined;

  let control;
  if (f.type === "binary") {
    control = <Switch id={id} label={f.label} checked={missing ? null : value === 1} onChange={(v) => onChange(v ? 1 : 0)} />;
  } else if (f.type === "numeric") {
    // Show entered/loaded values at sensible precision (dataset floats like BMI 32.4619...).
    const shown = draft ?? (missing ? "" : String(typeof value === "number" ? Number(value.toFixed(2)) : value));
    control = (
      <div className="input-unit">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          step={f.step ?? "any"}
          min={f.valid_range?.[0]}
          max={f.valid_range?.[1]}
          value={shown}
          placeholder="—"
          aria-invalid={!!showError}
          aria-describedby={describedBy}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setDraft(e.target.value);
            const raw = e.target.value.trim();
            onChange(raw === "" ? null : Number(raw));
          }}
          onBlur={() => {
            setTouched(true);
            setDraft(null);
          }}
        />
        {f.unit && <span className="unit" aria-hidden="true">{f.unit}</span>}
      </div>
    );
  } else {
    control = (
      <select
        id={id}
        value={missing ? "" : String(value)}
        aria-describedby={describedBy}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(null);
          onChange(f.type === "categorical" ? raw : Number(raw));
        }}
      >
        <option value="">Not recorded</option>
        {options(f).map(([v, label]) => (
          <option key={String(v)} value={String(v)}>{label}</option>
        ))}
      </select>
    );
  }

  return (
    <div className={`field field-${f.type} ${showError ? "has-error" : ""} ${missing ? "is-missing" : ""} ${status && status !== "within" ? `is-${status}` : ""}`}>
      <div className="field-text">
        <label htmlFor={id} className="field-label">{f.label}</label>
        <span className="field-meta">
          {f.modifiable && <span className="tag tag-modifiable" title="Has a what-if slider">⇄ what-if</span>}
          {missing && <span className="tag tag-imputed" title="Missing: the model fills in a typical value">auto</span>}
          {from && !missing && <span className="tag tag-report" title={`Confirmed from ${from}`}>report</span>}
          {status && status !== "within" && <span className={`range range-${status}`}>{status}</span>}
          {helper && <span id={`${id}-help`} className="field-help">{helper}</span>}
        </span>
      </div>
      <div className="field-control">{control}</div>
      {showError && <div id={`${id}-err`} className="field-error" role="alert">{error}</div>}
    </div>
  );
}

// ---------------------------------------------------------------- the drawer content

function initials(id: string): string {
  const clean = id.replace(/^(tour-demo-|demo-|new-)/, "").replace(/[^A-Za-z0-9 ]+/g, " ").trim();
  if (!clean || clean === "patient") return "?";
  const parts = clean.split(/\s+/);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : clean.slice(0, 3)).toUpperCase();
}

export function InputForm({ online }: { online: boolean | null }) {
  const spec = useRisk((s) => s.spec);
  const inputs = useRisk((s) => s.inputs);
  const setInput = useRisk((s) => s.setInput);
  const loadPatient = useRisk((s) => s.loadPatient);
  const patientId = useRisk((s) => s.patientId);
  const note = useRisk((s) => s.patientNote);
  const provenance = useRisk((s) => s.provenance);
  const reports = useRisk((s) => s.reportsOpen);
  const setReports = useRisk((s) => s.setReportsOpen);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  // The message belongs to the record it describes; it disappears once another patient is loaded.
  const [csvMsg, setCsvMsgFor] = useState<{ text: string; note: string } | null>(null);
  const setCsvMsg = (text: string | null) => setCsvMsgFor(text === null ? null : { text, note: useRisk.getState().patientNote });
  const [batch, setBatch] = useState<{ fileName: string; parsed: ParsedCsv } | null>(null);
  const setPatientId = useRisk((s) => s.setPatientId);
  const fileRef = useRef<HTMLInputElement>(null);
  const specs = useMemo(() => specMap(spec), [spec]);

  const errors = useMemo(
    () => Object.values(specs).map((f) => [f, validate(f, inputs[f.name] ?? null)] as const).filter(([, e]) => e),
    [specs, inputs],
  );
  const all = Object.values(specs);
  const isSet = (n: string) => inputs[n] !== null && inputs[n] !== undefined;
  const recorded = all.filter((f) => isSet(f.name)).length;
  const total = all.length;
  const flagged = all.filter((f) => {
    const s = rangeStatus(f, inputs[f.name] ?? null);
    return s === "above" || s === "below";
  });
  const loaded = Object.keys(inputs).length > 0;

  const blankRecord = () => Object.fromEntries(Object.keys(specs).map((k) => [k, null]));
  const newPatient = () => {
    loadPatient(blankRecord(), "new-patient", "New patient: enter the values you have. Missing ones are imputed and flagged.");
    setCsvMsg(null);
  };
  const openRow = (row: ParsedRow, fileName: string) =>
    loadPatient(row.record, row.patientId, `From ${fileName}, line ${row.line}.`);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !spec) return;
    try {
      const parsed = parsePatientCsv(await file.text(), spec);
      const only = parsed.rows[0];
      if (parsed.rows.length === 1 && only.issues.length === 0) {
        openRow(only, file.name);
        const filled = Object.values(only.record).filter((v) => v !== null).length;
        setCsvMsg(
          `${file.name} · ${filled} of ${total} values` +
            (parsed.unknownColumns.length ? ` · ignored: ${parsed.unknownColumns.join(", ")}` : ""),
        );
      } else {
        setCsvMsg(null);
        setBatch({ fileName: file.name, parsed });
      }
    } catch (err) {
      setCsvMsg((err as Error).message);
    }
  };

  const q = query.trim().toLowerCase();
  const groups = spec?.groups ?? [];
  const keep = (f: FeatureSpec) => {
    if (q && !(f.label.toLowerCase().includes(q) || f.name.includes(q))) return false;
    if (filter === "missing") return !isSet(f.name);
    if (filter === "flagged") return flagged.includes(f);
    if (filter === "whatif") return !!f.modifiable;
    return true;
  };
  const ring = 2 * Math.PI * 22;

  return (
    <section className="panel input-panel" aria-labelledby="input-title">
      {batch && spec && (
        <BatchDialog
          fileName={batch.fileName}
          parsed={batch.parsed}
          spec={spec}
          onOpen={(row) => openRow(row, batch.fileName)}
          onClose={() => setBatch(null)}
        />
      )}

      {reports && spec && <ReportDialog spec={spec} onClose={() => setReports(false)} />}

      {/* ------------------------------------------------ patient card */}
      <header className="pr-card">
        <div className="pr-top">
          <div className="pr-ring" aria-hidden="true">
            <svg viewBox="0 0 52 52" width="56" height="56">
              <circle cx="26" cy="26" r="22" className="pr-ring-track" />
              {recorded > 0 && (
                <circle cx="26" cy="26" r="22" className="pr-ring-fill" strokeDasharray={`${(total ? recorded / total : 0) * ring} ${ring}`} transform="rotate(-90 26 26)" />
              )}
            </svg>
            <span className="pr-avatar">{loaded ? initials(patientId) : "+"}</span>
          </div>
          <div className="pr-id">
            <h2 id="input-title">Patient record</h2>
            {online && spec && loaded ? (
              <label className="pr-idfield">
                <span className="sr-only">Patient ID</span>
                <input type="text" value={patientId} maxLength={64} onChange={(e) => setPatientId(e.target.value || "patient")} autoComplete="off" />
              </label>
            ) : (
              <span className="muted small">No patient loaded</span>
            )}
          </div>
          <div className="pr-count">
            <span className="pr-count-num">{recorded}<small>/{total || "–"}</small></span>
            <span className="pr-count-label">recorded</span>
          </div>
        </div>
        {loaded && (
          <div className="pr-groupbars" aria-label="Recorded per group">
            {groups.map((g) => {
              const fs = all.filter((f) => f.group === g);
              const n = fs.filter((f) => isSet(f.name)).length;
              return (
                <span key={g} className="pr-gb" title={`${g}: ${n}/${fs.length}`}>
                  <span className="pr-gb-bar"><span style={{ width: `${fs.length ? (n / fs.length) * 100 : 0}%` }} /></span>
                  <span className="pr-gb-icon">{GROUP_ICON[g]}</span>
                </span>
              );
            })}
          </div>
        )}
        {(note || (csvMsg && csvMsg.note === note)) && (
          <p className="pr-source" role="status">
            {ICON_FILE}
            <span>{csvMsg && csvMsg.note === note ? csvMsg.text : note}</span>
          </p>
        )}
      </header>

      {online === false && (
        <p className="notice" role="status">
          The API is offline. Start it with <code>python tasks.py serve</code> to enter or upload patients.
        </p>
      )}

      {online && spec && (
        <>
          {/* ------------------------------------------------ actions */}
          <div className="pr-actions" role="group" aria-label="Your patient">
            <button type="button" className="pr-action" onClick={newPatient}>
              {ICON_NEW}<span>New</span>
            </button>
            <button type="button" className="pr-action primary" onClick={() => fileRef.current?.click()}>
              {ICON_UP}<span>Upload CSV</span>
            </button>
            <button type="button" className="pr-action" onClick={() => setReports(true)}>
              {ICON_SCAN}<span>Read reports</span>
            </button>
            <button type="button" className="pr-action" onClick={() => downloadText("coronarytwin-template.csv", templateCsv(spec))}>
              {ICON_DOWN}<span>Template</span>
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv,.txt" hidden onChange={onFile} />
            <InfoTip label="About uploads">
              One row opens directly; several rows are scored together as a cohort. Our column names or the original dataset's (e.g. DM, Y/N) both
              work. Sample files are in the csv/ folder. Missing values are filled in with typical values and marked "auto".
            </InfoTip>
          </div>

          {loaded && (
            <>
              {/* ------------------------------------------------ search + filters */}
              <div className="pr-tools">
                <label className="search">
                  <span className="sr-only">Search measurements</span>
                  <input type="search" placeholder="Search 51 measurements" value={query} onChange={(e) => setQuery(e.target.value)} />
                </label>
                <div className="pr-filters" role="radiogroup" aria-label="Show">
                  {([
                    ["all", "All", total],
                    ["missing", "Missing", total - recorded],
                    ["flagged", "Out of range", flagged.length],
                    ["whatif", "What-if", all.filter((f) => f.modifiable).length],
                  ] as [Filter, string, number][]).map(([k, label, n]) => (
                    <button key={k} type="button" role="radio" aria-checked={filter === k} className={`pr-filter ${k === "flagged" && n > 0 ? "warn" : ""}`} onClick={() => setFilter(k)}>
                      {label} <span>{n}</span>
                    </button>
                  ))}
                </div>
              </div>

              {errors.length > 0 && (
                <div className="error-summary" role="alert" tabIndex={-1}>
                  <strong>Fix {errors.length === 1 ? "this value" : `these ${errors.length} values`} to update the estimate</strong>
                  <ul>
                    {errors.map(([f, e]) => (
                      <li key={f.name}><a href={`#f-${f.name}`}>{e}</a></li>
                    ))}
                  </ul>
                </div>
              )}

              {/* ------------------------------------------------ groups */}
              <div className="groups">
                {groups.map((g, gi) => {
                  const groupFields = all.filter((f) => f.group === g);
                  const fields = groupFields.filter(keep);
                  if (!fields.length) return null;
                  const filled = groupFields.filter((f) => isSet(f.name)).length;
                  const warn = groupFields.some((f) => flagged.includes(f));
                  return (
                    <details key={g} className="group" open={!!q || filter !== "all" || gi === 0}>
                      <summary>
                        <span className="group-icon">{GROUP_ICON[g]}</span>
                        <span className="group-name">{g}{warn && <span className="group-warn" title="Has values outside the normal range" />}</span>
                        <span className="group-progress" aria-hidden="true"><span style={{ width: `${(filled / groupFields.length) * 100}%` }} /></span>
                        <span className="tabular group-count">{filled}/{groupFields.length}</span>
                      </summary>
                      <div className="group-fields">
                        {fields.map((f) => (
                          <Field key={f.name} f={f} value={inputs[f.name] ?? null} onChange={(v) => setInput(f.name, v)} from={provenance[f.name]} />
                        ))}
                      </div>
                    </details>
                  );
                })}
                {groups.every((g) => !all.some((f) => f.group === g && keep(f))) && (
                  <p className="muted small pr-empty">Nothing matches. <button type="button" className="linkbtn small" onClick={() => { setQuery(""); setFilter("all"); }}>Show all</button></p>
                )}
              </div>
            </>
          )}

          {!loaded && (
            <div className="pr-start">
              <p className="pr-start-title">Start with a patient</p>
              <ol>
                <li><b>New</b> to type the values you have</li>
                <li><b>Upload CSV</b> for one patient or a cohort</li>
                <li><b>Read reports</b> to fill values from lab, ECG or echo reports (PDF or photo)</li>
                <li><b>Template</b> for the 51-column layout</li>
              </ol>
              <p className="muted small">Sample files are in the <code>csv/</code> folder. Or try the <b>Guided tour</b> in the header.</p>
            </div>
          )}
        </>
      )}
    </section>
  );
}
