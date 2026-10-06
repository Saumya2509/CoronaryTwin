// Mirrors app/schemas.py (module 04). Keep the two in sync.

export type ConformalLabel = "CAD" | "No CAD";
export type RiskState = "Likely" | "Unlikely" | "Uncertain";
export type RangeStatus = "below" | "within" | "above" | null;

export interface TargetResult {
  prob: number;
  uncertainty: number;
  set: ConformalLabel[];
  state: RiskState;
  threshold?: number | null;
  /** Lowest and highest probability among the calibrated sub-models; model disagreement, not a CI. */
  range?: [number, number] | null;
}

export interface OverallResult extends TargetResult {
  label: string;
}

export interface FeatureContribution {
  name: string;
  value: number | string | null;
  shap: number;
  group: string;
  range_status: RangeStatus;
}

export interface Explanation {
  groups: Record<string, number>;
  features: FeatureContribution[];
  text: string;
  text_patient?: string;
  base_value?: number | null;
  units?: "log-odds" | "probability";
}

export interface PredictResponse {
  patient_id: string;
  overall: OverallResult;
  vessels: Record<string, TargetResult>;
  coherence: { flag: boolean; note: string };
  explanations: Record<string, Explanation>;
  imputed?: string[];
  ood?: OODCheck | null;
  guideline?: Guideline | null;
  model_version: string;
  disclaimer: string;
}

/** Guideline pre-test probability scores for the same patient (src/baselines.py). */
export interface Guideline {
  symptom: "typical" | "atypical" | "nonanginal" | "dyspnoea";
  scores: { id: string; label: string; short: string; prob: number }[];
  esc2019_band: string;
  note: string;
}

// ---------------------------------------------------------------- registry (GET /features)

export type FeatureType = "numeric" | "binary" | "ordinal" | "categorical";

export interface FeatureStats {
  min: number; max: number; median: number; std: number; p01: number; p99: number;
}

export interface FeatureSpec {
  name: string;
  source: string;
  label: string;
  unit?: string;
  type: FeatureType;
  group: string;
  encoding?: Record<string, string | number>;
  valid_range?: [number, number];
  normal_range?: [number | null, number | null] | null;
  modifiable?: boolean;
  step?: number;
  patient_text: string;
  stats?: FeatureStats | null;
}

export interface FeaturesResponse {
  groups: string[];
  modifiable: string[];
  features: FeatureSpec[];
}

export type FeatureValue = number | string | null;
export type PatientRecord = Record<string, FeatureValue>;

export interface DemoPatient {
  patient_id: string;
  description: string;
  features: PatientRecord | null;
}

// ---------------------------------------------------------------- what-if / counterfactual

export interface WhatIfResponse {
  base: PredictResponse;
  whatif: PredictResponse;
  deltas: Record<string, number>;
  caption: string;
}

export interface CounterfactualResponse {
  target: string;
  threshold: number;
  current_prob: number;
  already_below: boolean;
  options: { changes: { feature: string; from: number | null; to: number }[]; new_prob: number; effort_sd: number }[];
  note: string;
  caption: string;
  disclaimer: string;
}

// ---------------------------------------------------------------- GET /metrics (subset used by the trust tab)

export interface MetricCI { mean: number; ci95: [number, number]; sd: number }

export interface TargetMetrics {
  target: string;
  n: number;
  positive_rate: number;
  family: string;
  family_label: string;
  comparison: Record<string, { roc_auc: number; ci95: [number, number]; brier: number }>;
  "metrics_at_0.5": Record<string, MetricCI>;
  threshold: number;
  metrics_at_threshold: Record<string, MetricCI>;
  calibration: {
    method: string;
    uncalibrated: { mean_predicted: number[]; fraction_positive: number[]; brier: number };
    calibrated: { mean_predicted: number[]; fraction_positive: number[]; brier: number };
  };
  conformal: { alpha: number; qhat: number; coverage: number; uncertain_rate: number };
  subgroups: { subgroup: string; level: string; n: number; positives: number; roc_auc: number | null; recall: number | null; small: boolean }[];
  curves: { roc: { fpr: number[]; tpr: number[] }; confusion_at_threshold: Record<"tn" | "fp" | "fn" | "tp", number> };
}

export interface MetricsResponse {
  version: string;
  created: string;
  mode: string;
  settings: { outer_splits: number; outer_repeats: number; min_recall: number };
  targets: Record<string, TargetMetrics>;
  coherence: { evaluated: boolean; flag_rate?: number; n_flagged?: number };
}

// ---------------------------------------------------------------- POST /predict/batch

export interface BatchRow {
  patient_id: string;
  overall: OverallResult;
  vessels: Record<string, TargetResult>;
  coherence: { flag: boolean; note: string };
  imputed: string[];
  ood?: boolean | null;
}

export interface BatchResponse {
  rows: BatchRow[];
  errors: { row: number; error: string[] | string }[];
  summary?: CohortSummary | null;
  model_version: string;
  disclaimer: string;
}

// ---------------------------------------------------------------- specialities (md/09.md)

/** Out-of-distribution check attached to every /predict response (A3). */
export interface OODCheck {
  flag: boolean;
  out_of_range: string[];
  unusual_combination: boolean;
  typicality: number;
  reasons: string[];
}

export interface NextBestItem {
  name: string;
  label: string;
  group?: string | null;
  fills?: string[];
  score: number;
  per_target: Record<string, { spread: number; range: [number, number]; p_definite: number }>;
}

/** POST /next-best-test (S3). */
export interface NextBestTestResponse {
  target: string | null;
  n_missing: number;
  current: Record<string, { prob: number; state: RiskState }>;
  tests: NextBestItem[];
  features: NextBestItem[];
  caption: string;
  disclaimer: string;
}

/** POST /similar (A2). */
export interface SimilarResponse {
  k: number;
  matched_on: number;
  cases: { rank: number; distance: number; summary: string; outcomes: Record<string, number> }[];
  outcome_rates: Record<string, number>;
  caption: string;
  disclaimer: string;
}

export interface CohortSummary {
  n: number;
  targets: Record<string, { mean_prob: number; likely: number; uncertain: number; unlikely: number }>;
  coherence_flags: number;
  ood_flags: number;
}

interface PairedDelta { auc: number; delta: number; ci95: [number, number] }

/** GET /experiments (S4, src/experiments.py). */
export interface ExperimentsResponse {
  version: string;
  created: string;
  mode: string;
  targets: Record<string, {
    selected: string;
    comparison: Record<string, { label: string; auc: number; delta_vs_selected: number; ci95: [number, number]; p_better: number; selected: boolean }>;
    decision: { thresholds: number[]; model: number[]; treat_all: number[]; prevalence: number };
    refit: {
      base_auc: number;
      folds: number;
      ablation: Record<string, PairedDelta & { n_features: number }>;
      engineered: PairedDelta;
      learning: { fraction: number; n_train: number; auc: number; sd: number }[];
      calibration: Record<"none" | "sigmoid" | "isotonic", { brier: number; sd: number }>;
    };
  }>;
  robustness: Record<string, Record<string, { mean_abs_change: number; p95_abs_change: number; state_change_rate: number; likely_unlikely_flip_rate: number }>>;
  ood: { false_alarm_rate_training: number; synthetic_extreme_detection: number; shuffled_combination_detection: number; n_synthetic: number };
  nextbest: { n: number; blanked: string[]; mean_gap: Record<"none" | "top" | "random", number>; top_closes_more_than_random: number; top_is_best_test: number };
  lime?: { n_patients: number; targets: Record<string, { top1_agreement: number; top3_overlap: number; top5_overlap: number }> };
  chain?: Record<string, { base_auc: number; auc: number; delta: number; ci95: [number, number] }>;
  baselines?: BaselineResults;
}

interface BaselineVs {
  auc: number; auc_ci95: [number, number]; delta_auc: number; delta_ci95: [number, number]; p_model_better: number;
  brier: number; mean_pred: number;
  nri?: { categorical: number; events: number; nonevents: number; continuous: number; categorical_ci95: [number, number]; continuous_ci95: [number, number] };
}

/** experiments.json "baselines": CoronaryTwin vs guideline scores (src/baselines.py). */
export interface BaselineResults {
  scores: Record<string, { label: string; short: string; inputs: string }>;
  nri_bands: number[];
  observed_prevalence: number;
  symptom_counts: Record<string, number>;
  targets: Record<string, { model: { auc: number; auc_ci95: [number, number]; brier: number; mean_pred: number }; baselines: Record<string, BaselineVs> }>;
  bands: Record<string, { cad: number[]; no_cad: number[] }>;
  decision: Record<string, number[]>;
}

// ---------------------------------------------------------------- report upload (feature 2)

/** One value read from an uploaded report: proposed, never applied without confirmation. */
export interface ExtractFinding {
  name: string;
  value: number | string;
  evidence: string;
  source: string;
  method: "text" | "ocr" | "claude";
  confidence: "high" | "medium" | "low";
  note: string;
}

/** POST /extract */
export interface ExtractResponse {
  findings: ExtractFinding[];
  warnings: string[];
  files: { name: string; method: string | null; lines: number | null; found: number | null }[];
  claude_used: boolean;
  stored: false;
  disclaimer: string;
}

/** GET /extract/capabilities */
export interface ExtractCapabilities {
  ocr: boolean;
  pdf: boolean;
  claude: boolean;
  claude_model: string;
  max_files: number;
  max_file_mb: number;
}
