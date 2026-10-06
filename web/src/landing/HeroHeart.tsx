// Landing-page heart: the same scene components as the report, fed by the landing page's own
// prediction (VesselResultsContext) so nothing is loaded into the report. It turns slowly while
// on screen, flies to the focused artery, never captures the mouse wheel, and stops rendering
// when scrolled away.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { TargetResult } from "../api/types";
import { anatomy, vesselById } from "../anatomy";
import { Heart } from "../scene/Heart";
import { surfacePath } from "../scene/heartShape";
import { StudioEnv } from "../scene/StudioEnv";
import { Vessel, VesselResultsContext } from "../scene/Vessel";
import { Warmup } from "../scene/Warmup";

const DISTANCE = 4.4;
const HOME = new THREE.Vector3(0, 0.45, DISTANCE);
const CENTER = new THREE.Vector3(0, 0.3, 0);
const TILT = new THREE.Euler(...anatomy.heart.tilt);

function centroid(id: string): THREE.Vector3 | null {
  const spec = vesselById(id);
  if (!spec) return null;
  const pts = surfacePath(spec.points, 0, 60);
  return pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length).applyEuler(TILT);
}

function LandingRig({ focus, spin }: { focus: string | null; spin: boolean }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const { camera, invalidate } = useThree();
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3; start: number } | null>(null);
  const [touched, setTouched] = useState(false);
  const centroids = useMemo(() => Object.fromEntries(anatomy.vessels.map((v) => [v.id, centroid(v.id)])), []);

  useEffect(() => {
    const c = focus ? centroids[focus] : null;
    goal.current = c
      ? { pos: c.clone().setY(c.y * 0.4).normalize().multiplyScalar(DISTANCE * 1.05).add(new THREE.Vector3(0, 0.3, 0)), target: c.clone().multiplyScalar(0.3).add(new THREE.Vector3(0, 0.15, 0)), start: performance.now() }
      : touched ? null : { pos: HOME.clone(), target: CENTER.clone(), start: performance.now() };
    invalidate();
  }, [focus, centroids, invalidate, touched]);

  useFrame((_, delta) => {
    const g = goal.current;
    const ctl = controls.current;
    if (!g || !ctl) return;
    const k = 1 - Math.exp(-delta * 4);
    camera.position.lerp(g.pos, k);
    ctl.target.lerp(g.target, k);
    if (camera.position.distanceTo(g.pos) < 0.02 || performance.now() - g.start > 1400) {
      camera.position.copy(g.pos);
      ctl.target.copy(g.target);
      goal.current = null;
    }
    ctl.update();
    invalidate();
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={CENTER}
      enableZoom={false}
      enablePan={false}
      autoRotate={spin && !touched && !focus}
      autoRotateSpeed={1.2}
      onStart={() => { goal.current = null; setTouched(true); }}
    />
  );
}

interface HeroHeartProps {
  results: Record<string, TargetResult> | null;
  focus: string | null;
}

export function HeroHeart({ results, focus }: HeroHeartProps) {
  const host = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(true);
  const reduced = useMemo(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false, []);

  useEffect(() => {
    const el = host.current;
    if (!el || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const live = visible && !reduced;
  return (
    <div ref={host} style={{ position: "absolute", inset: 0 }}>
      <Canvas
        dpr={[1, 1.5]}
        frameloop={live ? "always" : "demand"}
        camera={{ position: [HOME.x, HOME.y, HOME.z], fov: 35, near: 0.1, far: 50 }}
        gl={{ antialias: true, powerPreference: "low-power", alpha: true }}
        aria-label="Interactive 3D heart showing a real dataset patient. Drag to rotate."
      >
        <VesselResultsContext.Provider value={results ?? {}}>
          <StudioEnv />
          <hemisphereLight args={["#fff1e8", "#2a1416", 0.55]} />
          <directionalLight position={[2.2, 3, 4]} intensity={1.5} color="#fff3ea" />
          <directionalLight position={[-3, 1.2, -2.5]} intensity={0.9} color="#9fd8ff" />
          <directionalLight position={[0, -3, 2]} intensity={0.25} color="#ffd2c4" />
          <group rotation={anatomy.heart.tilt}>
            <Heart ghost={false} />
            {anatomy.vessels.map((v, i) => <Vessel key={v.id} spec={v} phase={i * 1.7} />)}
          </group>
          <LandingRig focus={focus} spin={live} />
          <Warmup />
        </VesselResultsContext.Provider>
      </Canvas>
    </div>
  );
}

export default HeroHeart;
