// Every file in csv/ must load through the real upload parser with exactly the expected
// outcome: valid files clean, and the two deliberately broken files flagged per row.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import features from "@fixtures/features.json";
import type { FeaturesResponse } from "./api/types";
import { parsePatientCsv } from "./csv";

const spec = features as unknown as FeaturesResponse;
const dir = fileURLToPath(new URL("../../csv/", import.meta.url));
const files = readdirSync(dir).filter((f) => f.endsWith(".csv")).sort();

// file -> number of flagged rows (all others must parse with no issues)
const FLAGGED: Record<string, number> = { "35_out_of_range_values.csv": 1, "36_typos_and_text.csv": 1 };

describe("sample CSV folder", () => {
  it("has 50 files", () => {
    expect(files).toHaveLength(50);
  });

  it.each(files)("%s loads with the expected outcome", (file) => {
    const parsed = parsePatientCsv(readFileSync(dir + file, "utf8"), spec);
    expect(parsed.rows.length).toBeGreaterThan(0);
    const flagged = parsed.rows.filter((r) => r.issues.length > 0);
    expect(flagged.length).toBe(FLAGGED[file] ?? 0);
    if (!file.startsWith("31_") && !file.startsWith("32_") && file !== "40_missing_markers.csv") {
      expect(parsed.missingFeatures).toEqual([]);
    }
  });

  it("the original-format file decodes to the same patient as the canonical one", () => {
    const raw = parsePatientCsv(readFileSync(dir + "33_original_dataset_format.csv", "utf8"), spec).rows[0].record;
    const canon = parsePatientCsv(readFileSync(dir + "04_typical_angina_smoker.csv", "utf8"), spec).rows[0].record;
    expect(raw).toEqual(canon);
  });

  it("missing-value markers become missing, not errors", () => {
    const r = parsePatientCsv(readFileSync(dir + "40_missing_markers.csv", "utf8"), spec).rows[0];
    expect(r.issues).toEqual([]);
    expect([r.record.hdl, r.record.esr, r.record.wbc, r.record.plt]).toEqual([null, null, null, null]);
  });

  it("the 100-patient batch parses every row", () => {
    expect(parsePatientCsv(readFileSync(dir + "50_batch_100_patients.csv", "utf8"), spec).rows).toHaveLength(100);
  });
});
