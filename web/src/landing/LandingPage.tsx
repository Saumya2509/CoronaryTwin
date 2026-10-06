// Landing page. Every number about the models comes from the API: /metrics, /explanations/global
// and a real dataset patient scored live in the hero (kept out of the report's store).
// The one exception is the "two patients" figure, which is labeled as an illustration on the page.
// Nothing here reads as treatment advice, and the safety banner stays on top.
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getGlobalExplanations, getMetrics } from "../api/client";
import type { MetricsResponse } from "../api/types";
import { anatomy } from "../anatomy";
import { startGuidedTour } from "../components/PresentMode";
import { downloadText, templateCsv } from "../csv";
import { pct } from "../features";
import { legendStops, riskCss, riskWord } from "../scene/colorScale";
import { useRisk } from "../store/risk";
import { PatientHud, useLivePatient } from "./PatientHud";
import { Icon, IslandNav, TaglineReveal, useCountUp, useReveal, useSeen, type IconName } from "./parts";
import "./landing.css";

const HeroHeart = lazy(() => import("./HeroHeart"));

interface LandingPageProps {
  online: boolean | null;
  onLaunchDashboard: () => void;
}

const range = (xs: number[]) => (xs.length ? `${pct(Math.min(...xs))} to ${pct(Math.max(...xs))}` : "—");
const ARTERY_PATH = "M8 40 C 80 8, 150 64, 232 22";

function SegmentedRamp({ segments = 9 }: { segments?: number }) {
  return (
    <span className="lp-ramp" aria-hidden="true">
      {legendStops(segments).map((s) => <span key={s.offset} style={{ background: s.color }} />)}
    </span>
  );
}

/* ------------------------------------------------------------------ stats band */

function Stat({ value, decimals = 0, suffix = "", label, note, active }: { value: number | null; decimals?: number; suffix?: string; label: string; note: string; active: boolean }) {
  const n = useCountUp(value, active, 1400);
  return (
    <div className="lp-stat">
      <dt>{label}</dt>
      <dd className="lp-stat-num lp-mono">{n === null ? "—" : `${n.toFixed(decimals)}${suffix}`}</dd>
      <dd className="lp-stat-note">{note}</dd>
    </div>
  );
}

/* ------------------------------------------------------------------ two patients, both 71% */

function TwoPatients() {
  const color = riskCss(0.71);
  return (
    <figure className="lp-pair" data-reveal>
      <figcaption className="lp-pair-label">Illustration, not patient data</figcaption>
      {[
        { who: "Patient A", state: "Likely", spread: "66 to 75", sure: true },
        { who: "Patient B", state: "Uncertain", spread: "48 to 86", sure: false },
      ].map((p) => (
        <div key={p.who} className="lp-pair-row">
          <svg viewBox="0 0 240 56" aria-hidden="true">
            <path d={ARTERY_PATH} stroke={color} strokeOpacity={p.sure ? 1 : 0.4} strokeWidth={12} fill="none" strokeLinecap="round" />
            {!p.sure && <path className="lp-march" d={ARTERY_PATH} stroke="currentColor" strokeWidth={1.5} strokeDasharray="6 5" fill="none" transform="translate(0 -10)" />}
          </svg>
          <div className="lp-pair-text">
            <span className="lp-pair-who">{p.who}</span>
            <span className="lp-pair-num lp-mono">71%</span>
            <span className={`lp-pill ${p.sure ? "is-likely" : "is-uncertain"}`} style={p.sure ? { background: color } : undefined}>{p.state}</span>
            <span className="lp-pair-spread">Models range {p.spread}%</span>
          </div>
        </div>
      ))}
    </figure>
  );
}

/* ------------------------------------------------------------------ interactive reading cards */

function ProbabilityCard() {
  const [p, setP] = useState(0.62);
  return (
    <article className="lp-card lp-card-wide" data-reveal>
      <div className="lp-card-copy">
        <h3>Color is probability</h3>
        <p>Each artery takes its calibrated chance of a narrowing of 50% or more, on a color blind safe scale. The number always sits beside the color. Drag to try it.</p>
      </div>
      <div className="lp-try">
        <svg viewBox="0 0 240 56" aria-hidden="true" className="lp-try-artery">
          <path d={ARTERY_PATH} stroke={riskCss(p)} strokeWidth={14} fill="none" strokeLinecap="round" style={{ transition: "stroke 300ms" }} />
        </svg>
        <div className="lp-try-readout">
          <span className="lp-try-num lp-mono">{Math.round(p * 100)}%</span>
          <span className="lp-try-word">{riskWord(p)}</span>
        </div>
        <label className="lp-range">
          <span className="lp-sr">Probability</span>
          <input type="range" min={0} max={100} value={Math.round(p * 100)} onChange={(e) => setP(Number(e.target.value) / 100)} />
          <SegmentedRamp segments={12} />
        </label>
      </div>
    </article>
  );
}

function UncertaintyCard({ note }: { note: ReactNode }) {
  const [sure, setSure] = useState(false);
  const color = riskCss(0.58);
  return (
    <article className="lp-card" data-reveal style={{ transitionDelay: "100ms" }}>
      <div className="lp-toggle" role="group" aria-label="Model confidence">
        <button type="button" aria-pressed={sure} className={sure ? "is-on" : ""} onClick={() => setSure(true)}>Confident</button>
        <button type="button" aria-pressed={!sure} className={!sure ? "is-on" : ""} onClick={() => setSure(false)}>Uncertain</button>
      </div>
      <svg viewBox="0 0 240 56" aria-hidden="true" className="lp-try-artery">
        <path d={ARTERY_PATH} stroke={color} strokeOpacity={sure ? 1 : 0.4} strokeWidth={12} fill="none" strokeLinecap="round" style={{ transition: "stroke-opacity 500ms" }} />
        <path className="lp-march" d={ARTERY_PATH} stroke="currentColor" strokeWidth={1.5} strokeDasharray="6 5" fill="none" transform="translate(0 -10)" style={{ opacity: sure ? 0 : 1, transition: "opacity 500ms" }} />
      </svg>
      <h3>Faded and dashed means unsure</h3>
      <p>When both outcomes stay possible at 90% confidence, the artery says so instead of faking certainty.{note}</p>
    </article>
  );
}

function DriversCard({ global, labelOf }: { global: Record<string, Record<string, number>> | null; labelOf: (n: string) => string }) {
  const ids = anatomy.vessels.map((v) => v.id).filter((id) => global?.[id]);
  const [id, setId] = useState<string>("LAD");
  const rows = useMemo(() => {
    const f = global?.[id];
    if (!f) return [];
    const top = Object.entries(f).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const max = top[0]?.[1] ?? 1;
    return top.map(([name, v]) => ({ name, label: labelOf(name), w: v / max }));
  }, [global, id, labelOf]);
  return (
    <article className="lp-card" data-reveal>
      <div className="lp-toggle" role="group" aria-label="Artery">
        {(ids.length ? ids : ["LAD", "LCX", "RCA"]).map((v) => (
          <button key={v} type="button" aria-pressed={id === v} className={id === v ? "is-on" : ""} onClick={() => setId(v)} disabled={!global}>{v}</button>
        ))}
      </div>
      {rows.length ? (
        <ul className="lp-global">
          {rows.map((r) => (
            <li key={r.name}>
              <span>{r.label}</span>
              <span className="lp-global-bar" aria-hidden="true"><span style={{ width: `${r.w * 100}%` }} /></span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="lp-hud-skeleton" aria-label="Loading drivers">{Array.from({ length: 4 }, (_, i) => <span key={i} />)}</div>
      )}
      <h3>Its own reasons, per artery</h3>
      <p>Every artery has its own model and SHAP drivers. These are the strongest across all patients; each patient gets their own.</p>
    </article>
  );
}

function WhatIfCard() {
  return (
    <article className="lp-card lp-card-wide" data-reveal style={{ transitionDelay: "100ms" }}>
      <div className="lp-card-copy">
        <h3>What if, with honest limits</h3>
        <p>Move a modifiable value such as blood pressure or LDL and the arteries recolor live. A counterfactual search finds the smallest change that crosses the threshold. It shows the model&rsquo;s sensitivity, never treatment advice.</p>
      </div>
      <div className="lp-whatif" aria-hidden="true">
        {[{ k: "Systolic BP", v: 0.72 }, { k: "LDL", v: 0.55 }, { k: "Fasting glucose", v: 0.38 }].map((s) => (
          <div key={s.k} className="lp-whatif-row">
            <span>{s.k}</span>
            <span className="lp-slider-track"><span className="lp-slider-fill" style={{ width: `${s.v * 100}%` }} /><span className="lp-slider-knob" style={{ left: `${s.v * 100}%` }} /></span>
          </div>
        ))}
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ pipeline */

function Pipeline({ families }: { families: string }) {
  const [ref, seen] = useSeen<HTMLOListElement>();
  const steps: { icon: IconName; title: string; body: string }[] = [
    { icon: "plug", title: "51 routine measurements", body: "History, symptoms, vitals, labs, ECG and echo. Blanks are imputed and flagged, never hidden." },
    { icon: "gauge", title: "Leakage guard", body: "Inputs come from a whitelist. Label columns are blocked, and a test fails the build if one slips in." },
    { icon: "pulse", title: "Four calibrated models", body: `One for overall disease and one per artery, picked by nested cross validation: ${families}.` },
    { icon: "lightbulb", title: "Conformal sets and SHAP", body: "Uncertain is a real output at 90% coverage. Every estimate carries its own exact SHAP reasons." },
    { icon: "cube", title: "The 3D twin", body: "Hue shows probability. Pulse, opacity and dashes show doubt. One store keeps the heart and every panel in sync." },
  ];
  return (
    <ol ref={ref} className={`lp-pipe${seen ? " is-drawn" : ""}`}>
      {steps.map((s, i) => (
        <li key={s.title} style={{ transitionDelay: `${i * 120}ms` }}>
          <span className="lp-pipe-node"><Icon name={s.icon} size={20} /></span>
          <span className="lp-pipe-num lp-mono">0{i + 1}</span>
          <h3>{s.title}</h3>
          <p>{s.body}</p>
        </li>
      ))}
    </ol>
  );
}

/* ------------------------------------------------------------------ judging criteria */

function Criteria({ coverage, aucCad }: { coverage: string; aucCad: string }) {
  const [ref, seen] = useSeen<HTMLUListElement>();
  const rows = [
    { w: 30, k: "Predictive performance", v: `Nested 5 × 5 cross validation with 95% intervals, calibration curves, decision curves and conformal coverage of ${coverage}. ROC AUC ${aucCad} for overall disease.` },
    { w: 25, k: "3D visualization", v: "An anatomical heart built in code, arteries projected exactly onto its surface, and uncertainty you can see. 36 to 44 fps on Intel HD 620 graphics, 60 in Lite mode." },
    { w: 20, k: "Interpretability", v: "SHAP for every artery, a waterfall that adds up exactly, what if sliders, counterfactuals, similar patients and a next best test ranking." },
    { w: 15, k: "Integration", v: "Three registries drive the form, API, models and 3D scene, and a check fails the build if they drift. Upload one patient or 500." },
    { w: 10, k: "Technical implementation", v: "FastAPI scoring live on a laptop CPU, Docker, CI, browser tests and a privacy safe log that stores outputs only." },
  ];
  return (
    <ul ref={ref} className={`lp-criteria${seen ? " is-drawn" : ""}`}>
      {rows.map((r, i) => (
        <li key={r.k} data-reveal style={{ transitionDelay: `${i * 80}ms` }}>
          <span className="lp-crit-w lp-mono">{r.w}%</span>
          <span className="lp-crit-bar" aria-hidden="true"><span style={{ width: `${(r.w / 30) * 100}%`, transitionDelay: `${200 + i * 120}ms` }} /></span>
          <h3>{r.k}</h3>
          <p>{r.v}</p>
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------------ FAQ */

function Faq({ items }: { items: { id?: string; q: string; a: ReactNode }[] }) {
  return (
    <div className="lp-faq">
      {items.map((it) => (
        <details key={it.q} id={it.id} className="lp-faq-item" data-reveal>
          <summary>
            <span>{it.q}</span>
            <Icon name="plus" size={18} />
          </summary>
          <div className="lp-faq-a">{it.a}</div>
        </details>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ page */

export function LandingPage({ online, onLaunchDashboard }: LandingPageProps) {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [global, setGlobal] = useState<Record<string, Record<string, number>> | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const setTab = useRisk((s) => s.setTab);
  const spec = useRisk((s) => s.spec);
  const loadPatient = useRisk((s) => s.loadPatient);
  const storeSelected = useRisk((s) => s.selected);
  const live = useLivePatient(online);
  const [statsRef, statsSeen] = useSeen<HTMLDListElement>();

  useReveal(rootRef, metrics !== null);

  useEffect(() => {
    if (!online) return;
    getMetrics().then(setMetrics).catch(() => setMetrics(null));
    getGlobalExplanations()
      .then((g) => setGlobal(Object.fromEntries(Object.entries(g.targets).map(([k, v]) => [k, v.features]))))
      .catch(() => setGlobal(null));
  }, [online]);

  // A click on an artery in the 3D scene focuses it in the readout too.
  useEffect(() => { if (storeSelected) setFocus(storeSelected); }, [storeSelected]);
  useEffect(() => { useRisk.getState().hover(focus); }, [focus]);

  const preload = () => void import("../scene/HeartViewer");
  // Leave no landing-page selection behind in the report.
  const launch = () => {
    useRisk.getState().select(null);
    useRisk.getState().hover(null);
    onLaunchDashboard();
  };
  const watchTour = () => {
    launch();
    startGuidedTour().catch(() => { /* the dashboard shows an error banner if the tour cannot start */ });
  };
  const startNewPatient = () => {
    if (!spec) return;
    loadPatient(Object.fromEntries(spec.features.map((f) => [f.name, null])), "new-patient",
      "New patient: enter the values you have. Missing ones are imputed and flagged.");
    launch();
  };
  const openLivePatient = () => {
    const d = live.demos?.[live.key];
    if (!d?.features) return;
    loadPatient(d.features, d.patient_id, `Real patient from the dataset: ${d.description}`);
    launch();
  };
  const openTrust = () => {
    setTab("trust");
    launch();
  };

  const labelOf = useMemo(() => {
    const m = new Map(spec?.features.map((f) => [f.name, f.label]) ?? []);
    return (n: string) => m.get(n) ?? n;
  }, [spec]);

  const T = metrics?.targets;
  const cad = T?.CAD;
  const vesselTargets = T ? anatomy.vessels.map((v) => T[v.id]).filter(Boolean) : [];
  const vesselAuc = vesselTargets.map((t) => t["metrics_at_0.5"].roc_auc.mean);
  const vesselUncertain = vesselTargets.map((t) => t.conformal.uncertain_rate);
  const families = T ? [...new Set(Object.values(T).map((t) => t.family_label.toLowerCase()))].join(" and ") : "logistic regression and random forest";

  const heroResults = live.result?.vessels ?? null;

  const primaryCta = (
    <div className="lp-cta">
      <button type="button" className="lp-btn lp-btn-primary lp-btn-lg" onClick={watchTour} onMouseEnter={preload} onFocus={preload} disabled={!online}>
        <Icon name="play" size={16} /> Watch the 90 second tour
      </button>
      <button type="button" className="lp-link" onClick={startNewPatient} disabled={!spec}>
        or start with your own patient <Icon name="arrow" size={16} />
      </button>
    </div>
  );

  const faq = [
    {
      q: "Is this a diagnosis?",
      a: <p>No. It estimates the chance of a narrowing of 50% or more in each main artery from routine data. It does not replace angiography, CT or a clinician&rsquo;s judgment, and it has not been validated outside the one centre it was trained on.</p>,
    },
    {
      q: "Does the color show where the narrowing is?",
      a: <p>No. The dataset says whether each artery is narrowed, not where along it. The whole vessel takes one color, and its placement on the heart is schematic.</p>,
    },
    {
      q: "What does Uncertain mean?",
      a: <p>We use conformal prediction at 90% confidence. When both outcomes stay plausible at that level, the artery is marked Uncertain and drawn faded and dashed.{cad && <> In testing that happened for {pct(cad.conformal.uncertain_rate)} of overall estimates and {range(vesselUncertain)} of artery estimates.</>}</p>,
    },
    {
      q: "Why are the LCX and RCA estimates weaker?",
      a: <p>Routine measurements carry less signal for those two arteries{vesselAuc.length ? <> (ROC AUC as low as {Math.min(...vesselAuc).toFixed(2)})</> : null}. The app shows that as more Uncertain arteries instead of hiding it behind a confident color.</p>,
    },
    {
      q: "Is the patient on this page real?",
      a: <p>Yes. It is one of four patients from the public dataset, scored live by the trained models each time you switch. It is shown here only; the report starts empty unless you choose to open that patient.</p>,
    },
    {
      id: "faq-privacy",
      q: "What happens to the data I enter or upload?",
      a: <p>It goes only to your own CoronaryTwin API. Inputs and patient IDs are never stored or logged. The database keeps model outputs only, and an automated test checks that.</p>,
    },
    {
      q: "Do the what if sliders show what treatment would do?",
      a: <p>No. They show how the model responds when a modifiable value changes. That is the model&rsquo;s sensitivity, not cause and effect, and never advice.</p>,
    },
    {
      q: "What was it trained on?",
      a: <p>{cad ? cad.n : 303} patients from the Extension of Z Alizadeh Sani dataset (Alizadehsani, Roshanzamir and Sani, 2013, UCI, DOI 10.24432/C5461K), each with a catheter result.</p>,
    },
  ];

  return (
    <div className="lp" ref={rootRef}>
      <a className="lp-skip" href="#top">Skip to content</a>
      <IslandNav onOpenReport={launch} onPreload={preload} />

      <main id="top">
        {/* ------------------------------------------------ hero */}
        <section className="lp-hero" aria-labelledby="lp-title">
          <p className="lp-badge" data-reveal>
            <span className="lp-live" aria-hidden="true" />
            {online === false ? "API offline" : <>Models live{metrics && <> · version <span className="lp-mono">{metrics.version}</span></>}</>}
          </p>
          <h1 id="lp-title" className="lp-hero-title" data-reveal style={{ transitionDelay: "80ms" }}>
            See each artery&rsquo;s risk,<br />
            and how sure the model is
          </h1>
          <p className="lp-hero-sub" data-reveal style={{ transitionDelay: "160ms" }}>
            CoronaryTwin reads 51 routine measurements and colors the LAD, LCX and RCA on a 3D heart by their chance of a
            significant narrowing. When the model can&rsquo;t tell, the artery is drawn faded and dashed instead of confident.
          </p>
          <div data-reveal style={{ transitionDelay: "240ms" }}>{primaryCta}</div>

          <div className="lp-stage" data-reveal style={{ transitionDelay: "320ms" }}>
            <figure className="lp-stage-scene">
              <Suspense fallback={<div className="lp-stage-loading" aria-label="Loading 3D heart"><span /></div>}>
                <HeroHeart results={heroResults} focus={focus} />
              </Suspense>
              <figcaption className="lp-stage-top">
                <span className="lp-chip">Fig. 1 · real patient, scored live</span>
                <span className="lp-chip lp-chip-legend">
                  <span className="lp-mono">0%</span><SegmentedRamp /><span className="lp-mono">100%</span>
                </span>
              </figcaption>
              <span className="lp-chip lp-stage-hint">Drag to rotate · schematic placement</span>
            </figure>
            <PatientHud live={live} spec={spec} focus={focus} onFocus={setFocus} onOpen={openLivePatient} />
          </div>
        </section>

        {/* ------------------------------------------------ stats band */}
        <section aria-label="Results at a glance" className="lp-stats-wrap">
          <dl ref={statsRef} className="lp-stats">
            <Stat active={statsSeen} value={cad ? cad.n : null} label="Patients" note="each confirmed by catheter" />
            <Stat active={statsSeen} value={cad ? cad["metrics_at_0.5"].roc_auc.mean : null} decimals={2} label="ROC AUC, overall" note={cad ? `95% CI ${cad["metrics_at_0.5"].roc_auc.ci95.map((x) => x.toFixed(2)).join(" to ")}` : "nested cross validation"} />
            <Stat active={statsSeen} value={cad ? cad.conformal.coverage * 100 : null} decimals={1} suffix="%" label="Conformal coverage" note="target 90%" />
            <Stat active={statsSeen} value={live.latencyMs} suffix=" ms" label="Model time" note="server time for the patient above, measured live" />
          </dl>
        </section>

        {/* ------------------------------------------------ problem to solution */}
        <section className="lp-section lp-split" aria-labelledby="lp-problem">
          <div data-reveal>
            <h2 id="lp-problem" className="lp-h2">Two patients can both be 71%. Only one of those numbers is solid.</h2>
            <p className="lp-lede">
              Most risk tools print one number. A 71% from a model that is sure and a 71% from a model that is guessing look
              identical on screen. CoronaryTwin draws them differently, so you know which estimate to question before you lean on it.
            </p>
          </div>
          <TwoPatients />
        </section>

        {/* ------------------------------------------------ tagline */}
        <section className="lp-section lp-tagline-wrap" aria-label="Our principle">
          <TaglineReveal lines={["A number you can question", "is worth more than one", "that only sounds sure."]} />
        </section>

        {/* ------------------------------------------------ reading the heart */}
        <section id="reading" className="lp-section" aria-labelledby="lp-reading">
          <h2 id="lp-reading" className="lp-h2" data-reveal>Four things the heart tells you</h2>
          <p className="lp-lede" data-reveal>Try each one. They work the same way in the report.</p>
          <div className="lp-bento">
            <ProbabilityCard />
            <UncertaintyCard note={cad ? <> In testing: {pct(cad.conformal.uncertain_rate)} of overall estimates and {range(vesselUncertain)} of artery estimates.</> : null} />
            <DriversCard global={global} labelOf={labelOf} />
            <WhatIfCard />
          </div>
        </section>

        {/* ------------------------------------------------ pipeline */}
        <section id="inside" className="lp-section" aria-labelledby="lp-inside">
          <h2 id="lp-inside" className="lp-h2" data-reveal>From a patient record to a living heart in one request</h2>
          <p className="lp-lede" data-reveal>Five stages, each with a test that guards it.</p>
          <Pipeline families={families} />
        </section>

        {/* ------------------------------------------------ evidence */}
        <section id="evidence" className="lp-section" aria-labelledby="lp-evidence">
          <div className="lp-section-head" data-reveal>
            <div>
              <h2 id="lp-evidence" className="lp-h2">Tested on patients the model never saw</h2>
              <p className="lp-lede">
                Nested 5 × 5 cross validation. Brackets are 95% confidence intervals. Thresholds favor recall, because a missed
                narrowing costs more than a false alarm.
              </p>
            </div>
            <button type="button" className="lp-link" onClick={openTrust} disabled={!online}>
              Calibration, ROC and subgroups <Icon name="arrow" size={16} />
            </button>
          </div>
          <div className="lp-table-card" data-reveal>
            {T ? (
              <div className="lp-table-scroll">
                <table className="lp-table">
                  <thead>
                    <tr>
                      <th scope="col">Estimate</th><th scope="col">Model</th><th scope="col">ROC AUC</th>
                      <th scope="col">Recall</th><th scope="col">Precision</th><th scope="col">Coverage</th><th scope="col">Uncertain</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.values(T).map((t) => {
                      const auc = t["metrics_at_0.5"].roc_auc;
                      return (
                        <tr key={t.target}>
                          <th scope="row">{t.target}</th>
                          <td>{t.family_label}</td>
                          <td className="lp-mono">
                            <span className="lp-auc">
                              <span className="lp-auc-track" aria-hidden="true">
                                <span className="lp-auc-ci" style={{ left: `${(auc.ci95[0] - 0.5) * 200}%`, width: `${(auc.ci95[1] - auc.ci95[0]) * 200}%` }} />
                                <span className="lp-auc-dot" style={{ left: `${(auc.mean - 0.5) * 200}%` }} />
                              </span>
                              {auc.mean.toFixed(2)} <span className="lp-dim">({auc.ci95.map((x) => x.toFixed(2)).join(" to ")})</span>
                            </span>
                          </td>
                          <td className="lp-mono">{pct(t.metrics_at_threshold.recall.mean)}</td>
                          <td className="lp-mono">{pct(t.metrics_at_threshold.precision.mean)}</td>
                          <td className="lp-mono">{pct(t.conformal.coverage, 1)}</td>
                          <td className="lp-mono">{pct(t.conformal.uncertain_rate)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : online === false ? (
              <p className="lp-empty">Model results appear here once the API is running. Start it with <code>python tasks.py serve</code>.</p>
            ) : (
              <div className="lp-table-skeleton" aria-label="Loading model results">
                {Array.from({ length: 5 }, (_, i) => <span key={i} />)}
              </div>
            )}
          </div>
          <p className="lp-note" data-reveal>
            LCX and RCA are hard to predict from routine data, so they are often marked Uncertain. That is the honest result, not a display choice.
          </p>

          <h3 className="lp-h3" data-reveal>Built against the five judging criteria</h3>
          <Criteria coverage={cad ? pct(cad.conformal.coverage, 1) : "about 90%"} aucCad={cad ? cad["metrics_at_0.5"].roc_auc.mean.toFixed(2) : "0.92"} />
        </section>

        {/* ------------------------------------------------ your own patients */}
        <section id="your-data" className="lp-section" aria-labelledby="lp-data">
          <h2 id="lp-data" className="lp-h2" data-reveal>Run it on your own patients in three steps</h2>
          <ol className="lp-steps">
            <li className="lp-card" data-reveal>
              <span className="lp-step-num lp-mono">01</span>
              <h3>Get the template</h3>
              <p>A CSV with all 51 measurements and one example row. Our column names and the original dataset&rsquo;s (<code>DM</code>, <code>Y/N</code>, <code>LBBB</code>) both work.</p>
              <button type="button" className="lp-btn lp-btn-quiet" disabled={!spec} onClick={() => spec && downloadText("coronarytwin-template.csv", templateCsv(spec))}>
                <Icon name="download" size={16} /> Download template
              </button>
            </li>
            <li className="lp-card" data-reveal style={{ transitionDelay: "100ms" }}>
              <span className="lp-step-num lp-mono">02</span>
              <h3>Fill one row per patient</h3>
              <p>Leave unknown values blank. They are imputed and flagged, so a partial record still gets an honest estimate.</p>
            </li>
            <li className="lp-card" data-reveal style={{ transitionDelay: "200ms" }}>
              <span className="lp-step-num lp-mono">03</span>
              <h3>Upload it or type it in</h3>
              <p>One patient opens straight in the report. A file with several is scored together, problems are listed by row and cell, and the estimates download as CSV.</p>
              <button type="button" className="lp-btn lp-btn-quiet" disabled={!spec} onClick={startNewPatient} onMouseEnter={preload}>
                <Icon name="upload" size={16} /> Open an empty record
              </button>
            </li>
          </ol>
          <p className="lp-note" data-reveal>
            Uploaded data goes only to your own CoronaryTwin API and is not stored or logged. The <code>csv/</code> folder in the
            repository has 50 synthetic sample files to try.
          </p>
        </section>

        {/* ------------------------------------------------ FAQ */}
        <section id="faq" className="lp-section lp-faq-wrap" aria-labelledby="lp-faq">
          <h2 id="lp-faq" className="lp-h2" data-reveal>Questions worth asking first</h2>
          <Faq items={faq} />
        </section>

        {/* ------------------------------------------------ final CTA */}
        <section className="lp-section lp-final" aria-labelledby="lp-final">
          <h2 id="lp-final" className="lp-final-title" data-reveal>See it on a real patient</h2>
          <p className="lp-lede" data-reveal>
            The tour loads one patient from the dataset and walks through each artery, the reasons behind it and the what if view.
          </p>
          <div data-reveal>{primaryCta}</div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-footer-row">
          <span className="lp-wordmark">CoronaryTwin</span>
          <ul>
            <li><a href="#faq-privacy">Privacy</a></li>
            <li><a href="#faq">FAQ</a></li>
            <li><button type="button" className="lp-footer-link" onClick={openTrust} disabled={!online}>Model trust</button></li>
            <li><a href="#top">Back to top</a></li>
          </ul>
        </div>
        <p>Multimodal AI Hackathon 2026, Track A. Data: Alizadehsani, Roshanzamir and Sani (2013), UCI, DOI 10.24432/C5461K.</p>
        <p>For decision support and education only. Not a diagnosis.</p>
      </footer>
    </div>
  );
}
