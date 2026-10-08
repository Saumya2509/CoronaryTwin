import type {
  BatchResponse, CounterfactualResponse, DemoPatient, ExperimentsResponse, ExtractCapabilities, ExtractResponse,
  FeaturesResponse, MetricsResponse,
  NextBestTestResponse, PatientRecord, PredictResponse, SimilarResponse, WhatIfResponse,
} from "./types";

// In development Vite proxies /api to FastAPI; in production set VITE_API_BASE.
const API_BASE: string = import.meta.env.VITE_API_BASE ?? "/api";

export type Source = "api" | "mock";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    // JSON bodies only; FormData must let the browser set the multipart boundary.
    headers: typeof init?.body === "string" ? { "Content-Type": "application/json", ...init.headers } : init?.headers,
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      detail = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch { /* keep status text */ }
    throw new ApiError(res.status, detail);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown, signal?: AbortSignal) =>
  call<T>(path, { method: "POST", body: JSON.stringify(body), signal });

/** API health; `false` means mock mode (API unreachable or running without models). */
export async function apiReady(): Promise<boolean> {
  try {
    const h = await call<{ status: string; mode: string }>("/health");
    return h.status === "ok" && h.mode === "models";
  } catch {
    return false;
  }
}

export const getFeatures = () => call<FeaturesResponse>("/features");
export const getMetrics = () => call<MetricsResponse>("/metrics");
export const getExperiments = () => call<ExperimentsResponse>("/experiments");
/** Mean |SHAP| per feature for each model, across the training patients. */
export const getGlobalExplanations = () =>
  call<{ version: string; targets: Record<string, { units: string; base_value: number; features: Record<string, number> }> }>("/explanations/global");
/** Real dataset patients: the guided tour and the landing-page preview (which never loads them into the report). */
export const getDemoPatients = () => call<Record<string, DemoPatient>>("/demo-patients");

export const predict = (features: PatientRecord, patientId: string, signal?: AbortSignal) =>
  post<PredictResponse>("/predict", { features, patient_id: patientId }, signal);

/** Like `predict`, plus the server's own processing time (X-Process-Time-ms; null if the header is not exposed). */
export async function predictTimed(features: PatientRecord, patientId: string, signal?: AbortSignal): Promise<{ result: PredictResponse; serverMs: number | null }> {
  const res = await fetch(`${API_BASE}/predict`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ features, patient_id: patientId }), signal,
  });
  if (!res.ok) throw new ApiError(res.status, `${res.status} ${res.statusText}`);
  const ms = Number(res.headers.get("X-Process-Time-ms"));
  return { result: (await res.json()) as PredictResponse, serverMs: Number.isFinite(ms) && ms > 0 ? ms : null };
}

export const whatIf = (features: PatientRecord, overrides: Record<string, number>, patientId: string, signal?: AbortSignal) =>
  post<WhatIfResponse>("/whatif", { features, overrides, patient_id: patientId }, signal);

export const counterfactual = (features: PatientRecord, target: string) =>
  post<CounterfactualResponse>("/counterfactual", { features, target });

export const nextBestTest = (features: PatientRecord, signal?: AbortSignal) =>
  post<NextBestTestResponse>("/next-best-test", { features }, signal);

export const similarCases = (features: PatientRecord, k = 5, signal?: AbortSignal) =>
  post<SimilarResponse>("/similar", { features, k }, signal);

/** Score many patients at once. `csv` must use canonical feature names (see csv.ts toBatchCsv). */
export async function predictBatch(csv: string): Promise<BatchResponse> {
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "patients.csv");
  return call<BatchResponse>("/predict/batch", { method: "POST", body: form });
}

export const getExtractCapabilities = () => call<ExtractCapabilities>("/extract/capabilities");

/** Read clinical reports (PDF, image, text) into proposed values. Files are processed in memory only. */
export function extractReports(files: File[], useClaude: boolean, signal?: AbortSignal): Promise<ExtractResponse> {
  const body = new FormData();
  for (const f of files) body.append("files", f, f.name);
  body.append("use_claude", String(useClaude));
  return call<ExtractResponse>("/extract", { method: "POST", body, signal });
}

/** GET /demo-set: the sample patients behind the CSV button (csv/demo.json). */
export const getDemoSet = () =>
  call<{ demo: { file: string; label: string; description: string; csv: string }[]; errors: string[]; disclaimer: string }>("/demo-set");
