// 2D SVG schematic for devices without WebGL (module 05, section 3.7).
// Same anatomy, same projection, same colors and uncertainty dashes as the 3D view.
import { useMemo } from "react";
import * as THREE from "three";
import { anatomy } from "../anatomy";
import { useRisk } from "../store/risk";
import { riskCss } from "./colorScale";
import { heartRadius, surfacePath } from "./heartShape";

const TILT = new THREE.Euler(...anatomy.heart.tilt);
const SCALE = 120;
const toSvg = (p: THREE.Vector3) => `${(p.x * SCALE).toFixed(1)},${(-p.y * SCALE).toFixed(1)}`;

export function Fallback2D() {
  const result = useRisk((s) => s.result);
  const selected = useRisk((s) => s.selected);
  const select = useRisk((s) => s.select);

  const outline = useMemo(() => {
    const pts: string[] = [];
    for (let i = 0; i <= 120; i++) {
      const a = (i / 120) * Math.PI * 2;
      const d = new THREE.Vector3(Math.cos(a), Math.sin(a), 0);
      pts.push(toSvg(d.multiplyScalar(heartRadius(d)).applyEuler(TILT)));
    }
    return pts.join(" ");
  }, []);

  const vessels = useMemo(
    () =>
      anatomy.vessels.map((v) => {
        const pts = surfacePath(v.points, 0, 80).map((p) => p.applyEuler(TILT));
        const front = pts.filter((p) => p.z >= -0.05).map(toSvg).join(" ");
        const back = pts.filter((p) => p.z < -0.05).map(toSvg).join(" ");
        return { spec: v, front, back };
      }),
    [],
  );

  return (
    <svg viewBox="-150 -170 300 320" className="fallback-2d" role="img" aria-label="Schematic front view of the heart with colored coronary arteries">
      <polygon points={outline} fill="#e9e1df" stroke="#b8a3a0" strokeWidth={2} />
      {vessels.map(({ spec, front, back }) => {
        const r = result?.vessels[spec.id];
        const color = r ? riskCss(r.prob) : "#9c9c9c";
        const dashed = r?.state === "Uncertain";
        const width = (spec.radius / 0.026) * (selected === spec.id ? 9 : 6);
        return (
          <g key={spec.id} onClick={() => select(spec.id)} style={{ cursor: "pointer" }}>
            <title>{`${spec.label}: ${r ? Math.round(r.prob * 100) + "% (" + r.state + ")" : "no estimate"}`}</title>
            {back && <polyline points={back} fill="none" stroke={color} strokeWidth={width * 0.6} strokeOpacity={0.35} strokeDasharray="4 4" />}
            <polyline points={front} fill="none" stroke={color} strokeWidth={width} strokeLinecap="round"
              strokeOpacity={dashed ? 0.6 : 1} strokeDasharray={dashed ? "10 6" : undefined} />
          </g>
        );
      })}
      <text x={0} y={145} textAnchor="middle" fontSize={11} fill="currentColor">Schematic front view (WebGL unavailable)</text>
    </svg>
  );
}
