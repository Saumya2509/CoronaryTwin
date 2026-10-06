import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { anatomy, VESSEL_IDS } from "../anatomy";
import type { PredictResponse } from "../api/types";
import { pulseAt, riskCss, vesselVisual } from "./colorScale";
import { buildHeartGeometry, heartRadius, projectToSurface, surfacePath } from "./heartShape";
import { groupShares } from "./Overlays";

const fixtures = import.meta.glob<PredictResponse>("@fixtures/responses/*.json", { eager: true, import: "default" });

describe("vessel-ID contract", () => {
  it("anatomy ids are unique and match every API response", () => {
    expect(new Set(VESSEL_IDS).size).toBe(VESSEL_IDS.length);
    const all = Object.values(fixtures);
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) expect(Object.keys(r.vessels)).toEqual(VESSEL_IDS);
  });
});

describe("risk color", () => {
  it("gets darker / redder as probability rises", () => {
    const lum = (css: string) => {
      const c = new THREE.Color(css);
      return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    };
    const ps = [0, 0.25, 0.5, 0.75, 1];
    const l = ps.map((p) => lum(riskCss(p)));
    for (let i = 1; i < l.length; i++) expect(l[i]).toBeLessThan(l[i - 1]);
  });
  it("clamps out-of-range input", () => {
    expect(riskCss(-1)).toBe(riskCss(0));
    expect(riskCss(2)).toBe(riskCss(1));
  });
});

describe("uncertainty encoding", () => {
  it("uncertain vessels are translucent, dashed and pulse slower", () => {
    const sure = vesselVisual(0.9, 0.1, "Likely");
    const unsure = vesselVisual(0.55, 0.9, "Uncertain");
    expect(sure.opacity).toBe(1);
    expect(sure.dashed).toBe(false);
    expect(unsure.opacity).toBeLessThan(1);
    expect(unsure.dashed).toBe(true);
    expect(unsure.pulseHz).toBeLessThan(sure.pulseHz);
    expect(unsure.wobble).toBeGreaterThan(sure.wobble);
  });
  it("pulse intensity stays in a sane range", () => {
    const v = vesselVisual(0.5, 1, "Uncertain");
    for (let t = 0; t < 5; t += 0.01) {
      const x = pulseAt(t, v);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
    }
  });
});

describe("heart surface projection", () => {
  it("projected points lie exactly at surface + offset", () => {
    for (const p of [[1, 0, 0], [0.3, -0.9, 0.2], [-0.5, 0.5, -0.7]] as [number, number, number][]) {
      const q = projectToSurface(new THREE.Vector3(...p), 0.03);
      expect(q.length()).toBeCloseTo(heartRadius(q.clone().normalize()) + 0.03, 10);
    }
  });
  it("every artery hugs the surface along its whole length (never floats)", () => {
    for (const v of anatomy.vessels) {
      const offset = anatomy.heart.surface_offset + v.radius * 0.55;
      for (const p of surfacePath(v.points, offset, 150)) {
        const gap = p.length() - heartRadius(p.clone().normalize());
        expect(gap).toBeGreaterThan(0);
        expect(gap).toBeLessThan(0.06);
      }
    }
  });
  it("heart geometry is closed and finite", () => {
    const g = buildHeartGeometry(32, 24);
    const pos = g.attributes.position.array as Float32Array;
    expect(pos.every(Number.isFinite)).toBe(true);
    g.computeBoundingBox();
    const size = g.boundingBox!.getSize(new THREE.Vector3());
    expect(size.y).toBeGreaterThan(size.x); // taller than wide, like a heart
  });
});

describe("explanation overlays", () => {
  it("group shares sum to 1 and keep the sign of the push", () => {
    const shares = groupShares({ groups: { ECG: 0.3, Labs: -0.1, Echo: 0.6 }, features: [], text: "" });
    expect(shares.reduce((a, s) => a + s.share, 0)).toBeCloseTo(1, 10);
    expect(shares.find((s) => s.group === "Labs")!.value).toBeLessThan(0);
  });
  it("handles a missing explanation", () => {
    expect(groupShares(undefined)).toEqual([]);
  });
});
