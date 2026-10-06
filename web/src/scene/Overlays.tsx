// Explanation-on-anatomy (module 03, section 3.3). Group SHAP totals for the selected
// target (overall CAD when nothing is selected) are drawn on and around the heart.
// Placement is SCHEMATIC: "Echo" glows on a wall region because echo features describe
// the heart wall, not because the model localized anything there.
import { Html, Line } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef, type ReactNode } from "react";
import * as THREE from "three";
import type { Line2 } from "three-stdlib";
import type { Explanation } from "../api/types";
import { useRisk } from "../store/risk";
import { buildSurfacePatch } from "./heartShape";

const RAISED = "#B79CFF";  // pushed the estimate up (violet: deliberately not a risk color)
const LOWERED = "#5CC8FF"; // pushed it down

export interface GroupShare {
  group: string;
  value: number;  // signed sum of SHAP in the group
  share: number;  // |value| / sum |values|
}

export function groupShares(exp: Explanation | undefined): GroupShare[] {
  if (!exp) return [];
  const entries = Object.entries(exp.groups);
  const total = entries.reduce((a, [, v]) => a + Math.abs(v), 0) || 1;
  return entries.map(([group, value]) => ({ group, value, share: Math.abs(value) / total }));
}

/** Explanation for the selected vessel, else the overall model. */
export function useActiveExplanation(): { target: string; exp: Explanation | undefined } {
  const result = useRisk((s) => s.result);
  const selected = useRisk((s) => s.selected);
  const target = selected ?? (result ? Object.keys(result.explanations).find((k) => !(k in result.vessels)) : undefined) ?? "CAD";
  return { target, exp: result?.explanations[target] };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** Echo: soft glow on the left-ventricular anterolateral wall (inside the tilted heart group). */
const ECHO_CENTER = new THREE.Vector3(0.55, -0.3, 0.62);
const ECHO_RADIUS = 0.62;

export function EchoGlow({ share, value, highlight = false }: { share: number; value: number; highlight?: boolean }) {
  const geometry = useMemo(() => {
    const g = buildSurfacePatch(ECHO_CENTER, ECHO_RADIUS, 0.008);
    // Soft glow: alpha falls off smoothly from the patch center to its rim.
    const pos = g.attributes.position as THREE.BufferAttribute;
    const c = ECHO_CENTER.clone().normalize();
    const v = new THREE.Vector3();
    const alpha = new Float32Array(pos.count * 4);
    for (let i = 0; i < pos.count; i++) {
      const t = Math.min(1, v.fromBufferAttribute(pos, i).normalize().angleTo(c) / ECHO_RADIUS);
      const a = (1 - t * t) ** 2;
      alpha.set([1, 1, 1, a], i * 4);
    }
    g.setAttribute("color", new THREE.BufferAttribute(alpha, 4));
    return g;
  }, []);
  return (
    <group>
      <mesh geometry={geometry} renderOrder={1} raycast={() => null}>
        <meshBasicMaterial
          color={value >= 0 ? RAISED : LOWERED}
          vertexColors
          transparent
          opacity={highlight ? 0.95 : 0.15 + 0.7 * share}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

function ecgWave(phase: number, n = 140): THREE.Vector3[] {
  // Stylized PQRST complex repeating twice across the strip.
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    const t = (x * 2 + phase) % 1;
    const p = 0.06 * Math.exp(-(((t - 0.18) / 0.035) ** 2));
    const q = -0.05 * Math.exp(-(((t - 0.36) / 0.012) ** 2));
    const r = 0.32 * Math.exp(-(((t - 0.4) / 0.013) ** 2));
    const s = -0.09 * Math.exp(-(((t - 0.44) / 0.013) ** 2));
    const tw = 0.1 * Math.exp(-(((t - 0.66) / 0.06) ** 2));
    pts.push(new THREE.Vector3(x * 0.75 - 0.375, p + q + r + s + tw, 0));
  }
  return pts;
}

/** ECG: animated trace beside the heart; brightness = ECG group share. */
/**
 * Keeps its children beside the heart in SCREEN space: offset along the camera's right and up
 * vectors from the orbit target, facing the camera. From any view angle the ECG trace and the
 * labs gauge sit next to the heart, never in front of it.
 */
function ScreenAnchor({ right, up, children }: { right: number; up: number; children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  const controls = useThree((s) => s.controls) as unknown as { target?: THREE.Vector3 } | null;
  const tmp = useMemo(() => ({ r: new THREE.Vector3(), u: new THREE.Vector3(), t: new THREE.Vector3(0, 0.3, 0) }), []);
  useFrame(({ camera }) => {
    if (!g.current) return;
    const target = controls?.target ?? tmp.t;
    tmp.r.set(1, 0, 0).applyQuaternion(camera.quaternion);
    tmp.u.set(0, 1, 0).applyQuaternion(camera.quaternion);
    g.current.position.copy(target).addScaledVector(tmp.r, right).addScaledVector(tmp.u, up);
    g.current.quaternion.copy(camera.quaternion);
  });
  return <group ref={g}>{children}</group>;
}

export function EcgTrace({ share, value, animate, highlight = false }: { share: number; value: number; animate: boolean; highlight?: boolean }) {
  const line = useRef<Line2>(null);
  const phase = useRef(0);
  const acc = useRef(0);
  const initial = useMemo(() => ecgWave(0), []);
  useFrame((_, delta) => {
    if (!animate || !line.current) return;
    acc.current += delta;
    if (acc.current < 1 / 30) return;
    phase.current = (phase.current + acc.current * 0.25) % 1;
    acc.current = 0;
    line.current.geometry.setPositions(ecgWave(phase.current).flatMap((p) => [p.x, p.y, p.z]));
  });
  return (
    <ScreenAnchor right={1.42} up={0.05}>
      <Line ref={line} points={initial} color={value >= 0 ? RAISED : LOWERED} lineWidth={(1 + 3 * share) * (highlight ? 2 : 1)} transparent opacity={highlight ? 1 : 0.25 + 0.75 * share} />
      <Html position={[0, -0.18, 0]} center pointerEvents="none" zIndexRange={[5, 0]}>
        <div className={`overlay-label ${highlight ? "is-hl" : ""}`}>ECG · {pct(share)} of drivers</div>
      </Html>
    </ScreenAnchor>
  );
}

/** Labs: a "blood panel" gauge; the arc length is the Labs group share. */
export function LabsGauge({ share, value, highlight = false }: { share: number; value: number; highlight?: boolean }) {
  const geometry = useMemo(() => new THREE.TorusGeometry(0.16, 0.022, 10, 64, Math.max(0.05, share) * Math.PI * 2), [share]);
  const track = useMemo(() => new THREE.TorusGeometry(0.16, 0.012, 8, 64), []);
  return (
    <ScreenAnchor right={1.42} up={-0.62}>
      <mesh geometry={track} raycast={() => null} scale={highlight ? 1.15 : 1}>
        <meshBasicMaterial color="#9aa0a6" transparent opacity={0.35} />
      </mesh>
      <mesh geometry={geometry} rotation={[0, 0, Math.PI / 2]} raycast={() => null} scale={highlight ? 1.15 : 1}>
        <meshBasicMaterial color={value >= 0 ? RAISED : LOWERED} />
      </mesh>
      <Html position={[0, -0.28, 0]} center pointerEvents="none" zIndexRange={[5, 0]}>
        <div className={`overlay-label ${highlight ? "is-hl" : ""}`}>Labs · {pct(share)} of drivers</div>
      </Html>
    </ScreenAnchor>
  );
}

/** Overlays that live outside the tilted heart group. */
export function SideOverlays({ shares, animate }: { shares: GroupShare[]; animate: boolean }) {
  const ecg = shares.find((s) => s.group === "ECG");
  const labs = shares.find((s) => s.group === "Labs");
  const hl = useRisk((s) => s.hoverGroup);
  return (
    <>
      {ecg && <EcgTrace share={ecg.share} value={ecg.value} animate={animate} highlight={hl === "ECG"} />}
      {labs && <LabsGauge share={labs.share} value={labs.value} highlight={hl === "Labs"} />}
    </>
  );
}

export const OVERLAY_COLORS = { raised: RAISED, lowered: LOWERED };
