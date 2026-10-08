import { exitDemo } from "../demo";
import { useRisk, type Audience } from "../store/risk";
import { SidebarButton } from "./Sidebar";

/** Small ring showing how many of the measurements are recorded. */
function Ring({ done, total }: { done: number; total: number }) {
  const f = total ? done / total : 0;
  const c = 2 * Math.PI * 7;
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" className="ring">
      <circle cx="9" cy="9" r="7" className="ring-track" />
      <circle cx="9" cy="9" r="7" className="ring-fill" strokeDasharray={`${f * c} ${c}`} transform="rotate(-90 9 9)" />
    </svg>
  );
}

export function Header({ onExport, onNavigateLanding }: { onExport: () => void; onNavigateLanding?: () => void }) {
  const audience = useRisk((s) => s.audience);
  const setAudience = useRisk((s) => s.setAudience);
  const version = useRisk((s) => s.result?.model_version);
  const patientId = useRisk((s) => s.patientId);
  const loading = useRisk((s) => s.loading);
  const hasResult = useRisk((s) => s.result !== null);
  const inputs = useRisk((s) => s.inputs);
  const nFeatures = useRisk((s) => s.spec?.features.length ?? 0);
  const drawerOpen = useRisk((s) => s.drawerOpen);
  const setDrawer = useRisk((s) => s.setDrawer);
  const demo = useRisk((s) => s.demo);
  const setSamplesOpen = useRisk((s) => s.setSamplesOpen);
  const online = useRisk((s) => s.spec !== null);
  const recorded = Object.values(inputs).filter((v) => v !== null && v !== undefined).length;

  return (
    <header className="masthead">
      <SidebarButton />
      <div className="masthead-title">
        <h1 className="wordmark">CoronaryTwin</h1>
        <p className="masthead-sub">
          Coronary risk with uncertainty
          {onNavigateLanding && (
            <>
              {" · "}
              <button type="button" className="linkbtn small" onClick={onNavigateLanding}>← Overview</button>
            </>
          )}
        </p>
      </div>

      <dl className="masthead-meta" aria-live="polite">
        <div className="meta-chip"><dt>Patient</dt><dd className="tabular">{patientId || "none"}</dd></div>
        <div className="meta-chip"><dt>Model</dt><dd className="tabular">{version ?? "–"}</dd></div>
        <div className="meta-chip">
          <dt className="sr-only">Status</dt>
          <dd>
            <span className={`status-dot ${loading ? "busy" : hasResult ? "ok" : ""}`} aria-hidden="true" />
            {loading ? "updating" : hasResult ? "current" : "idle"}
          </dd>
        </div>
      </dl>

      <div className="masthead-actions">
        <button
          type="button" id="drawer-toggle" className="btn" aria-expanded={drawerOpen} aria-controls="patient-drawer"
          onClick={() => {
            setDrawer(!drawerOpen);
            // Opening moves focus into the drawer, so Tab and Escape work there straight away.
            if (!drawerOpen) window.requestAnimationFrame(() => document.querySelector<HTMLElement>(".drawer-close")?.focus({ preventScroll: true }));
          }}
        >
          <Ring done={recorded} total={nFeatures} />
          Patient record
          <span className="btn-count tabular">{recorded}/{nFeatures || "–"}</span>
        </button>
        <div className="seg" role="radiogroup" aria-label="Audience">
          {(["clinician", "patient"] as Audience[]).map((a) => (
            <button key={a} type="button" role="radio" aria-checked={audience === a} onClick={() => setAudience(a)}>
              {a === "clinician" ? "Clinician" : "Patient"}
            </button>
          ))}
        </div>
        <button type="button" className="btn demo-btn" onClick={() => setSamplesOpen(true)} disabled={!online}
          title="Choose one of 10 sample patient CSV files">
          CSV
        </button>
        {demo && (
          <div className="demo-switch" role="group" aria-label="Open sample">
            <span className="demo-badge">Sample {demo.active + 1}/{demo.sets.length}</span>
            <span className="demo-label">{demo.sets[demo.active].label}</span>
            <button type="button" className="btn small ghost" onClick={exitDemo}>Exit</button>
          </div>
        )}
        <button type="button" className="btn primary" onClick={onExport} disabled={!hasResult}>Export PDF</button>
      </div>
    </header>
  );
}
