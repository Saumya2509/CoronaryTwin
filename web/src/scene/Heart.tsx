// The heart, drawn like an anatomical specimen: red-brown myocardium with yellow epicardial
// fat in the grooves (vertex colors from tissue.ts), a fine fiber/fat bump texture, a wet
// clearcoat sheen, and the great vessels cut short with their lumen showing.
// Everything is procedural; the arteries are still projected onto heartShape's surface.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { anatomy } from "../anatomy";
import { buildHeartGeometry, surfacePath } from "./heartShape";
import { applyHeartColors, sharedHeartBumpTexture } from "./tissue";

type P = [number, number, number];

interface GreatVessel {
  id: string;
  points: P[];
  radius: number;
  color: string;
  /** Show a cut end (lumen) at the far end. */
  cut?: boolean;
}

// Heart-local frame (before the anatomical tilt): +y base, -y apex, +z anterior, +x patient's left.
// Decorative, for orientation only; not modeled by the estimates.
const GREAT_VESSELS: GreatVessel[] = [
  // Aorta: ascending, arch over the pulmonary bifurcation, descending behind the heart.
  { id: "aorta", points: [[-0.06, 0.52, 0.06], [-0.1, 0.95, 0.1], [-0.06, 1.22, 0.02], [0.08, 1.33, -0.14], [0.26, 1.28, -0.32], [0.36, 1.06, -0.46], [0.38, 0.82, -0.52]], radius: 0.125, color: "#d9b4a2", cut: true },
  { id: "brachiocephalic", points: [[-0.08, 1.24, 0.0], [-0.14, 1.44, 0.02], [-0.2, 1.62, 0.02]], radius: 0.052, color: "#d6b2a1", cut: true },
  { id: "left-carotid", points: [[0.06, 1.32, -0.1], [0.07, 1.5, -0.09], [0.08, 1.66, -0.08]], radius: 0.038, color: "#d6b2a1", cut: true },
  { id: "left-subclavian", points: [[0.2, 1.32, -0.24], [0.27, 1.48, -0.25], [0.34, 1.62, -0.27]], radius: 0.044, color: "#d6b2a1", cut: true },
  // Pulmonary trunk in front of the aorta, splitting under the arch.
  { id: "pulmonary-trunk", points: [[0.16, 0.56, 0.3], [0.2, 0.86, 0.32], [0.2, 1.06, 0.16]], radius: 0.105, color: "#c79aa0" },
  { id: "left-pa", points: [[0.2, 1.06, 0.16], [0.4, 1.12, 0.0], [0.62, 1.06, -0.12]], radius: 0.075, color: "#c79aa0", cut: true },
  { id: "right-pa", points: [[0.2, 1.06, 0.16], [0.0, 1.1, -0.08], [-0.3, 1.04, -0.18]], radius: 0.072, color: "#c79aa0", cut: true },
  // Venae cavae (venous, bluish) into the right atrium.
  { id: "svc", points: [[-0.36, 0.5, -0.12], [-0.4, 0.95, -0.1], [-0.38, 1.32, -0.06]], radius: 0.08, color: "#7a6a95", cut: true },
  { id: "ivc", points: [[-0.34, 0.05, -0.36], [-0.4, -0.12, -0.46], [-0.42, -0.26, -0.5]], radius: 0.085, color: "#7a6a95", cut: true },
  // Four pulmonary veins into the left atrium at the back.
  { id: "lspv", points: [[0.3, 0.58, -0.6], [0.44, 0.66, -0.76], [0.54, 0.7, -0.84]], radius: 0.045, color: "#a65d69", cut: true },
  { id: "lipv", points: [[0.3, 0.44, -0.62], [0.44, 0.42, -0.78], [0.54, 0.4, -0.86]], radius: 0.043, color: "#a65d69", cut: true },
  { id: "rspv", points: [[-0.04, 0.58, -0.66], [-0.16, 0.66, -0.84], [-0.28, 0.7, -0.92]], radius: 0.045, color: "#a65d69", cut: true },
  { id: "ripv", points: [[-0.04, 0.44, -0.68], [-0.16, 0.42, -0.86], [-0.28, 0.4, -0.94]], radius: 0.043, color: "#a65d69", cut: true },
];

const VESSEL_NEUTRAL = "#c9b8b4";
const LUMEN = "#3a1414";

function vesselGeometry(v: GreatVessel) {
  const curve = new THREE.CatmullRomCurve3(v.points.map((p) => new THREE.Vector3(...p)), false, "centripetal");
  const tube = new THREE.TubeGeometry(curve, 64, v.radius, 24, false);
  if (!v.cut) return { tube, cap: null, rim: null, at: null, normal: null };
  // Cut end: a dark lumen disc inside a slightly paler wall ring, facing along the vessel.
  const at = curve.getPoint(1);
  const normal = curve.getTangent(1);
  const cap = new THREE.CircleGeometry(v.radius * 0.72, 24);
  const rim = new THREE.RingGeometry(v.radius * 0.72, v.radius, 24);
  return { tube, cap, rim, at, normal };
}

function TissueMaterial({ color, ghost, lite, vertexColors = false, bump = false }: {
  color: string; ghost: boolean; lite: boolean; vertexColors?: boolean; bump?: boolean;
}) {
  const bumpMap = bump ? sharedHeartBumpTexture() : null;
  return (
    <meshPhysicalMaterial
      // transparent/clearcoat changes need a new shader program: remount on ghost or Lite toggles
      key={`${ghost}-${lite}`}
      color={color}
      vertexColors={vertexColors}
      roughness={0.52}
      metalness={0}
      clearcoat={lite ? 0 : 0.55}
      clearcoatRoughness={0.32}
      sheen={lite ? 0 : 0.35}
      sheenColor="#ff9a8a"
      sheenRoughness={0.6}
      bumpMap={bumpMap}
      bumpScale={bumpMap ? 0.9 : 0}
      envMapIntensity={0.55}
      transparent={ghost}
      opacity={ghost ? 0.22 : 1}
      depthWrite={!ghost}
    />
  );
}

export function Heart({ ghost, lite = false }: { ghost: boolean; lite?: boolean }) {
  const geometry = useMemo(() => {
    const g = buildHeartGeometry();
    applyHeartColors(g);
    return g;
  }, []);
  const vessels = useMemo(() => GREAT_VESSELS.map((v) => ({ v, ...vesselGeometry(v) })), []);
  const decorations = useMemo(
    () =>
      anatomy.decorations.map((d) => {
        const pts = surfacePath(d.points, anatomy.heart.surface_offset + d.radius * 0.6, 24);
        return { id: d.id, geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 24, d.radius, 12, false) };
      }),
    [],
  );

  useEffect(() => () => {
    geometry.dispose();
    vessels.forEach((x) => {
      x.tube.dispose();
      x.cap?.dispose();
      x.rim?.dispose();
    });
    decorations.forEach((d) => d.geo.dispose());
  }, [geometry, vessels, decorations]);

  const z = new THREE.Vector3(0, 0, 1);
  return (
    <group>
      <mesh name="heart" geometry={geometry} renderOrder={ghost ? 2 : 0}>
        {/* white base color: the vertex colors carry the tissue */}
        <TissueMaterial color="#ffffff" vertexColors bump ghost={ghost} lite={lite} />
      </mesh>
      {vessels.map(({ v, tube, cap, rim, at, normal }) => (
        <group key={v.id} name={v.id}>
          <mesh geometry={tube}>
            <TissueMaterial color={v.color} ghost={ghost} lite={lite} />
          </mesh>
          {cap && rim && at && normal && (
            <group position={at} quaternion={new THREE.Quaternion().setFromUnitVectors(z, normal)}>
              <mesh geometry={cap} position={[0, 0, -0.004]}>
                <meshStandardMaterial key={String(ghost)} color={LUMEN} roughness={0.8} transparent={ghost} opacity={ghost ? 0.12 : 1} depthWrite={!ghost} />
              </mesh>
              <mesh geometry={rim}>
                <meshStandardMaterial key={String(ghost)} color={v.color} roughness={0.6} side={THREE.DoubleSide} transparent={ghost} opacity={ghost ? 0.22 : 1} depthWrite={!ghost} />
              </mesh>
            </group>
          )}
        </group>
      ))}
      {decorations.map((d) => (
        <mesh key={d.id} name={d.id} geometry={d.geo}>
          <TissueMaterial color={VESSEL_NEUTRAL} ghost={ghost} lite={lite} />
        </mesh>
      ))}
    </group>
  );
}
