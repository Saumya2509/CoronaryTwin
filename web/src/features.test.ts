import { describe, expect, it } from "vitest";
import type { FeatureSpec } from "./api/types";
import { formatValue, normalRangeText, options, rangeStatus, validate } from "./features";

const ldl: FeatureSpec = {
  name: "ldl", source: "LDL", label: "LDL cholesterol", unit: "mg/dL", type: "numeric", group: "Labs",
  valid_range: [5, 400], normal_range: [0, 100], modifiable: true, step: 5, patient_text: "Your LDL",
};
const hdl: FeatureSpec = { ...ldl, name: "hdl", label: "HDL cholesterol", normal_range: [40, null] };
const age: FeatureSpec = { ...ldl, name: "age", label: "Age", unit: "years", normal_range: null, valid_range: [18, 110] };
const bbb: FeatureSpec = {
  name: "bbb", source: "BBB", label: "Bundle branch block", type: "categorical", group: "ECG",
  encoding: { N: "none", LBBB: "left", RBBB: "right" }, patient_text: "x",
};
const vhd: FeatureSpec = {
  name: "vhd", source: "VHD", label: "Valvular heart disease", type: "ordinal", group: "Echo",
  encoding: { N: 0, mild: 1, Moderate: 2, Severe: 3 }, valid_range: [0, 3], patient_text: "x",
};
const dm: FeatureSpec = { name: "diabetes", source: "DM", label: "Diabetes mellitus", type: "binary", group: "History", patient_text: "x" };

describe("validation (mirrors the API's 422 rules)", () => {
  it("accepts missing values: they are imputed by the model", () => {
    expect(validate(ldl, null)).toBeNull();
  });
  it("rejects out-of-range numbers with a message naming the range", () => {
    expect(validate(ldl, 999)).toMatch(/between 5 and 400 mg\/dL/);
    expect(validate(age, 5)).toMatch(/Age/);
    expect(validate(ldl, 120)).toBeNull();
  });
  it("rejects non-numbers", () => {
    expect(validate(ldl, Number.NaN)).toMatch(/Enter a number/);
  });
});

describe("reference ranges", () => {
  it("labels below / within / above, including open-ended ranges", () => {
    expect(rangeStatus(ldl, 150)).toBe("above");
    expect(rangeStatus(ldl, 90)).toBe("within");
    expect(rangeStatus(hdl, 30)).toBe("below");
    expect(rangeStatus(hdl, 90)).toBe("within");
    expect(rangeStatus(age, 60)).toBeNull();
  });
  it("describes ranges in words", () => {
    expect(normalRangeText(ldl)).toBe("normal < 100 mg/dL");
    expect(normalRangeText(hdl)).toBe("normal ≥ 40 mg/dL");
    expect(normalRangeText(age)).toBeNull();
  });
});

describe("options and formatting", () => {
  it("builds select options from the registry encoding", () => {
    expect(options(bbb).map(([v]) => v)).toEqual(["none", "left", "right"]);
    expect(options(vhd)).toEqual([[0, "None"], [1, "Mild"], [2, "Moderate"], [3, "Severe"]]);
    expect(options(dm)).toEqual([[0, "No"], [1, "Yes"]]);
  });
  it("formats values for people, not models", () => {
    expect(formatValue(dm, 1)).toBe("present");
    expect(formatValue(bbb, "left")).toBe("Left BBB");
    expect(formatValue(vhd, 2)).toBe("Moderate");
    expect(formatValue(ldl, 32.4619113)).toBe("32.46 mg/dL");
    expect(formatValue(ldl, null)).toBe("not recorded");
  });
});
