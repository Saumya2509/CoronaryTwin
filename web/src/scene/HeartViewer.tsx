// The stage (md/10.md Part B): one large 3D scene with everything else floating over it.
//   top-left      overall estimate (Hero)          top-right   glass toolbar
//   on arteries   callouts with leader lines        right       artery detail panel when selected
//   bottom-left   drivers card                      bottom      Present-mode steps and caption
// Ambient glow, floor ring, heartbeat and idle drift are decorative mood cues only; numbers and
// words carry the meaning. Lite mode drops them (and blur) and keeps every piece of information.
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type * as THREE from "three";
import { anatomy } from "../anatomy";
import { patientPhrase } from "../features";
import { DetailPanel } from "../components/DetailPanel";
import { PresentBar } from "../components/PresentMode";
import { Hero } from "../components/RiskCards";
import { Toggle } from "../components/ui";
import { prefersReducedMotionNow, useRisk, type ViewPreset } from "../store/risk";
import { CalloutLayer, CalloutTracker, HeartCenter } from "./Callout";
import { CameraRig, useIdleDrift } from "./CameraRig";
import { riskCss } from "./colorScale";
import { Fallback2D } from "./Fallback2D";
import { Heart } from "./Heart";
import { StudioEnv } from "./StudioEnv";
import { Legend } from "./Legend";
import { EchoGlow, groupShares, SideOverlays, useActiveExplanation } from "./Overlays";
import { Vessel } from "./Vessel";
import { Warmup } from "./Warmup";

function hasWebGL(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!(c.getContext("webgl2") ?? c.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * With frameloop="demand", request ~30 fps only while something animates, the tab is
 * visible AND the canvas is on screen. Scrolling down to the analysis stops all 3D work.
 */
function Ticker({ active }: { active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  const canvas = useThree((s) => s.gl.domElement);
  useEffect(() => {
    if (!active) return;
    let id: number | undefined;
    let onScreen = true;
    const start = () => {
      if (id === undefined && onScreen && !document.hidden) id = window.setInterval(() => invalidate(), 33);
    };
    const stop = () => {
      if (id !== undefined) window.clearInterval(id);
      id = undefined;
    };
    const onVis = () => (document.hidden ? stop() : start());
    const io = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      if (onScreen) start();
      else stop();
    });
    io.observe(canvas);
    start();
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [active, invalidate, canvas]);
  return null;
}

/** Decorative heartbeat: the heart group scales by ~1.2% at a calm ~62 bpm. Not the patient's rhythm. */
function Heartbeat({ on, children }: { on: boolean; children: ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!g.current) return;
    if (!on) {
      if (g.current.scale.x !== 1) g.current.scale.setScalar(1);
      return;
    }
    const t = (clock.elapsedTime * 1.03) % 1;
    const beat = Math.exp(-(((t - 0.12) / 0.05) ** 2)) + 0.45 * Math.exp(-(((t - 0.3) / 0.05) ** 2));
    g.current.scale.setScalar(1 + 0.012 * beat);
  });
  return <group ref={g}>{children}</group>;
}

/**
 * Lite-mode auto switch (md/10.md section 22): while the scene is animating, measure the
 * delivered frame rate over 3 s windows; two slow windows in a row turn Lite mode on, once.
 */
function FpsGuard({ active, onSlow }: { active: boolean; onSlow: () => void }) {
  const frames = useRef(0);
  const slow = useRef(0);
  const done = useRef(false);
  useFrame(() => {
    frames.current++;
  });
  useEffect(() => {
    if (!active || done.current) return;
    frames.current = 0;
    const id = window.setInterval(() => {
      if (document.hidden) {
        frames.current = 0;
        return;
      }
      const fps = frames.current / 3;
      frames.current = 0;
      slow.current = fps < 14 ? slow.current + 1 : 0;
      if (slow.current >= 2 && !done.current) {
        done.current = true;
        onSlow();
      }
    }, 3000);
    return () => window.clearInterval(id);
  }, [active, onSlow]);
  return null;
}

/** `?fps=1`: render every frame and report the frame rate, to measure a target laptop (improve.md P1.9). */
const FPS_MODE = typeof window !== "undefined" && new URLSearchParams(window.location.search).has("fps");

function FpsReporter({ onFps }: { onFps: (fps: number) => void }) {
  const frames = useRef(0);
  useFrame(() => {
    frames.current++;
  });
  useEffect(() => {
    const id = window.setInterval(() => {
      onFps(frames.current);
      frames.current = 0;
    }, 1000);
    return () => window.clearInterval(id);
  }, [onFps]);
  return null;
}

function Scene({ onSlow, onFps }: { onSlow: () => void; onFps: (fps: number) => void }) {
  const view = useRisk((s) => s.view);
  const hasResult = useRisk((s) => s.result !== null);
  const select = useRisk((s) => s.select);
  const drift = useIdleDrift();
  const hoverGroup = useRisk((s) => s.hoverGroup);
  const cohort = useRisk((s) => s.cohort);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => invalidate(), [hoverGroup, cohort, invalidate]);
  const { exp } = useActiveExplanation();
  const shares = useMemo(() => groupShares(exp), [exp]);
  const echo = shares.find((s) => s.group === "Echo");
  const beat = hasResult && view.pulse && !view.lite && !prefersReducedMotionNow();
  const animating = hasResult && (view.pulse || drift);

  return (
    <>
      <StudioEnv enabled={!view.lite} />
      <hemisphereLight args={["#fff1e8", "#2a1416", 0.55]} />
      <directionalLight position={[2.2, 3, 4]} intensity={1.5} color="#fff3ea" />
      <directionalLight position={[-3, 1.2, -2.5]} intensity={0.9} color="#9fd8ff" />
      <directionalLight position={[0, -3, 2]} intensity={0.25} color="#ffd2c4" />
      <Heartbeat on={beat}>
        <group rotation={anatomy.heart.tilt} onPointerMissed={() => select(null)}>
          <HeartCenter />
          <Heart ghost={view.ghost} lite={view.lite} />
          {anatomy.vessels.map((v, i) => (
            <Vessel key={v.id} spec={v} phase={i * 1.7} />
          ))}
          {view.overlays && echo && !cohort && <EchoGlow share={echo.share} value={echo.value} highlight={hoverGroup === "Echo"} />}
        </group>
      </Heartbeat>
      {view.overlays && !cohort && (hoverGroup === "ECG" || hoverGroup === "Labs") && <SideOverlays shares={shares} animate={view.pulse} />}
      <CalloutTracker />
      <CameraRig />
      <Ticker active={animating} />
      <FpsGuard active={animating && !view.lite} onSlow={onSlow} />
      <Warmup />
      {FPS_MODE && <FpsReporter onFps={onFps} />}
    </>
  );
}

const PRESET_LABELS: Record<ViewPreset, string> = { anterior: "Anterior", posterior: "Posterior", left: "Left lateral" };

function StageToolbar({ autoLite }: { autoLite: boolean }) {
  const view = useRisk((s) => s.view);
  const setView = useRisk((s) => s.setView);
  const requestView = useRisk((s) => s.requestView);
  const selected = useRisk((s) => s.selected);
  const select = useRisk((s) => s.select);
  const hasResult = useRisk((s) => s.result !== null && s.cohort === null);
  const present = useRisk((s) => s.present);
  const setPresent = useRisk((s) => s.setPresent);
  const [preset, setPreset] = useState<ViewPreset>("anterior");
  const menu = useRef<HTMLDetailsElement>(null);
  // Close the Display menu on an outside click or Escape.
  useEffect(() => {
    const close = (e: Event) => {
      const m = menu.current;
      if (!m?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !m.contains(e.target as Node)) m.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <div className="stage-toolbar glass" role="toolbar" aria-label="View controls">
      <div className="seg" role="group" aria-label="Preset views">
        {(Object.keys(PRESET_LABELS) as ViewPreset[]).map((p) => (
          <button key={p} type="button" aria-pressed={preset === p && selected === null} onClick={() => { setPreset(p); requestView(p); }}>
            {PRESET_LABELS[p]}
          </button>
        ))}
      </div>
      <div className="chips" role="group" aria-label="Focus an artery">
        {anatomy.vessels.map((v) => (
          <button key={v.id} type="button" className="chip-btn" aria-pressed={selected === v.id} onClick={() => select(selected === v.id ? null : v.id)} title={v.label}>
            {v.id}
          </button>
        ))}
      </div>
      <details className="display-menu" ref={menu}>
        <summary className="chip-btn" aria-label="Display options">Display ▾</summary>
        <div className="display-pop glass" role="group" aria-label="Display options">
          <Toggle label="Ghost heart" checked={view.ghost} onChange={(v) => setView({ ghost: v })} />
          <Toggle label="Explanation overlays" checked={view.overlays} onChange={(v) => setView({ overlays: v })} title="Glows on the anatomy and the drivers card" />
          <Toggle label="Pulse" checked={view.pulse} onChange={(v) => setView({ pulse: v })} title="Uncertainty pulse and decorative heartbeat" />
          <Toggle
            label={autoLite && view.lite ? "Lite mode (auto)" : "Lite mode"}
            checked={view.lite}
            onChange={(v) => setView({ lite: v })}
            title="Fewer effects (no blur, glow, heartbeat or drift). All information stays."
          />
        </div>
      </details>
      <button type="button" className="btn primary small present-btn" disabled={!hasResult} onClick={() => setPresent(present === null ? 0 : null)} aria-pressed={present !== null}>
        {present === null ? "▶ Present" : "■ Stop"}
      </button>
    </div>
  );
}

/** Group shares for the explained target, as bars in the muted group colors. */
function DriversCard() {
  const result = useRisk((s) => s.result);
  const overlays = useRisk((s) => s.view.overlays);
  const patient = useRisk((s) => s.audience === "patient");
  const spec = useRisk((s) => s.spec);
  const { target, exp } = useActiveExplanation();
  const shares = useMemo(() => groupShares(exp).sort((a, b) => b.share - a.share), [exp]);
  const hoverGroup = useRisk((s) => s.hoverGroup);
  const setHoverGroup = useRisk((s) => s.setHoverGroup);
  const cohort = useRisk((s) => s.cohort);
  const [all, setAll] = useState(false);
  if (!result || !exp || cohort) return null;

  if (patient) {
    const specs = Object.fromEntries((spec?.features ?? []).map((f) => [f.name, f]));
    const up = exp.features.filter((f) => f.shap > 0).slice(0, 2);
    if (!up.length) return null;
    return (
      <aside className="drivers glass" aria-label="What raised this estimate the most">
        <p className="drivers-title">What raised this the most</p>
        <ul className="drivers-plain">{up.map((f) => <li key={f.name}>{patientPhrase(specs[f.name], f.value, f.name)}</li>)}</ul>
      </aside>
    );
  }
  if (!overlays) return null;
  return (
    <aside className="drivers glass" aria-label={`Measurement groups driving the ${target} estimate`}>
      <p className="drivers-title" title="Hover a group to light it up on the heart">Drivers · {target}</p>
      <ul className="drivers-list">
        {(all ? shares : shares.slice(0, 4)).map((s) => (
          <li key={s.group} onMouseEnter={() => setHoverGroup(s.group)} onMouseLeave={() => setHoverGroup(null)} className={hoverGroup === s.group ? "is-hl" : ""}>
            <span className="drivers-name">{s.group}</span>
            <span className="drivers-bar" aria-hidden="true"><span style={{ width: `${s.share * 100}%`, background: `var(--g-${s.group})` }} /></span>
            <span className="drivers-val tabular">
              <span className={s.value >= 0 ? "dir up" : "dir down"} aria-hidden="true">{s.value >= 0 ? "▲" : "▼"}</span>
              {Math.round(s.share * 100)}%
              <span className="sr-only">{s.value >= 0 ? " raised" : " lowered"}</span>
            </span>
          </li>
        ))}
      </ul>
      {shares.length > 4 && (
        <button type="button" className="linkbtn drivers-more" onClick={() => setAll((x) => !x)} aria-expanded={all}>
          {all ? "Top 4" : `All ${shares.length} groups`}
        </button>
      )}
    </aside>
  );
}

/** The stage: 3D heart with floating hero, toolbar, callouts, drivers, detail panel and Present mode. */
export function HeartViewer() {
  const [webgl] = useState(hasWebGL);
  const [autoLite, setAutoLite] = useState(false);
  const [fps, setFps] = useState<number | null>(null);
  const result = useRisk((s) => s.result);
  const loading = useRisk((s) => s.loading);
  const lite = useRisk((s) => s.view.lite);
  const setView = useRisk((s) => s.setView);
  const onSlow = useMemo(() => () => {
    setAutoLite(true);
    setView({ lite: true });
  }, [setView]);
  const style = result ? ({ "--risk": riskCss(result.overall.prob) } as CSSProperties) : undefined;

  return (
    <section id="sec-heart" className="stage-wrap" aria-label="3D coronary view">
      <div className={`stage ${lite ? "is-lite" : ""}`} style={style} aria-busy={loading}>
        <div className="floor-ring" aria-hidden="true" />
        <div className="stage-canvas">
          {webgl ? (
            <Canvas
              dpr={[1, 1.5]}
              frameloop={FPS_MODE ? "always" : "demand"}
              camera={{ position: [0, 0.45, 4.4], fov: 35, near: 0.1, far: 50 }}
              gl={{ antialias: true, preserveDrawingBuffer: true, alpha: true }}
            >
              <Scene onSlow={onSlow} onFps={setFps} />
            </Canvas>
          ) : (
            <Fallback2D />
          )}
          {webgl && <CalloutLayer />}
        </div>
        <Hero />
        <StageToolbar autoLite={autoLite} />
        <DriversCard />
        <DetailPanel />
        <PresentBar />
        <span className="schematic-tag" title="Arteries are colored from vessel-level estimates, not lesion locations. Callout anchors, glows and the heartbeat are illustrative.">
          Schematic
        </span>
        {loading && <div className="stage-loading" role="status">Updating…</div>}
        {FPS_MODE && fps !== null && <div className="fps-meter" role="status">{fps} fps{lite ? " · Lite" : ""}</div>}
      </div>
      <Legend />
    </section>
  );
}
