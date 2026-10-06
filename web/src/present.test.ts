// md/10.md: Present-mode captions come from the real numbers and never claim more than they show;
// the risk ramp always pairs a color with a word.
import { describe, expect, it } from "vitest";
import { anatomy } from "./anatomy";
import type { PredictResponse } from "./api/types";
import { caption } from "./components/PresentMode";
import { riskWord } from "./scene/colorScale";

const fixtures = import.meta.glob<PredictResponse>("@fixtures/responses/*.json", { eager: true, import: "default" });
const all = Object.values(fixtures);

describe("Present-mode captions", () => {
  it("quote the patient's own numbers", () => {
    for (const r of all) {
      const text = caption({ id: "overview", label: "Overview" }, r, false, {}, {}, null, null);
      expect(text).toContain(`${Math.round(r.overall.prob * 100)}%`);
      const nUnc = anatomy.vessels.filter((v) => r.vessels[v.id].state === "Uncertain").length;
      if (nUnc === 0) expect(text).toContain("definite");
      else expect(text).toContain(`${nUnc} of ${anatomy.vessels.length}`);
    }
  });

  it("call only the highest artery 'most concerned', and flag uncertainty only when uncertain", () => {
    for (const r of all) {
      const top = Math.max(...anatomy.vessels.map((v) => r.vessels[v.id].prob));
      for (const v of anatomy.vessels) {
        const text = caption({ id: v.id, label: v.patient_label }, r, false, {}, {}, null, null);
        expect(text.includes("most concerned")).toBe(r.vessels[v.id].prob === top);
        expect(text.includes("less sure")).toBe(r.vessels[v.id].state === "Uncertain");
      }
    }
  });

  it("what-if caption says nothing moved when no override applies", () => {
    const text = caption({ id: "whatif", label: "What-if" }, all[0], false, {}, {}, null, null);
    expect(text).toMatch(/nothing to move/);
  });
});

describe("risk words", () => {
  it("match the md/10.md buckets", () => {
    expect([0.1, 0.3, 0.5, 0.6, 0.8, 0.95].map(riskWord)).toEqual(["Very low", "Low", "Moderate", "Elevated", "High", "Very high"]);
  });
});
