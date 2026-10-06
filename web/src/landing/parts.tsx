// Small building blocks for the landing page: icons, motion hooks, the island nav and the tagline.
import { useCallback, useEffect, useRef, useState } from "react";

export const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/* ------------------------------------------------------------------ icons (Phosphor regular geometry) */

export type IconName = "play" | "arrow" | "download" | "upload" | "plus" | "pulse" | "cube" | "lightbulb" | "plug" | "gauge";

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  const s = { fill: "none", stroke: "currentColor", strokeWidth: 16, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} aria-hidden="true" className="lp-icon">
      {name === "play" && <path {...s} d="M72 39.9v176.2a8 8 0 0 0 12.2 6.7l144-88.1a7.8 7.8 0 0 0 0-13.4l-144-88.1A8 8 0 0 0 72 39.9Z" />}
      {name === "arrow" && <g {...s}><line x1="40" y1="128" x2="216" y2="128" /><polyline points="144 56 216 128 144 200" /></g>}
      {name === "download" && <g {...s}><line x1="128" y1="40" x2="128" y2="144" /><polyline points="216 144 216 208 40 208 40 144" /><polyline points="168 104 128 144 88 104" /></g>}
      {name === "upload" && <g {...s}><line x1="128" y1="144" x2="128" y2="32" /><polyline points="216 144 216 208 40 208 40 144" /><polyline points="88 72 128 32 168 72" /></g>}
      {name === "plus" && <g {...s}><line x1="40" y1="128" x2="216" y2="128" /><line x1="128" y1="40" x2="128" y2="216" /></g>}
      {name === "pulse" && <polyline {...s} points="24 128 72 128 96 72 136 184 160 128 232 128" />}
      {name === "cube" && <g {...s}><path d="M224 177.3V78.7a8 8 0 0 0-4.1-7l-88-49.5a7.8 7.8 0 0 0-7.8 0l-88 49.5a8 8 0 0 0-4.1 7v98.6a8 8 0 0 0 4.1 7l88 49.5a7.8 7.8 0 0 0 7.8 0l88-49.5a8 8 0 0 0 4.1-7Z" /><polyline points="222.9 74.6 128.9 128 33.1 74.6" /><line x1="128.9" y1="128" x2="128" y2="234.8" /></g>}
      {name === "lightbulb" && <g {...s}><line x1="88" y1="232" x2="168" y2="232" /><path d="M78.7 167A79.9 79.9 0 0 1 48 104.5C47.8 61.1 82.7 25 126.1 24a80 80 0 0 1 51.3 142.9A24.3 24.3 0 0 0 168 186v2a8 8 0 0 1-8 8H96a8 8 0 0 1-8-8v-2a24.1 24.1 0 0 0-9.3-19Z" /></g>}
      {name === "plug" && <g {...s}><line x1="88" y1="88" x2="88" y2="32" /><line x1="168" y1="88" x2="168" y2="32" /><path d="M48 88h160v40a80 80 0 0 1-160 0Z" /><line x1="128" y1="208" x2="128" y2="240" /></g>}
      {name === "gauge" && <g {...s}><path d="M24 168v-24C24 86.6 70.6 40 128 40s104 46.6 104 104v24a8 8 0 0 1-8 8H32a8 8 0 0 1-8-8Z" /><line x1="128" y1="176" x2="176" y2="88" /></g>}
    </svg>
  );
}

/* ------------------------------------------------------------------ motion */

/** Fade up every [data-reveal] element once it enters the viewport. Re-scans when `key` changes. */
export function useReveal(root: React.RefObject<HTMLElement | null>, key: unknown) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const targets = Array.from(el.querySelectorAll<HTMLElement>("[data-reveal]:not(.is-in)"));
    if (reducedMotion() || !("IntersectionObserver" in window)) {
      targets.forEach((t) => t.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => {
        if (e.isIntersecting) {
          e.target.classList.add("is-in");
          io.unobserve(e.target);
        }
      }),
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    targets.forEach((t) => io.observe(t));
    return () => io.disconnect();
  }, [root, key]);
}

/** True once the element has been on screen. */
export function useSeen<T extends HTMLElement>(): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    if (!("IntersectionObserver" in window)) { setSeen(true); return; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } }, { threshold: 0.3 });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return [ref, seen];
}

/** Animates from the previous value to `target` (ease out). Jumps straight there with reduced motion. */
export function useCountUp(target: number | null, active = true, ms = 1100): number | null {
  const [value, setValue] = useState<number | null>(null);
  const from = useRef(0);
  useEffect(() => {
    if (target === null || !active) return;
    if (reducedMotion()) { setValue(target); from.current = target; return; }
    const start = performance.now();
    const a = from.current;
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 4);
      setValue(a + (target - a) * e);
      if (t < 1) raf = requestAnimationFrame(tick);
      else from.current = target;
    });
    return () => cancelAnimationFrame(raf);
  }, [target, active, ms]);
  return value;
}

/* ------------------------------------------------------------------ tagline */

/** Large tagline whose words light up one at a time, in reading order, as it scrolls through the viewport. */
export function TaglineReveal({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const words = Array.from(el.querySelectorAll<HTMLElement>(".lp-word"));
    if (reducedMotion() || !("IntersectionObserver" in window)) {
      words.forEach((w) => w.classList.add("is-on"));
      return;
    }
    let raf = 0;
    let listening = false;
    const update = () => {
      raf = 0;
      const vh = window.innerHeight;
      const top = el.getBoundingClientRect().top;
      const progress = Math.min(1, Math.max(0, (vh * 0.85 - top) / (vh * 0.55)));
      const lit = Math.round(progress * words.length);
      words.forEach((w, i) => w.classList.toggle("is-on", i < lit));
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !listening) {
        listening = true;
        window.addEventListener("scroll", onScroll, { passive: true });
        update();
      } else if (!entry.isIntersecting && listening) {
        listening = false;
        window.removeEventListener("scroll", onScroll);
      }
    });
    io.observe(el);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <p ref={ref} className="lp-tagline" aria-label={lines.join(" ")}>
      {lines.map((line, li) => (
        <span key={li} className="lp-tagline-line" aria-hidden="true">
          {line.split(" ").map((w, wi) => <span key={wi} className="lp-word">{w} </span>)}
        </span>
      ))}
    </p>
  );
}

/* ------------------------------------------------------------------ navigation */

export const NAV = [
  { href: "#reading", label: "Reading the heart" },
  { href: "#inside", label: "How it works" },
  { href: "#evidence", label: "Evidence" },
  { href: "#faq", label: "FAQ" },
];

function useActiveSection() {
  const [active, setActive] = useState("");
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    const sections = NAV.map((n) => document.querySelector(n.href)).filter(Boolean) as Element[];
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) setActive(`#${e.target.id}`); }),
      { rootMargin: "-45% 0px -50% 0px" },
    );
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);
  return active;
}

export function IslandNav({ onOpenReport, onPreload }: { onOpenReport: () => void; onPreload: () => void }) {
  const [open, setOpen] = useState(false);
  const active = useActiveSection();
  const toggleRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <>
      <nav className="lp-island" aria-label="Main">
        <a href="#top" className="lp-wordmark">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="lp-mark">
            <path d="M12 21s-7.5-4.6-9.3-9.6C1.5 7.9 3.6 4.5 7 4.5c2 0 3.5 1.1 5 3 1.5-1.9 3-3 5-3 3.4 0 5.5 3.4 4.3 6.9C19.5 16.4 12 21 12 21Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
            <path d="M5 12h3.5l1.5-3 3 6 1.5-3H19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          CoronaryTwin
        </a>
        <ul className="lp-island-links">
          {NAV.map((n) => (
            <li key={n.href}>
              <a href={n.href} aria-current={active === n.href ? "location" : undefined}>{n.label}</a>
            </li>
          ))}
        </ul>
        <button type="button" className="lp-btn lp-btn-primary lp-btn-sm" onClick={onOpenReport} onMouseEnter={onPreload} onFocus={onPreload}>
          Open the report
        </button>
        <button
          ref={toggleRef}
          type="button"
          className={`lp-burger${open ? " is-open" : ""}`}
          aria-expanded={open}
          aria-controls="lp-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((o) => !o)}
        >
          <span /><span />
        </button>
      </nav>

      <div id="lp-menu" className={`lp-menu${open ? " is-open" : ""}`} aria-hidden={!open} role="dialog" aria-modal="true" aria-label="Menu">
        <ul>
          {NAV.map((n, i) => (
            <li key={n.href} style={{ transitionDelay: open ? `${100 + i * 50}ms` : "0ms" }}>
              <a href={n.href} tabIndex={open ? 0 : -1} onClick={() => setOpen(false)}>{n.label}</a>
            </li>
          ))}
          <li style={{ transitionDelay: open ? `${100 + NAV.length * 50}ms` : "0ms" }}>
            <button type="button" className="lp-btn lp-btn-primary" tabIndex={open ? 0 : -1} onClick={() => { setOpen(false); onOpenReport(); }}>
              Open the report <Icon name="arrow" size={16} />
            </button>
          </li>
        </ul>
      </div>
    </>
  );
}
