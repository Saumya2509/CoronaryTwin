// Risk -> visual encoding (module 05, sections 3.3-3.4).
//
//   Hue                 calibrated probability (yellow -> orange -> rose ramp, luminance falls monotonically)
//   Pulse speed / amp   uncertainty: more uncertain = slower, wobblier pulse
//   Opacity             conformal set = Uncertain -> semi-transparent
//   Dashed outline      Uncertain, so it survives static screenshots
import * as THREE from "three";
import type { RiskState } from "../api/types";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

// md/10.md section 4.3 ramp, bright enough to read on the dark stage. The top stop is #F02D55
// instead of #FF3B5C so luminance falls monotonically (color-blind safe ordering, tested).
const STOPS: [number, string][] = [
  [0, "#FDE9A9"], [0.25, "#F9C74F"], [0.47, "#F8961E"], [0.62, "#F3722C"], [0.77, "#EF476F"], [1, "#F02D55"],
];
const STOP_COLORS = STOPS.map(([, c]) => new THREE.Color().setStyle(c, THREE.SRGBColorSpace));

/** CSS color for a probability (interpolated in sRGB between the ramp stops). */
export const riskCss = (p: number): string => {
  const x = clamp01(p);
  let i = 1;
  while (i < STOPS.length - 1 && x > STOPS[i][0]) i++;
  const [a, b] = [STOPS[i - 1][0], STOPS[i][0]];
  const c = STOP_COLORS[i - 1].clone().lerp(STOP_COLORS[i], (x - a) / (b - a));
  return `#${c.getHexString(THREE.SRGBColorSpace)}`;
};

/** Word for the ramp bucket; always shown next to the color (md/10.md 4.3). */
export const riskWord = (p: number): string =>
  p < 0.2 ? "Very low" : p < 0.4 ? "Low" : p < 0.55 ? "Moderate" : p < 0.7 ? "Elevated" : p < 0.85 ? "High" : "Very high";

export const riskColor = (p: number): THREE.Color => new THREE.Color(riskCss(p));

/** Legend stops for a gradient bar. */
export const legendStops = (n = 11): { offset: number; color: string }[] =>
  Array.from({ length: n }, (_, i) => ({ offset: i / (n - 1), color: riskCss(i / (n - 1)) }));

export interface VesselVisual {
  color: string;
  opacity: number;
  dashed: boolean;
  /** Pulses per second. */
  pulseHz: number;
  /** Emissive amplitude of the pulse. */
  pulseAmp: number;
  /** 0 = metronomic, 1 = irregular. */
  wobble: number;
}

export function vesselVisual(prob: number, uncertainty: number, state: RiskState): VesselVisual {
  const u = clamp01(uncertainty);
  const uncertain = state === "Uncertain";
  return {
    color: riskCss(prob),
    opacity: uncertain ? 0.55 : 1,
    dashed: uncertain,
    pulseHz: 1.2 - 0.75 * u, // ~72 bpm when confident, ~27 bpm when very unsure
    pulseAmp: 0.18 + 0.22 * u,
    wobble: u,
  };
}

/** Emissive intensity at time t (seconds) for a vessel's pulse. */
export function pulseAt(t: number, v: VesselVisual, phase = 0): number {
  const speed = v.pulseHz * (1 + 0.35 * v.wobble * Math.sin(t * 0.7 + phase * 3.1));
  const beat = Math.pow(Math.max(0, Math.sin(2 * Math.PI * speed * t + phase)), 6);
  return 0.08 + v.pulseAmp * beat;
}
