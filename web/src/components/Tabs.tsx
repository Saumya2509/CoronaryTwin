import type { KeyboardEvent, ReactNode } from "react";
import { useRisk, type Tab } from "../store/risk";

const TABS: { id: Tab; label: string }[] = [
  { id: "explain", label: "Why this estimate" },
  { id: "whatif", label: "What-if" },
  { id: "trust", label: "Model trust" },
  { id: "patient", label: "Patient summary" },
];

/** WAI-ARIA tabs: arrow keys move between tabs, Home/End jump to the ends. */
export function Tabs({ panels }: { panels: Record<Tab, ReactNode> }) {
  const tab = useRisk((s) => s.tab);
  const setTab = useRisk((s) => s.setTab);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = i;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    else return;
    e.preventDefault();
    setTab(TABS[next].id);
    document.getElementById(`tab-${TABS[next].id}`)?.focus();
  };

  return (
    <section id="sec-analysis" className="analysis">
      <div className="tablist" role="tablist" aria-label="Analysis" onKeyDown={onKey}>
        {TABS.map((t) => (
          <button
            key={t.id}
            id={`tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
          >
            <span className="tab-num mono" aria-hidden="true">{String(TABS.indexOf(t) + 1).padStart(2, "0")}</span>
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.id} id={`panel-${t.id}`} role="tabpanel" aria-labelledby={`tab-${t.id}`} hidden={tab !== t.id} className="tabpanel">
          {tab === t.id && panels[t.id]}
        </div>
      ))}
    </section>
  );
}
