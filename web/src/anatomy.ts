import raw from "./anatomy.json";

export type Vec3 = [number, number, number];

export interface VesselSpec {
  id: string;
  label: string;
  patient_label: string;
  territory: string;
  points: Vec3[];
  radius: number;
  segments: string[];
  /** Floating label anchor: fraction along the artery and preferred side (illustrative). */
  callout?: { at: number; side: "left" | "right" };
}

export interface DecorationSpec {
  id: string;
  label: string;
  points: Vec3[];
  radius: number;
}

export interface Anatomy {
  heart: { tilt: Vec3; surface_offset: number };
  vessels: VesselSpec[];
  decorations: DecorationSpec[];
}

export const anatomy = raw as unknown as Anatomy;

// Vessel ids come from anatomy.json, never hard-coded (module 07: shared vessel-ID contract).
export const VESSEL_IDS: string[] = anatomy.vessels.map((v) => v.id);

export const vesselById = (id: string): VesselSpec | undefined => anatomy.vessels.find((v) => v.id === id);
