// Procedural tissue for the heart: myocardium vs epicardial fat colors per vertex, and a
// seamless bump texture (fine muscle grain plus lobulated fat). No image files: everything
// is generated from noise at load, so there are still no third-party assets.
import * as THREE from "three";
import { atrialWeight, grooves } from "./heartShape";

// ---------------------------------------------------------------- noise

function hash(x: number, y: number, z: number): number {
  const h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453123;
  return h - Math.floor(h);
}

function valueNoise(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** Fractal noise in [0, 1]. */
export function fbm(x: number, y: number, z: number, octaves = 4): number {
  let a = 0.5, f = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * valueNoise(x * f, y * f, z * f);
    norm += a;
    a *= 0.5;
    f *= 2.03;
  }
  return sum / norm;
}

/** Epicardial fat amount (0..1) on a direction: fills the grooves and the base, in irregular patches. */
export function fatAmount(d: THREE.Vector3): number {
  const g = grooves(d);
  // Wider than the groove itself: fat fills the sulcus and spills over its edges.
  const sulcus = Math.max(g.av, 0.85 * g.aiv, 0.8 * g.piv);
  const spill = Math.pow(sulcus, 0.85);
  const patches = fbm(d.x * 4.5 + 7, d.y * 4.5, d.z * 4.5, 4);
  const blobs = fbm(d.x * 9 + 2, d.y * 9 + 1, d.z * 9, 3);
  const base = THREE.MathUtils.smoothstep(d.y, 0.62, 0.92) * 0.5;
  const f = spill * (0.35 + 0.9 * patches) * (0.75 + 0.5 * blobs) + base * patches;
  return THREE.MathUtils.clamp((f - 0.42) * 2.4, 0, 1);
}

// ---------------------------------------------------------------- colors

const MYO_DARK = new THREE.Color("#5e1f1d");
const MYO = new THREE.Color("#8a3430");
const MYO_LIGHT = new THREE.Color("#a24a40");
const ATRIUM = new THREE.Color("#6d2a33");
const FAT = new THREE.Color("#d9b26f");
const FAT_PALE = new THREE.Color("#e8cf9a");

/** Per-vertex colors for the heart mesh (vertices lie on the surface; their direction is used). */
export function applyHeartColors(geo: THREE.BufferGeometry): void {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const d = new THREE.Vector3();
  const c = new THREE.Color();
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    // Myocardium: mottled red-brown, darker on the atria.
    const n = fbm(d.x * 5 + 3, d.y * 5, d.z * 5, 4);
    c.copy(MYO_DARK).lerp(MYO, THREE.MathUtils.smoothstep(n, 0.25, 0.6)).lerp(MYO_LIGHT, THREE.MathUtils.smoothstep(n, 0.6, 0.85) * 0.6);
    c.lerp(ATRIUM, atrialWeight(d) * 0.55);
    // Epicardial fat in the grooves and at the base.
    const f = fatAmount(d);
    if (f > 0) {
      tmp.copy(FAT).lerp(FAT_PALE, fbm(d.x * 9, d.y * 9 + 5, d.z * 9, 2));
      c.lerp(tmp, f);
    }
    // Soft cavity shading deep in the grooves.
    const g = grooves(d);
    c.multiplyScalar(1 - 0.12 * Math.max(g.av, g.aiv, g.piv) * (1 - f * 0.6));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

// ---------------------------------------------------------------- bump texture

/**
 * Seamless bump map for the sphere-mapped heart: sampled on the unit sphere from (u, v), so the
 * left and right edges match. Fine streaks follow the muscle fibers; fat areas get lobules.
 */
let cached: THREE.DataTexture | null = null;

/** The bump texture, built once per page (the landing page and the report share it). */
export function sharedHeartBumpTexture(): THREE.DataTexture {
  cached ??= heartBumpTexture();
  return cached;
}

export function heartBumpTexture(width = 640, height = 320): THREE.DataTexture {
  const data = new Uint8Array(width * height * 4);
  const d = new THREE.Vector3();
  for (let y = 0; y < height; y++) {
    const phi = (1 - y / (height - 1)) * Math.PI; // texture row 0 is v = 0, the bottom (apex)
    for (let x = 0; x < width; x++) {
      const theta = (x / width) * Math.PI * 2;
      // SphereGeometry: x = -cos(theta) sin(phi), y = cos(phi), z = sin(theta) sin(phi)
      d.set(-Math.cos(theta) * Math.sin(phi), Math.cos(phi), Math.sin(theta) * Math.sin(phi));
      const fibers = fbm(d.x * 22 + d.y * 6, d.y * 4, d.z * 22 - d.y * 6, 3);  // stretched: fiber streaks
      const grain = fbm(d.x * 40, d.y * 40, d.z * 40, 2);
      const lobules = 1 - Math.abs(fbm(d.x * 14 + 11, d.y * 14, d.z * 14, 3) * 2 - 1); // ridged: fat lobules
      const fat = fatAmount(d);
      const h = (1 - fat) * (0.65 * fibers + 0.35 * grain) + fat * (0.75 * lobules + 0.25 * grain);
      const v = Math.round(THREE.MathUtils.clamp(h, 0, 1) * 255);
      const i = (y * width + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
