// Artery callouts with real label placement (md/10.md section 16, decluttered).
//
//   AnchorPoint     inside the 3D scene: an invisible point on each artery (illustrative position)
//   CalloutTracker  inside the scene: projects the anchors to screen pixels after each rendered frame
//   CalloutLayer    DOM overlay: places one compact card per artery in a column on each side of the
//                   heart, sorted top to bottom, pushed clear of each other and of the floating panels
//                   (hero, drivers, toolbar, detail, Present bar), and draws elbow leader lines.
// Cards therefore never overlap, whatever the view angle or stage size.
import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import * as THREE from "three";
import { anatomy, type VesselSpec } from "../anatomy";
import type { TargetResult } from "../api/types";
import { Pill, rangeText } from "../components/ui";
import { cohortResult, useRisk } from "../store/risk";
import { riskCss } from "./colorScale";

// ---------------------------------------------------------------- anchor registry + screen store

const anchors = new Map<string, THREE.Object3D>();
let centerObj: THREE.Object3D | null = null;

interface ScreenAnchor { x: number; y: number; back: boolean }
interface Snapshot { anchors: Record<string, ScreenAnchor>; cx: number; cy: number; r: number; w: number; h: number }

let snapshot: Snapshot = { anchors: {}, cx: 0, cy: 0, r: 0, w: 0, h: 0 };
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

function publish(next: Snapshot) {
  const prev = snapshot;
  const moved = next.w !== prev.w || next.h !== prev.h || Math.abs(next.cx - prev.cx) > 0.5 || Math.abs(next.r - prev.r) > 0.5
    || Object.keys(next.anchors).some((k) => {
      const a = next.anchors[k], b = prev.anchors[k];
      return !b || a.back !== b.back || Math.abs(a.x - b.x) > 0.5 || Math.abs(a.y - b.y) > 0.5;
    });
  if (!moved) return;
  snapshot = next;
  listeners.forEach((l) => l());
}

/** Invisible point on an artery that its callout's leader line points at. */
export function AnchorPoint({ id, position }: { id: string; position: THREE.Vector3 }) {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    if (ref.current) anchors.set(id, ref.current);
    return () => {
      anchors.delete(id);
    };
  }, [id]);
  return <group ref={ref} position={position} />;
}

/** Marks the heart center (inside the tilted heart group). */
export function HeartCenter() {
  const ref = useRef<THREE.Group>(null);
  useEffect(() => {
    centerObj = ref.current;
    return () => {
      centerObj = null;
    };
  }, []);
  return <group ref={ref} />;
}

/** Projects anchors to canvas pixels on every rendered frame (on-demand rendering: only when the view changes). */
export function CalloutTracker() {
  const tmp = useRef({ w: new THREE.Vector3(), c: new THREE.Vector3(), n: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), p: new THREE.Vector3() });
  useFrame(({ camera, size }) => {
    if (!centerObj) return;
    const { w, c, n, v, r, p } = tmp.current;
    centerObj.getWorldPosition(c);
    const toPx = (q: THREE.Vector3) => {
      p.copy(q).project(camera);
      return { x: ((p.x + 1) / 2) * size.width, y: ((1 - p.y) / 2) * size.height };
    };
    const cpx = toPx(c);
    // Heart radius on screen: a point 0.9 world units to the camera's right of the center.
    r.set(1, 0, 0).applyQuaternion(camera.quaternion).multiplyScalar(0.9).add(c);
    const rad = Math.abs(toPx(r).x - cpx.x);
    const out: Record<string, ScreenAnchor> = {};
    anchors.forEach((obj, id) => {
      obj.getWorldPosition(w);
      n.copy(w).sub(c).normalize();
      v.copy(camera.position).sub(w).normalize();
      const s = toPx(w);
      out[id] = { x: s.x, y: s.y, back: n.dot(v) < -0.2 };
    });
    publish({ anchors: out, cx: cpx.x, cy: cpx.y, r: rad, w: size.width, h: size.height });
  });
  return null;
}

// ---------------------------------------------------------------- layout

interface Rect { x: number; y: number; w: number; h: number }
const overlaps = (a: Rect, b: Rect, pad = 6) =>
  a.x < b.x + b.w + pad && a.x + a.w + pad > b.x && a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;

const PANELS = [".hero", ".drivers", ".stage-toolbar", ".detail", ".present", ".schematic-tag"];

/** Panel rectangles relative to the layer, so cards can avoid them. */
function obstacles(layer: HTMLElement): Rect[] {
  const stage = layer.closest(".stage");
  if (!stage) return [];
  const base = layer.getBoundingClientRect();
  return PANELS.flatMap((sel) => Array.from(stage.querySelectorAll<HTMLElement>(sel)))
    .filter((el) => el.offsetParent !== null && getComputedStyle(el).position === "absolute")
    .map((el) => {
      const b = el.getBoundingClientRect();
      return { x: b.left - base.left, y: b.top - base.top, w: b.width, h: b.height };
    });
}

interface Placed { spec: VesselSpec; r: TargetResult; a: ScreenAnchor; side: "left" | "right"; box: Rect }

function layout(items: { spec: VesselSpec; r: TargetResult; a: ScreenAnchor }[], snap: Snapshot, blocks: Rect[], cardW: number, cardH: (id: string) => number): Placed[] {
  const GAP = 28;
  const gap = snap.w < 560 ? 12 : GAP;
  const edge = snap.w < 560 ? 10 : 8;
  const leftX = Math.max(edge, snap.cx - snap.r - gap - cardW);
  const rightX = Math.min(snap.w - cardW - edge, snap.cx + snap.r + gap);
  const placed: Placed[] = [];
  for (const side of ["left", "right"] as const) {
    const mine = items
      .filter(({ spec, a }) => {
        const dx = a.x - snap.cx;
        const s = Math.abs(dx) < snap.r * 0.2 ? spec.callout?.side ?? "right" : dx < 0 ? "left" : "right";
        return s === side;
      })
      .sort((p, q) => p.a.y - q.a.y);
    for (const it of mine) {
      const h = cardH(it.spec.id);
      const box: Rect = { x: side === "left" ? leftX : rightX, y: it.a.y - h / 2, w: cardW, h };
      const taken = [...blocks, ...placed.map((p) => p.box)];
      // Push down past anything in the way; if that runs off the stage, push up instead.
      for (let i = 0; i < 12; i++) {
        const hit = taken.find((t) => overlaps(box, t));
        if (!hit) break;
        box.y = hit.y + hit.h + 8;
      }
      if (box.y + h > snap.h - 8) {
        box.y = Math.min(it.a.y - h / 2, snap.h - h - 8);
        for (let i = 0; i < 12; i++) {
          const hit = taken.find((t) => overlaps(box, t));
          if (!hit) break;
          box.y = hit.y - h - 8;
        }
      }
      box.y = Math.max(8, Math.min(box.y, snap.h - h - 8));
      placed.push({ ...it, side, box });
    }
  }
  return placed;
}

// ---------------------------------------------------------------- DOM layer

export function CalloutLayer() {
  const snap = useSyncExternalStore(subscribe, () => snapshot);
  const result = useRisk((s) => s.result);
  const cohort = useRisk((s) => s.cohort);
  const selected = useRisk((s) => s.selected);
  const hovered = useRisk((s) => s.hovered);
  const patient = useRisk((s) => s.audience === "patient");
  const select = useRisk((s) => s.select);
  const hover = useRisk((s) => s.hover);
  const ref = useRef<HTMLDivElement>(null);
  const [blocks, setBlocks] = useState<Rect[]>([]);

  // Panels move rarely (resize, selection, Present mode): re-measure after each layout change.
  useLayoutEffect(() => {
    if (!ref.current) return;
    const next = obstacles(ref.current);
    setBlocks((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  });

  const mini = snap.w < 560;
  const cardW = mini ? 70 : 172;
  const items = anatomy.vessels
    .map((spec) => {
      const r = cohort ? cohortResult(cohort.summary, spec.id) : result?.vessels[spec.id] ?? null;
      const a = snap.anchors[spec.id];
      return r && a ? { spec, r, a } : null;
    })
    .filter((x): x is { spec: VesselSpec; r: TargetResult; a: ScreenAnchor } => x !== null)
    // With an artery selected, the detail panel shows it: hide the callouts to keep the stage calm.
    .filter(() => selected === null);
  const cardH = (id: string) => (mini ? 36 : selected === id || hovered === id ? 82 : 62);
  const placed = snap.w ? layout(items, snap, blocks, cardW, cardH) : [];

  return (
    <div className={`callout-layer ${mini ? "is-mini" : ""}`} ref={ref} aria-hidden={false}>
      <svg className="callout-lines" width={snap.w} height={snap.h} aria-hidden="true">
        {placed.map(({ spec, r, a, side, box }) => {
          const edgeX = side === "left" ? box.x + box.w : box.x;
          const cy = box.y + box.h / 2;
          const elbowX = side === "left" ? edgeX + 14 : edgeX - 14;
          const color = riskCss(r.prob);
          return (
            <g key={spec.id} className={a.back ? "is-back" : ""}>
              <polyline points={`${a.x},${a.y} ${elbowX},${cy} ${edgeX},${cy}`} fill="none" stroke="currentColor" strokeWidth={1.2} strokeDasharray={a.back ? "3 3" : undefined} />
              <circle cx={a.x} cy={a.y} r={5} fill={color} stroke="#fff" strokeWidth={1.6} />
            </g>
          );
        })}
      </svg>
      {placed.map(({ spec, r, a, box }) => {
        const isSel = selected === spec.id;
        const uncertain = r.state === "Uncertain";
        return (
          <button
            key={spec.id}
            type="button"
            className={`callout glass ${isSel ? "is-selected" : ""} ${uncertain ? "is-uncertain" : ""} ${a.back ? "is-back" : ""}`}
            style={{ left: box.x, top: box.y, width: box.w, "--risk": riskCss(r.prob) } as CSSProperties}
            onClick={() => select(isSel ? null : spec.id)}
            onMouseEnter={() => hover(spec.id)}
            onMouseLeave={() => hover(null)}
            aria-pressed={isSel}
            aria-label={`${spec.patient_label} (${spec.id}): ${Math.round(r.prob * 100)}%, ${r.state}${a.back ? ", on the far side" : ""}`}
            tabIndex={-1 /* the KPI tiles and toolbar chips are the keyboard path */}
          >
            <span className="callout-title">
              {mini ? spec.id : <>{spec.patient_label}{!patient && <small>{spec.id}</small>}</>}
            </span>
            <span className="callout-row">
              <span className="callout-num">{Math.round(r.prob * 100)}<small>%</small></span>
              {!mini && <Pill s={r.state} prob={r.prob} patient={patient} size="sm" />}
            </span>
            {!mini && !patient && (isSel || hovered === spec.id) && r.range && <span className="callout-range">sub-model range {rangeText(r.range)}</span>}
          </button>
        );
      })}
    </div>
  );
}
