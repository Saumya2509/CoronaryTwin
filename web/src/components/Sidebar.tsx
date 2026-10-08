// Navigation sidebar (md/final.md part 1). Three zones: brand at the top; OVERVIEW / ANALYSIS / REPORTS
// navigation in the middle; patient record, theme and demo status at the bottom. 240px wide, collapses
// to a 72px icon rail (tooltips on hover/focus), and becomes a slide-over drawer below 768px.
// The active item follows the scroll position (and the selected tab inside Analysis).
import { useEffect, useState, type ReactNode } from "react";
import { exitDemo, showDemo } from "../demo";
import { prefersReducedMotionNow, useRisk, type Tab } from "../store/risk";
import { useTheme } from "../theme";

// One icon set: 24px, 2px stroke, round caps (Lucide-style paths).
const I = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="sb-icon">{d}</svg>
);
const ICONS = {
  logo: I(<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z M3.5 12h5l1.5-3 3 6 1.5-3h6" />),
  estimate: I(<><path d="M3 3v18h18" /><path d="M7 15l4-4 3 3 5-6" /></>),
  heart: I(<path d="M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4 3 5.5l7 7Z" />),
  tour: I(<><circle cx="12" cy="12" r="9" /><path d="M10 8.5v7l5.5-3.5L10 8.5Z" /></>),
  landing: I(<><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>),
  method: I(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z" /><path d="M8 7h8M8 11h6" /></>),
  explain: I(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14" /><path d="M12 17h.01" /></>),
  whatif: I(<><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3" /><path d="M1 14h6M9 8h6M17 16h6" /></>),
  trust: I(<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>),
  patient: I(<><circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.4-6 8-6s6.5 2 8 6" /></>),
  reports: I(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>),
  export: I(<><path d="M12 15V3M7 10l5 5 5-5" /><path d="M5 21h14" /></>),
  record: I(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7h6M9 11h6M9 15h3" /></>),
  sun: I(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>),
  moon: I(<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />),
  play: I(<path d="M7 4v16l13-8L7 4Z" />),
  csv: I(<><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" /><path d="M14 3v5h5" /><path d="M8 13h8M8 17h8M11 11v8" /></>),
  collapse: I(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M16 10l-2 2 2 2" /></>),
  expand: I(<><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M9 3v18M14 10l2 2-2 2" /></>),
  close: I(<path d="M18 6 6 18M6 6l12 12" />),
};

type Item = { id: string; label: string; icon: ReactNode } & (
  | { kind: "section"; target: string }
  | { kind: "tab"; tab: Tab }
  | { kind: "action"; run: () => void }
);

const SECTIONS = ["sec-estimate", "sec-heart", "sec-analysis", "sec-method"];

/** The section whose top has passed the reading line (a third of the way down the viewport). */
function useScrollSpy(): string {
  const [current, setCurrent] = useState(SECTIONS[0]);
  useEffect(() => {
    let raf = 0;
    const update = () => {
      raf = 0;
      // The reading line: a third of the way down the visible area below the sticky top bar.
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--topbar-h")) || 100;
      const line = bar + (window.innerHeight - bar) * 0.35;
      let id = SECTIONS[0];
      for (const s of SECTIONS) {
        const el = document.getElementById(s);
        if (el && el.getBoundingClientRect().top <= line) id = s;
      }
      // At the very bottom the last section is current even if its top never reaches the line,
      // but only when it is actually on screen (a long tab can end the page before it).
      const last = document.getElementById(SECTIONS[SECTIONS.length - 1]);
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && last
        && last.getBoundingClientRect().top < window.innerHeight * 0.75) id = SECTIONS[SECTIONS.length - 1];
      if (window.scrollY < 40) id = SECTIONS[0];   // at the top of the page: the estimate
      setCurrent(id);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    // Content that loads after a click (a tab's data) moves sections without any scroll event.
    const ro = new ResizeObserver(onScroll);
    ro.observe(document.body);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);
  return current;
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: prefersReducedMotionNow() ? "auto" : "smooth", block: "start" });
}

export function Sidebar({ onExport, onTour, onLanding }: { onExport: () => void; onTour?: () => void; onLanding?: () => void }) {
  const collapsed = useRisk((s) => s.sidebarCollapsed);
  const setCollapsed = useRisk((s) => s.setSidebarCollapsed);
  const open = useRisk((s) => s.sidebarOpen);
  const setOpen = useRisk((s) => s.setSidebarOpen);
  const tab = useRisk((s) => s.tab);
  const setTab = useRisk((s) => s.setTab);
  const drawerOpen = useRisk((s) => s.drawerOpen);
  const setDrawer = useRisk((s) => s.setDrawer);
  const setReportsOpen = useRisk((s) => s.setReportsOpen);
  const inputs = useRisk((s) => s.inputs);
  const nFeatures = useRisk((s) => s.spec?.features.length ?? 0);
  const hasResult = useRisk((s) => s.result !== null);
  const demo = useRisk((s) => s.demo);
  const setSamplesOpen = useRisk((s) => s.setSamplesOpen);
  const [theme, setTheme] = useTheme();
  const section = useScrollSpy();
  const recorded = Object.values(inputs).filter((v) => v !== null && v !== undefined).length;

  // Escape closes the phone drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  const groups: { label: string; items: Item[] }[] = [
    { label: "Overview", items: [
      { id: "estimate", label: "Estimate", icon: ICONS.estimate, kind: "section", target: "sec-estimate" },
      { id: "heart", label: "3D heart", icon: ICONS.heart, kind: "section", target: "sec-heart" },
      { id: "method", label: "Method", icon: ICONS.method, kind: "section", target: "sec-method" },
      ...(onTour ? [{ id: "tour", label: "Guided tour", icon: ICONS.tour, kind: "action" as const, run: onTour }] : []),
      ...(onLanding ? [{ id: "landing", label: "Project overview", icon: ICONS.landing, kind: "action" as const, run: onLanding }] : []),
    ] },
    { label: "Analysis", items: [
      { id: "explain", label: "Why this estimate", icon: ICONS.explain, kind: "tab", tab: "explain" },
      { id: "whatif", label: "What-if", icon: ICONS.whatif, kind: "tab", tab: "whatif" },
      { id: "trust", label: "Model trust", icon: ICONS.trust, kind: "tab", tab: "trust" },
    ] },
    { label: "Reports", items: [
      { id: "patient", label: "Patient summary", icon: ICONS.patient, kind: "tab", tab: "patient" },
      { id: "read", label: "Read reports", icon: ICONS.reports, kind: "action", run: () => { setDrawer(true); setReportsOpen(true); } },
      { id: "export", label: "Export PDF", icon: ICONS.export, kind: "action", run: onExport },
    ] },
  ];

  const isActive = (it: Item) =>
    (it.kind === "section" && section === it.target && section !== "sec-analysis") ||
    (it.kind === "tab" && section === "sec-analysis" && tab === it.tab);

  const activate = (it: Item) => {
    if (it.kind === "section") scrollToSection(it.target);
    else if (it.kind === "tab") { setTab(it.tab); scrollToSection("sec-analysis"); }
    else it.run();
    setOpen(false);
  };

  const row = (key: string, label: string, icon: ReactNode, onClick: () => void, extra?: { active?: boolean; disabled?: boolean; aside?: ReactNode; pressed?: boolean }) => (
    <li key={key}>
      <button type="button" className="nav-item" data-tip={label} onClick={onClick} disabled={extra?.disabled}
        aria-current={extra?.active ? "page" : undefined} aria-pressed={extra?.pressed}
        aria-label={collapsed ? label : undefined}>
        {icon}
        <span className="nav-label">{label}</span>
        {extra?.aside}
      </button>
    </li>
  );

  return (
    <>
      <nav id="sidebar" className={`sidebar ${collapsed ? "collapsed" : ""} ${open ? "is-open" : ""}`} aria-label="Dashboard">
        <div className="sb-top">
          <button type="button" className="sb-brand" onClick={() => { window.scrollTo({ top: 0, behavior: prefersReducedMotionNow() ? "auto" : "smooth" }); setOpen(false); }}
            aria-label="CoronaryTwin, back to the top" data-tip="CoronaryTwin">
            <span className="sb-logo">{ICONS.logo}</span>
            <span className="sb-name">CoronaryTwin</span>
          </button>
          <button type="button" className="sb-toggle sb-desktop" onClick={() => setCollapsed(!collapsed)}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} aria-controls="sidebar" title={collapsed ? "Expand" : "Collapse"}>
            {collapsed ? ICONS.expand : ICONS.collapse}
          </button>
          <button type="button" className="sb-toggle sb-phone" onClick={() => setOpen(false)} aria-label="Close menu">{ICONS.close}</button>
        </div>

        <div className="sb-nav">
          {groups.map((g) => (
            <div key={g.label} className="sb-group" role="group" aria-labelledby={`sb-${g.label}`}>
              <p id={`sb-${g.label}`} className="sb-label">{g.label}</p>
              <ul>
                {g.items.map((it) => row(it.id, it.label, it.icon, () => activate(it), {
                  active: isActive(it),
                  disabled: (it.id === "export" || it.id === "patient") && !hasResult,
                }))}
              </ul>
            </div>
          ))}
        </div>

        <div className="sb-bottom">
          <ul>
            {row("record", "Patient record", ICONS.record, () => { setDrawer(!drawerOpen); setOpen(false); }, {
              pressed: drawerOpen,
              aside: <span className="nav-count tabular">{recorded}/{nFeatures || "–"}</span>,
            })}
            {row("theme", theme === "dark" ? "Light theme" : "Dark theme", theme === "dark" ? ICONS.sun : ICONS.moon,
              () => setTheme(theme === "dark" ? "light" : "dark"))}
          </ul>
          {demo ? (
            <div className="sb-demo" role="status">
              <span className="sb-demo-dot" aria-hidden="true" data-tip={`Sample ${demo.active + 1} · ${demo.sets[demo.active].label}`} />
              <span className="sb-demo-text">
                <b>Sample patient</b>
                <span>Sample {demo.active + 1} of {demo.sets.length} · {demo.sets[demo.active].label}</span>
              </span>
              <span className="sb-demo-actions">
                <button type="button" className="linkbtn small" onClick={() => setSamplesOpen(true)}>Change</button>
                <button type="button" className="linkbtn small" onClick={() => showDemo((demo.active + 1) % demo.sets.length)}>Next</button>
                <button type="button" className="linkbtn small" onClick={exitDemo}>Exit</button>
              </span>
            </div>
          ) : (
            <ul>{row("demo", "CSV samples", ICONS.csv, () => { setSamplesOpen(true); setOpen(false); })}</ul>
          )}
        </div>
      </nav>
      {open && <div className="sb-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
    </>
  );
}

/** Hamburger for phones (the sidebar is a drawer below 768px). */
export function SidebarButton() {
  const open = useRisk((s) => s.sidebarOpen);
  const setOpen = useRisk((s) => s.setSidebarOpen);
  return (
    <button type="button" className="icon-btn sb-hamburger" aria-label="Open menu" aria-expanded={open} aria-controls="sidebar"
      onClick={() => setOpen(true)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <path d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    </button>
  );
}
