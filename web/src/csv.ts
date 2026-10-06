// Patient CSV import/export for real data (not just demo patients).
//
// Accepts either canonical feature names (st_elevation) or the original dataset column
// names (St Elevation), and either encoded values (1/0, left) or raw ones (Y/N, Male/Fmale,
// LBBB, mild/Moderate). Every row is normalized to the API's PatientRecord and checked with
// the same rules the API enforces, so problems are reported per cell, not silently dropped.
import type { FeatureSpec, FeaturesResponse, PatientRecord } from "./api/types";
import { specMap, validate } from "./features";

export interface ParsedRow {
  line: number;           // 1-based line in the file (header = 1)
  patientId: string;
  record: PatientRecord;  // every feature present; missing = null (imputed by the model)
  issues: string[];       // cell-level problems; a row with issues is not sent to the model
}

export interface ParsedCsv {
  rows: ParsedRow[];
  unknownColumns: string[];
  missingFeatures: string[]; // features with no column at all (all imputed)
  delimiter: string;
}

const ID_COLUMNS = ["patient_id", "patient", "id", "mrn"];
const TRUE = new Set(["1", "y", "yes", "true", "male", "m", "present"]);
const FALSE = new Set(["0", "n", "no", "false", "fmale", "female", "f", "absent"]);

/** RFC 4180-style parsing: quoted fields, escaped quotes, CRLF, BOM; auto-detects , ; or tab. */
export function parseTable(text: string): { header: string[]; rows: string[][]; delimiter: string } {
  const src = text.replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = [",", ";", "\t"].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best, ",");
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((x) => x.trim() !== "")) out.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== "")) out.push(row);
  const [header = [], ...rows] = out;
  return { header: header.map((h) => h.trim()), rows, delimiter };
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Convert one raw cell to the API value for a feature, or return an error message. */
function convert(f: FeatureSpec, raw: string): { value: number | string | null; error?: string } {
  const v = raw.trim();
  if (v === "" || /^(na|n\/a|null|nan|-|\?)$/i.test(v)) return { value: null };
  if (f.type === "binary") {
    if (f.encoding) {
      const hit = Object.entries(f.encoding).find(([k, enc]) => norm(k) === norm(v) || String(enc) === v);
      if (hit) return { value: Number(hit[1]) };
    }
    const l = v.toLowerCase();
    if (TRUE.has(l)) return { value: 1 };
    if (FALSE.has(l)) return { value: 0 };
    return { value: null, error: `${f.label}: "${v}" is not yes/no` };
  }
  if (f.type === "categorical" && f.encoding) {
    const hit = Object.entries(f.encoding).find(([k, enc]) => norm(k) === norm(v) || norm(String(enc)) === norm(v));
    return hit ? { value: String(hit[1]) } : { value: null, error: `${f.label}: "${v}" is not one of ${Object.keys(f.encoding).join(", ")}` };
  }
  if (f.type === "ordinal" && f.encoding) {
    const hit = Object.entries(f.encoding).find(([k, enc]) => norm(k) === norm(v) || String(enc) === v);
    if (hit) return { value: Number(hit[1]) };
  }
  const n = Number(v.replace(",", "."));
  if (Number.isNaN(n)) return { value: null, error: `${f.label}: "${v}" is not a number` };
  const err = validate(f, n);
  return err ? { value: null, error: err } : { value: n };
}

export function parsePatientCsv(text: string, spec: FeaturesResponse): ParsedCsv {
  const { header, rows, delimiter } = parseTable(text);
  if (header.length === 0) throw new Error("The file is empty.");
  const specs = specMap(spec);
  // Map each column to a feature by canonical name or original dataset name.
  const byKey = new Map<string, FeatureSpec>();
  for (const f of Object.values(specs)) {
    byKey.set(norm(f.name), f);
    byKey.set(norm(f.source), f);
  }
  const idCol = header.findIndex((h) => ID_COLUMNS.includes(h.toLowerCase()));
  const colFeature = header.map((h, i) => (i === idCol ? undefined : byKey.get(norm(h))));
  const unknownColumns = header.filter((h, i) => i !== idCol && !colFeature[i] && h !== "");
  const covered = new Set(colFeature.filter(Boolean).map((f) => f!.name));
  const missingFeatures = Object.keys(specs).filter((n) => !covered.has(n));

  const parsed = rows.map((cells, r) => {
    const record: PatientRecord = Object.fromEntries(Object.keys(specs).map((n) => [n, null]));
    const issues: string[] = [];
    colFeature.forEach((f, i) => {
      if (!f) return;
      const { value, error } = convert(f, cells[i] ?? "");
      if (error) issues.push(error);
      else record[f.name] = value;
    });
    const id = idCol >= 0 && cells[idCol]?.trim() ? cells[idCol].trim() : `row-${r + 1}`;
    return { line: r + 2, patientId: id, record, issues };
  });
  if (parsed.length === 0) throw new Error("The file has a header but no patient rows.");
  return { rows: parsed, unknownColumns, missingFeatures, delimiter };
}

const cell = (v: unknown) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Template: canonical header + one example row at typical (median) values. */
export function templateCsv(spec: FeaturesResponse): string {
  const feats = spec.features;
  const example = feats.map((f) => {
    if (f.type === "binary") return 0;
    if (f.type === "categorical") return f.encoding ? Object.values(f.encoding)[0] : "";
    const m = f.stats?.median;
    return m === undefined ? "" : Number(m.toFixed(f.step && f.step < 1 ? 1 : 0));
  });
  return [["patient_id", ...feats.map((f) => f.name)], ["example-1", ...example]].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

/** Normalized CSV (canonical names, API encodings) for POST /predict/batch. */
export function toBatchCsv(rows: ParsedRow[], spec: FeaturesResponse): string {
  const names = spec.features.map((f) => f.name);
  const lines = [["patient_id", ...names], ...rows.map((r) => [r.patientId, ...names.map((n) => r.record[n])])];
  return lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
