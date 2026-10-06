// Helpers over the feature registry served by GET /features (module 01).
// The form, SHAP rows, what-if sliders and patient wording are all derived from it,
// so a feature added to features.yaml appears in the UI with no frontend change.
import type { FeatureSpec, FeatureValue, FeaturesResponse, RangeStatus } from "./api/types";

export function specMap(spec: FeaturesResponse | null): Record<string, FeatureSpec> {
  return Object.fromEntries((spec?.features ?? []).map((f) => [f.name, f]));
}

export function rangeStatus(f: FeatureSpec | undefined, v: FeatureValue): RangeStatus {
  if (!f?.normal_range || typeof v !== "number" || Number.isNaN(v)) return null;
  const [lo, hi] = f.normal_range;
  if (lo !== null && v < lo) return "below";
  if (hi !== null && v > hi) return "above";
  return "within";
}

export function normalRangeText(f: FeatureSpec): string | null {
  if (!f.normal_range) return null;
  const [lo, hi] = f.normal_range;
  const u = f.unit ? ` ${f.unit}` : "";
  if (lo !== null && hi !== null) return lo === 0 ? `normal < ${hi}${u}` : `normal ${lo}–${hi}${u}`;
  if (lo !== null) return `normal ≥ ${lo}${u}`;
  if (hi !== null) return `normal ≤ ${hi}${u}`;
  return null;
}

/** Options for binary / ordinal / categorical inputs: [value sent to the API, label]. */
export function options(f: FeatureSpec): [string | number, string][] {
  if (f.type === "binary") return [[0, "No"], [1, "Yes"]];
  if (f.type === "categorical" && f.encoding) {
    const pretty: Record<string, string> = { none: "None", left: "Left BBB", right: "Right BBB" };
    return Object.values(f.encoding).map((v) => [v, pretty[String(v)] ?? String(v)]);
  }
  if (f.type === "ordinal") {
    if (f.encoding) {
      const pretty: Record<string, string> = { N: "None", mild: "Mild", Moderate: "Moderate", Severe: "Severe" };
      return Object.entries(f.encoding).map(([raw, v]) => [v, pretty[raw] ?? raw]);
    }
    const [lo, hi] = f.valid_range ?? [0, 4];
    return Array.from({ length: hi - lo + 1 }, (_, i) => [lo + i, String(lo + i)]);
  }
  return [];
}

export function formatValue(f: FeatureSpec | undefined, v: FeatureValue): string {
  if (v === null || v === undefined || v === "") return "not recorded";
  if (!f) return String(v);
  if (f.type === "binary") return v === 1 ? "present" : "absent";
  if (f.type === "categorical" || f.type === "ordinal") {
    const opt = options(f).find(([val]) => String(val) === String(v));
    if (opt && f.type === "categorical") return opt[1];
    if (opt && f.encoding) return opt[1];
  }
  const num = typeof v === "number" ? Number(v.toFixed(2)) : v;
  return f.unit ? `${num} ${f.unit}` : String(num);
}

/** Validation for one entered value; null = OK. Missing values are allowed (imputed by the model). */
export function validate(f: FeatureSpec, v: FeatureValue): string | null {
  if (v === null || v === "") return null;
  if (f.type === "numeric" || f.type === "ordinal") {
    if (typeof v !== "number" || Number.isNaN(v)) return `Enter a number for ${f.label.toLowerCase()}.`;
    if (f.valid_range) {
      const [lo, hi] = f.valid_range;
      if (v < lo || v > hi) return `${f.label} must be between ${lo} and ${hi}${f.unit ? " " + f.unit : ""}.`;
    }
  }
  return null;
}

export const pct = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`;

/**
 * Patient wording for a measurement and its value. An absent yes/no or zero-count finding is
 * negated ("No diabetes"), so it is never described as if it were present (same rule as the API).
 */
export function patientPhrase(f: FeatureSpec | undefined, v: FeatureValue, fallback = ""): string {
  if (!f) return fallback;
  let text = f.patient_text;
  if ((f.type === "binary" || f.type === "ordinal") && v === 0) {
    for (const article of ["A ", "An "]) if (text.startsWith(article)) text = text.slice(article.length);
    return "No " + text[0].toLowerCase() + text.slice(1);
  }
  return text;
}
