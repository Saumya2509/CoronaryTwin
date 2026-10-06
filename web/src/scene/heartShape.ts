// Analytic heart surface (schematic but anatomical in shape). One radial function r(direction)
// defines the heart: ventricles, apex, atria and appendages, and the grooves the coronary
// arteries run in. Artery curves are projected exactly onto it, so they hug the surface from
// every viewing angle instead of floating off a mesh they were hand-placed against.
//
// Frame: apex toward -y, base toward +y, anterior toward +z, patient's left toward +x.
import * as THREE from "three";

const AXES = { x: 0.62, y: 0.84, z: 0.56 };
const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};
const gauss = (x: number, mu: number, sigma: number) => Math.exp(-(((x - mu) / sigma) ** 2));

// Apex points down and slightly toward the patient's left and anterior, as in a real heart.
const APEX = new THREE.Vector3(0.2, -0.95, 0.22).normalize();

/** Angular bump: 1 at `c`, falling off with the angle from it (radians, sigma). */
function bump(d: THREE.Vector3, c: THREE.Vector3, sigma: number): number {
  const cos = Math.min(1, Math.max(-1, d.dot(c)));
  return Math.exp(-((Math.acos(cos) / sigma) ** 2));
}

const LA = new THREE.Vector3(0.25, 0.55, -0.78).normalize();   // left atrium (posterior, superior)
const RA = new THREE.Vector3(-0.88, 0.42, -0.12).normalize();  // right atrium (patient's right)
const RAA = new THREE.Vector3(-0.55, 0.64, 0.54).normalize();  // right atrial appendage, wraps the aortic root
const LAA = new THREE.Vector3(0.66, 0.6, 0.44).normalize();    // left atrial appendage, over the proximal LCX

/**
 * Grooves where the coronary arteries run, in direction space. Fitted to the artery paths in
 * anatomy.json so the arteries lie in their grooves, like on a real heart.
 *   av   atrioventricular (coronary) sulcus: RCA and LCX, a ring tilted down toward the back
 *   aiv  anterior interventricular groove: LAD
 *   piv  posterior interventricular groove: posterior descending branch
 */
export function grooves(d: THREE.Vector3): { av: number; aiv: number; piv: number } {
  const av = gauss(d.y - 0.35 * d.z, 0.43, 0.1);
  const below = smooth(0.5, 0.2, d.y - 0.35 * d.z);
  const aiv = gauss(d.x, 0.04 + 0.15 * d.y, 0.07) * smooth(0.05, 0.35, d.z) * below;
  const piv = gauss(d.x, 0.02, 0.07) * smooth(-0.05, -0.35, d.z) * below;
  return { av, aiv, piv };
}

/** Atrial weight (0..1): the upper chambers and their appendages. */
export function atrialWeight(d: THREE.Vector3): number {
  return Math.max(bump(d, LA, 0.55), bump(d, RA, 0.5), bump(d, RAA, 0.3), bump(d, LAA, 0.26));
}

/** Radius of the heart surface along a unit direction. */
export function heartRadius(d: THREE.Vector3): number {
  // Ellipsoid base shape.
  let r = 1 / Math.sqrt((d.x / AXES.x) ** 2 + (d.y / AXES.y) ** 2 + (d.z / AXES.z) ** 2);
  // Taper toward a rounded-pointed apex.
  const down = Math.max(0, d.dot(APEX));
  r *= 1 - 0.24 * Math.sin(Math.PI * down) * smooth(0.0, 0.35, down);
  r *= 1 + 0.05 * smooth(0.92, 1, down); // rounded tip, not a needle
  // Left ventricle is fuller than the right (patient's left = +x).
  r *= 1 + 0.07 * Math.max(0, d.x) * (1 - down);
  // Right ventricle bulges anteriorly on the patient's right.
  r *= 1 + 0.05 * Math.max(0, d.z) * Math.max(0, -d.x);
  // Flattened base where the great vessels leave the heart.
  r *= 1 - 0.1 * smooth(0.78, 1, d.y);
  // Atria and their appendages bulge above the coronary sulcus.
  r *= 1 + 0.07 * bump(d, LA, 0.45) + 0.08 * bump(d, RA, 0.42) + 0.075 * bump(d, RAA, 0.2) + 0.065 * bump(d, LAA, 0.17);
  // Grooves the arteries run in.
  const g = grooves(d);
  r *= 1 - 0.05 * g.av - 0.035 * g.aiv - 0.03 * g.piv;
  return r;
}

/** Project any point (taken as a direction from the center) onto the surface plus an offset. */
export function projectToSurface(p: THREE.Vector3, offset = 0): THREE.Vector3 {
  const d = p.clone().normalize();
  return d.multiplyScalar(heartRadius(d) + offset);
}

/** Heart mesh geometry: a dense sphere whose vertices are moved onto the surface. */
export function buildHeartGeometry(widthSegments = 192, heightSegments = 144): THREE.BufferGeometry {
  const geo = new THREE.SphereGeometry(1, widthSegments, heightSegments);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(heartRadius(v));
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** A patch of the surface (for the schematic echo wall glow), lifted slightly off it. */
export function buildSurfacePatch(
  center: THREE.Vector3,
  angularRadius: number,
  offset = 0.01,
  segments = 40,
): THREE.BufferGeometry {
  // Build a cap around +z, then rotate it so +z points at `center`.
  const geo = new THREE.SphereGeometry(1, segments, segments / 2, 0, Math.PI * 2, 0, angularRadius);
  geo.rotateX(Math.PI / 2); // cap now around +z
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), center.clone().normalize());
  geo.applyQuaternion(q);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    v.multiplyScalar(heartRadius(v) + offset);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/**
 * Sample a direction path, project every sample onto the surface, and return the
 * surface-hugging points. `samples` controls smoothness.
 */
export function surfacePath(directions: [number, number, number][], offset: number, samples = 120): THREE.Vector3[] {
  const guide = new THREE.CatmullRomCurve3(directions.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  return guide.getSpacedPoints(samples).map((p) => projectToSurface(p, offset));
}
