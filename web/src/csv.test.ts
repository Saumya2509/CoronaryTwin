import { describe, expect, it } from "vitest";
import features from "@fixtures/features.json";
import type { FeaturesResponse } from "./api/types";
import { parsePatientCsv, parseTable, templateCsv, toBatchCsv } from "./csv";

const spec = features as unknown as FeaturesResponse;

describe("CSV table parsing", () => {
  it("handles quotes, escaped quotes, CRLF and a byte-order mark", () => {
    const t = parseTable('﻿a,b\r\n"x, y","say ""hi"""\r\n');
    expect(t.header).toEqual(["a", "b"]);
    expect(t.rows).toEqual([["x, y", 'say "hi"']]);
  });
  it("detects semicolon-separated files (European Excel)", () => {
    expect(parseTable("age;ldl\n60;120\n").delimiter).toBe(";");
  });
});

describe("patient CSV", () => {
  it("accepts canonical names and encoded values", () => {
    const { rows } = parsePatientCsv("patient_id,age,sex_male,ldl,bbb\nP1,61,1,140,left\n", spec);
    expect(rows[0].patientId).toBe("P1");
    expect(rows[0].record).toMatchObject({ age: 61, sex_male: 1, ldl: 140, bbb: "left" });
    expect(rows[0].issues).toEqual([]);
  });

  it("accepts the original dataset's column names and raw values", () => {
    const csv = "Age,Sex,DM,LVH,BBB,VHD,St Elevation,EF-TTE\n70,Fmale,1,Y,RBBB,mild,0,45\n";
    const { rows, unknownColumns } = parsePatientCsv(csv, spec);
    expect(unknownColumns).toEqual([]);
    expect(rows[0].record).toMatchObject({
      age: 70, sex_male: 0, diabetes: 1, lvh: 1, bbb: "right", vhd: 1, st_elevation: 0, ef_tte: 45,
    });
  });

  it("leaves missing measurements as null (imputed) and reports them", () => {
    const { rows, missingFeatures } = parsePatientCsv("age\n55\n", spec);
    expect(rows[0].record.ldl).toBeNull();
    expect(missingFeatures).toContain("ldl");
    expect(missingFeatures).not.toContain("age");
  });

  it("flags bad cells per row instead of dropping them silently", () => {
    const { rows } = parsePatientCsv("patient_id,age,ldl,lvh\nA,60,999,Y\nB,abc,100,maybe\nC,58,,N\n", spec);
    expect(rows[0].issues.join()).toMatch(/LDL/);
    expect(rows[1].issues).toHaveLength(2);
    expect(rows[2].issues).toEqual([]);
    expect(rows[2].record.ldl).toBeNull();
  });

  it("ignores unknown columns and numbers rows by file line", () => {
    const { rows, unknownColumns } = parsePatientCsv("age,shoe_size\n60,42\n61,43\n", spec);
    expect(unknownColumns).toEqual(["shoe_size"]);
    expect(rows.map((r) => r.line)).toEqual([2, 3]);
    expect(rows[1].patientId).toBe("row-2");
  });

  it("round-trips: the template parses cleanly and normalizes for the batch API", () => {
    const parsed = parsePatientCsv(templateCsv(spec), spec);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0].issues).toEqual([]);
    expect(parsed.missingFeatures).toEqual([]);
    const batch = toBatchCsv(parsed.rows, spec).split("\r\n")[0].split(",");
    expect(batch).toEqual(["patient_id", ...spec.features.map((f) => f.name)]);
  });

  it("rejects an empty file", () => {
    expect(() => parsePatientCsv("", spec)).toThrow();
    expect(() => parsePatientCsv("age,ldl\n", spec)).toThrow(/no patient rows/);
  });
});
