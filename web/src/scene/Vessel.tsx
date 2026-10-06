import { Line } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { createContext, useContext, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { TargetResult } from "../api/types";
import { anatomy, type VesselSpec } from "../anatomy";
import { useRisk, useVessel } from "../store/risk";
import { AnchorPoint } from "./Callout";
import { pulseAt, vesselVisual } from "./colorScale";
import { surfacePath } from "./heartShape";

const NEUTRAL = "#9c9c9c";
const SEGMENT_TAPER = [1, 0.86, 0.7]; // proximal -> distal
const FRAME_INTERVAL = 1 / 30;        // pulse updates capped at ~30 fps

/** Per-vessel results that replace the store's, so the landing page can show a patient without loading it into the report. */
export const VesselResultsContext = createContext<Record<string, TargetResult> | null>(null);

/**
 * One coronary artery: a tube projected onto the heart surface, split into proximal,
 * mid and distal segments. All segments share the vessel's probability: the dataset has
 * no per-segment labels, so the split is anatomical styling only (schematic).
 */
export function Vessel({ spec, phase = 0 }: { spec: VesselSpec; phase?: number }) {
  const override = useContext(VesselResultsContext);
  const storeResult = useVessel(spec.id);
  const result = override ? override[spec.id] ?? null : storeResult;
  const selected = useRisk((s) => s.selected === spec.id);
  const hovered = useRisk((s) => s.hovered === spec.id);
  const pulseOn = useRisk((s) => s.view.pulse);
  const select = useRisk((s) => s.select);
  const hover = useRisk((s) => s.hover);
  const invalidate = useThree((s) => s.invalidate);

  // Geometry: built once per vessel spec.
  const { segments, outline, labelAt } = useMemo(() => {
    const lift = anatomy.heart.surface_offset + spec.radius * 0.55;
    const pts = surfacePath(spec.points, lift, 150);
    const n = spec.segments.length;
    const segs = spec.segments.map((name, i) => {
      const a = Math.floor((i * (pts.length - 1)) / n);
      const b = Math.floor(((i + 1) * (pts.length - 1)) / n);
      // Overlap neighbours by two samples so joints show no seam.
      const curve = new THREE.CatmullRomCurve3(pts.slice(Math.max(0, a - 1), Math.min(pts.length, b + 2)));
      const r = spec.radius * (SEGMENT_TAPER[i] ?? SEGMENT_TAPER[SEGMENT_TAPER.length - 1]);
      const tubular = Math.max(8, b - a);
      return {
        name,
        geometry: new THREE.TubeGeometry(curve, tubular, r, 14, false),
        haloGeometry: new THREE.TubeGeometry(curve, tubular, r * 1.45, 14, false),
        rimGeometry: new THREE.TubeGeometry(curve, tubular, r * 1.22, 14, false),
      };
    });
    // Dashed outline rides just above the tube so it reads on static screenshots.
    const out = surfacePath(spec.points, anatomy.heart.surface_offset + spec.radius * 2.1, 150);
    const at = spec.callout?.at ?? 0.35;
    return { segments: segs, outline: out, labelAt: pts[Math.floor((pts.length - 1) * at)] };
  }, [spec]);

  const visual = result ? vesselVisual(result.prob, result.uncertainty, result.state) : null;
  const material = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 }), []);
  const rim = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#1a0a0a", side: THREE.BackSide, transparent: true, opacity: 0.55, depthWrite: false }),
    [],
  );
  const halo = useMemo(
    () => new THREE.MeshBasicMaterial({ color: "#2DD4BF", side: THREE.BackSide, transparent: true, opacity: 0.45, depthWrite: false }),
    [],
  );

  useEffect(() => () => {
    material.dispose();
    halo.dispose();
    rim.dispose();
    segments.forEach((s) => {
      s.geometry.dispose();
      s.haloGeometry.dispose();
      s.rimGeometry.dispose();
    });
  }, [material, halo, rim, segments]);

  // Static appearance: color, opacity, highlight.
  useEffect(() => {
    const color = new THREE.Color(visual?.color ?? NEUTRAL);
    material.color.copy(color);
    material.emissive.copy(color);
    material.transparent = (visual?.opacity ?? 1) < 1;
    material.opacity = visual?.opacity ?? 1;
    material.depthWrite = !material.transparent;
    material.emissiveIntensity = hovered || selected ? 0.55 : 0.2; // vessels glow in their own risk color
    material.needsUpdate = true;
    invalidate(); // on-demand rendering: show the new color now, not on the next drag
  }, [visual?.color, visual?.opacity, hovered, selected, material, invalidate]);

  // Uncertainty pulse: speed and irregularity grow with uncertainty.
  const acc = useRef(0);
  useFrame((state, delta) => {
    if (!visual || !pulseOn) return;
    acc.current += delta;
    if (acc.current < FRAME_INTERVAL) return;
    acc.current = 0;
    const base = hovered || selected ? 0.4 : 0.1;
    material.emissiveIntensity = base + pulseAt(state.clock.elapsedTime, visual, phase);
  });

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    hover(spec.id);
    document.body.style.cursor = "pointer";
  };
  const onOut = () => {
    hover(null);
    document.body.style.cursor = "";
  };
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    select(selected ? null : spec.id);
  };

  return (
    <group name={spec.id}>
      {segments.map((s) => (
        <mesh
          key={s.name}
          name={`${spec.id}-${s.name}`}
          geometry={s.geometry}
          material={material}
          onPointerOver={onOver}
          onPointerOut={onOut}
          onClick={onClick}
        />
      ))}
      {segments.map((s) => (
        <mesh key={`rim-${s.name}`} geometry={s.rimGeometry} material={rim} renderOrder={-1} raycast={() => null} />
      ))}
      {selected &&
        segments.map((s) => (
          <mesh key={`halo-${s.name}`} geometry={s.haloGeometry} material={halo} renderOrder={-1} raycast={() => null} />
        ))}
      {visual?.dashed && (
        <Line points={outline} color="#F1F5F9" lineWidth={1.8} dashed dashSize={0.035} gapSize={0.03} transparent opacity={0.95} />
      )}
      <AnchorPoint id={spec.id} position={labelAt} />
    </group>
  );
}
