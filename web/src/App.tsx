import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { DisclaimerBanner, FirstUseModal } from "./components/Disclaimer";
import { Header } from "./components/Header";
import { InputForm } from "./components/InputForm";
import { NextBestTest } from "./components/NextBestTest";
import { PatientView } from "./components/PatientView";
import { PrintSummary } from "./components/PrintSummary";
import { startGuidedTour } from "./components/PresentMode";
import { Alerts, KpiStrip } from "./components/RiskCards";
import { ShapPanel } from "./components/ShapPanel";
import { Sidebar } from "./components/Sidebar";
import { Tabs } from "./components/Tabs";
import { Toast } from "./components/Toast";
import { TrustTab } from "./components/TrustTab";
import { Visits } from "./components/Visits";
import { WhatIf } from "./components/WhatIf";
import { LandingPage } from "./landing/LandingPage";
import { useRisk } from "./store/risk";
import { useDashboard } from "./useDashboard";

// three.js is most of the bundle: load the 3D viewer separately so the record, headline and
// disclaimer paint first. The placeholder reserves the same space (no layout shift).
const HeartViewer = lazy(() => import("./scene/HeartViewer").then((m) => ({ default: m.HeartViewer })));

const METHOD = [
  {
    title: "Data",
    body: "303 patients from the Extension of Z-Alizadeh Sani dataset (UCI). 51 routine measurements across history, symptoms, vitals, labs, ECG and echo. A tested guard keeps the catheterization labels out of the model inputs.",
  },
  {
    title: "Models",
    body: "Four classifiers (overall CAD, LAD, LCX, RCA) were chosen by nested 5×5 cross-validation and calibrated with Platt scaling. Every reported figure comes from patients the model did not see during training.",
  },
  {
    title: "Uncertainty",
    body: "Conformal prediction at 90% coverage. When both outcomes remain possible, the vessel is marked Uncertain and drawn translucent and dashed, so it never looks as certain as a confident one.",
  },
  {
    title: "Explanations",
    body: "SHAP values are computed separately for each model and grouped by measurement family. What-if only changes modifiable values and shows model sensitivity, not treatment advice.",
  },
];

type PageView = "landing" | "dashboard";

function initialPage(): PageView {
  if (typeof window === "undefined") return "landing";
  const hash = window.location.hash.toLowerCase();
  const q = new URLSearchParams(window.location.search);
  if (hash === "#dashboard" || hash === "#report" || q.get("page") === "dashboard" || q.get("view") === "dashboard") {
    return "dashboard";
  }
  return "landing";
}

export default function App() {
  const { online } = useDashboard();
  const error = useRisk((s) => s.error);
  const [page, setPage] = useState<PageView>(initialPage);
  const [snapshot, setSnapshot] = useState<string | null>(null);
  const drawerOpen = useRisk((s) => s.drawerOpen);
  const setDrawer = useRisk((s) => s.setDrawer);
  // Closing from inside the drawer returns focus to the header button that opens it.
  const closeDrawer = () => {
    setDrawer(false);
    window.requestAnimationFrame(() => document.getElementById("drawer-toggle")?.focus({ preventScroll: true }));
  };
  const lite = useRisk((s) => s.view.lite);
  const sbCollapsed = useRisk((s) => s.sidebarCollapsed);
  const audience = useRisk((s) => s.audience);
  const [tourError, setTourError] = useState<string | null>(null);
  const topbar = useRef<HTMLDivElement>(null);

  // Sticky offsets (drawer, tab bar) follow the real height of the header + safety banner.
  useEffect(() => {
    const el = topbar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => document.documentElement.style.setProperty("--topbar-h", `${el.offsetHeight}px`));
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);
  const tour = useCallback(() => {
    setTourError(null);
    startGuidedTour().catch((e: Error) => setTourError(e.message));
  }, []);

  // ?tour=1 deep link: start once the API is ready.
  useEffect(() => {
    if (online && page === "dashboard" && new URLSearchParams(window.location.search).get("tour") === "1") tour();
  }, [online, page, tour]);

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.toLowerCase();
      if (hash === "#dashboard" || hash === "#report") {
        setPage("dashboard");
      } else if (hash === "#showcase" || hash === "#landing") {
        setPage("landing");
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const navigateToDashboard = useCallback(() => {
    setPage("dashboard");
    try {
      window.location.hash = "#dashboard";
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const navigateToLanding = useCallback(() => {
    setPage("landing");
    try {
      window.location.hash = "#showcase";
    } catch {
      /* ignore */
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Export PDF (md/final.md part 3): a generated A4 report. jsPDF loads only when it is first used.
  const exportSummary = useCallback(() => {
    const canvas = document.querySelector<HTMLCanvasElement>(".stage canvas");
    let shot: string | null = null;
    try {
      shot = canvas ? canvas.toDataURL("image/png") : null;
    } catch { /* tainted or lost context: the report goes without the 3D image */ }
    setSnapshot(shot);
    const st = useRisk.getState();
    import("./report/pdf")
      .then((m) => m.exportPdf(shot))
      .catch((e: Error) => st.setToast(`PDF export failed: ${e.message}`));
  }, []);

  if (page === "landing") {
    return (
      <LandingPage
        online={online}
        onLaunchDashboard={navigateToDashboard}
      />
    );
  }

  return (
    <div className={`app has-sidebar ${sbCollapsed ? "sb-collapsed" : ""} aud-${audience} ${drawerOpen ? "drawer-open" : ""} ${lite ? "lite" : ""}`}>
      <a className="skip-link" href="#main">
        Skip to report
      </a>
      <Sidebar onExport={exportSummary} onTour={online ? tour : undefined} onLanding={navigateToLanding} />
      <div className="topbar" ref={topbar}>
        <Header onExport={exportSummary} onNavigateLanding={navigateToLanding} />
        <DisclaimerBanner />
      </div>
      {(error || tourError) && (
        <div className="error-banner" role="alert">
          {error ? `Could not update the estimate: ${error}. The last valid result is still shown.` : `Guided tour unavailable: ${tourError}.`}
        </div>
      )}

      <aside
        id="patient-drawer"
        className={`drawer ${drawerOpen ? "is-open" : ""}`}
        aria-label="Patient record"
        inert={!drawerOpen}
        onKeyDown={(e) => {
          if (e.key === "Escape" && !(e.target as HTMLElement).closest("dialog")) closeDrawer();
        }}
      >
        <button type="button" className="icon-btn drawer-close" onClick={closeDrawer} aria-label="Close patient record">×</button>
        <InputForm online={online} />
      </aside>

      <main id="main" className="dash">
        <KpiStrip />
        <Alerts />
        <Visits />
        <Suspense fallback={<div className="stage-wrap stage-placeholder" aria-busy="true" aria-label="Loading 3D view" />}>
          <HeartViewer />
        </Suspense>
        <NextBestTest />
        <Tabs
          panels={{
            explain: <ShapPanel />,
            whatif: <WhatIf online={online} />,
            trust: <TrustTab online={online} />,
            patient: <PatientView />,
          }}
        />
      </main>

      <section id="sec-method" className="method" aria-labelledby="method-title">
        <h2 id="method-title">Method</h2>
        <ol className="method-grid">
          {METHOD.map((m, i) => (
            <li key={m.title}>
              <span className="method-num mono">{String(i + 1).padStart(2, "0")}</span>
              <h3>{m.title}</h3>
              <p>{m.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <footer className="colophon">
        <span>CoronaryTwin · Multimodal AI Hackathon 2026, Track A</span>
        <span>Data: Alizadehsani, Roshanzamir &amp; Sani (2013), UCI, DOI 10.24432/C5461K</span>
        <span>{audience === "patient" ? "Please talk to your doctor about these results." : "Decision support and education only."}</span>
      </footer>
      <FirstUseModal />
      <Toast />
      <PrintSummary snapshot={snapshot} />
    </div>
  );
}
