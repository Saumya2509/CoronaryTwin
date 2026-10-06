import { OrbitControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { anatomy, vesselById } from "../anatomy";
import { prefersReducedMotionNow, useRisk, type ViewPreset } from "../store/risk";
import { surfacePath } from "./heartShape";

const DISTANCE = 4.4;
const CENTER = new THREE.Vector3(0, 0.3, 0); // heart + great vessels (arch and branches)
const PRESETS: Record<ViewPreset, THREE.Vector3> = {
  anterior: new THREE.Vector3(0, 0.45, DISTANCE),
  posterior: new THREE.Vector3(0, 0.45, -DISTANCE),
  left: new THREE.Vector3(DISTANCE, 0.45, 0), // patient's left lateral
};
const TILT = new THREE.Euler(...anatomy.heart.tilt);
const SNAP = 0.02;        // close enough to finish the move
const MAX_MOVE_MS = 1200; // hard cap on any camera move

/** World-space centroid of a vessel (after the heart's anatomical tilt). */
function vesselCentroid(id: string): THREE.Vector3 | null {
  const spec = vesselById(id);
  if (!spec) return null;
  const pts = surfacePath(spec.points, 0, 60);
  const c = pts.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(pts.length);
  return c.applyEuler(TILT);
}

/** Decorative idle drift (md/10.md section 21): a very slow turn until the user touches the scene. */
export function useIdleDrift(): boolean {
  const touched = useRisk((s) => s.touched);
  const selected = useRisk((s) => s.selected);
  const present = useRisk((s) => s.present);
  const lite = useRisk((s) => s.view.lite);
  const hasResult = useRisk((s) => s.result !== null);
  return hasResult && !touched && selected === null && present === null && !lite && !prefersReducedMotionNow();
}

/**
 * OrbitControls with damping and distance limits, plus eased camera moves for
 * preset views and for "fly to the selected vessel".
 */
export function CameraRig() {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, invalidate } = useThree();
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; start: number } | null>(null);

  const selected = useRisk((s) => s.selected);
  const request = useRisk((s) => s.cameraRequest);
  const touch = useRisk((s) => s.touch);
  const drift = useIdleDrift();
  const centroids = useMemo(
    () => Object.fromEntries(anatomy.vessels.map((v) => [v.id, vesselCentroid(v.id)])),
    [],
  );

  useEffect(() => {
    goal.current = { pos: PRESETS[request.preset].clone(), target: CENTER.clone(), start: performance.now() };
    invalidate();
  }, [request, invalidate]);

  useEffect(() => {
    if (!selected) return;
    const c = centroids[selected];
    if (!c) return;
    // Look at the vessel from outside the heart, along its outward direction.
    const dir = c.clone().setY(c.y * 0.4).normalize();
    goal.current = { pos: dir.multiplyScalar(DISTANCE * 0.85).add(new THREE.Vector3(0, 0.2, 0)), target: c.clone().multiplyScalar(0.5), start: performance.now() };
    invalidate();
  }, [selected, centroids, invalidate]);

  // Narrow (portrait) canvases: zoom out so the whole heart, with its callouts, stays in view.
  const size = useThree((s) => s.size);
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const cam = camera as THREE.PerspectiveCamera;
    cam.zoom = Math.min(1, Math.max(0.55, aspect / 1.15));
    cam.updateProjectionMatrix();
    invalidate();
  }, [size.width, size.height, camera, invalidate]);

  useFrame((_, delta) => {
    const g = goal.current;
    const ctl = controls.current;
    if (!g || !ctl) return;
    const k = 1 - Math.exp(-delta * 5); // frame-rate independent easing
    camera.position.lerp(g.pos, k);
    ctl.target.lerp(g.target, k);
    // A move must always end: OrbitControls' damping can hold the target a hair short of
    // the goal forever, which kept on-demand rendering running non-stop. Snap when close,
    // and never animate longer than MAX_MOVE_MS.
    const close = camera.position.distanceTo(g.pos) < SNAP && ctl.target.distanceTo(g.target) < SNAP;
    if (close || performance.now() - g.start > MAX_MOVE_MS) {
      camera.position.copy(g.pos);
      ctl.target.copy(g.target);
      ctl.update();
      goal.current = null;
      invalidate(); // one final frame at the exact pose
      return;
    }
    ctl.update();
    invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      dampingFactor={0.08}
      minDistance={1.6}
      maxDistance={6}
      enablePan
      autoRotate={drift && goal.current === null}
      autoRotateSpeed={0.35}
      onStart={() => {
        goal.current = null; // user takes over; cancel any eased move and stop the idle drift
        touch();
      }}
    />
  );
}
