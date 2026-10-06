import { describe, expect, it } from "vitest";
import type { PredictResponse, TargetResult } from "./api/types";
import { blendResult } from "./store/risk";

const tr = (prob: number, state: TargetResult["state"]): TargetResult =>
  ({ prob, uncertainty: 0.2, set: state === "Likely" ? ["CAD"] : ["CAD", "No CAD"], state, range: [prob - 0.05, prob + 0.05] });
const res = (p: number, state: TargetResult["state"]): PredictResponse => ({
  patient_id: "p", overall: { ...tr(p, state), label: state }, vessels: { LAD: tr(p, state), LCX: tr(p, state), RCA: tr(p, state) },
  coherence: { flag: false, note: "" }, explanations: {}, model_version: "v", disclaimer: "d",
});

describe("visit comparison blend", () => {
  const a = res(0.8, "Likely"), b = res(0.4, "Uncertain");
  it("is exact at both ends", () => {
    expect(blendResult(a, b, 0)).toBe(a);
    expect(blendResult(a, b, 1)).toBe(b);
  });
  it("interpolates probabilities and takes the state of the nearer visit", () => {
    const m = blendResult(a, b, 0.25);
    expect(m.overall.prob).toBeCloseTo(0.7);
    expect(m.vessels.LAD.prob).toBeCloseTo(0.7);
    expect(m.overall.state).toBe("Likely");
    expect(blendResult(a, b, 0.75).vessels.RCA.state).toBe("Uncertain");
  });
});
