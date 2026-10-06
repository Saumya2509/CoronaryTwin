import { useState } from "react";
import { legendStops } from "./colorScale";

const BUCKETS = ["Very low", "Low", "Moderate", "Elevated", "High", "Very high"];

/** Compact legend (md/10.md 5.7): the risk ramp, three short items, and the full text behind an info toggle. */
export function Legend() {
  const [open, setOpen] = useState(false);
  const stops = legendStops();
  return (
    <div className="legend" aria-label="Legend">
      <div className="legend-ramp">
        <svg width="100%" height="10" viewBox="0 0 100 10" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id="risk-ramp">
              {stops.map((s) => <stop key={s.offset} offset={s.offset} stopColor={s.color} />)}
            </linearGradient>
          </defs>
          <rect x="0" y="0" width="100" height="10" rx="5" fill="url(#risk-ramp)" />
        </svg>
        <div className="legend-ticks"><span>0%</span><span>50%</span><span>100%</span></div>
        <span className="sr-only">Risk scale from very low (pale yellow) to very high (rose): {BUCKETS.join(", ")}.</span>
      </div>
      <ul className="legend-items">
        <li><span className="swatch solid" aria-hidden="true" /><strong>Solid, steady pulse:</strong> the model is confident</li>
        <li><span className="swatch uncertain" aria-hidden="true" /><strong>Dashed, irregular pulse:</strong> uncertain, both outcomes possible</li>
        <li><span className="swatch glow" aria-hidden="true" /><strong>Glows and gauges:</strong> how much each measurement group contributed</li>
      </ul>
      <button type="button" className="legend-info" aria-expanded={open} onClick={() => setOpen((o) => !o)} aria-label="More about this view">
        i
      </button>
      {open && (
        <div className="legend-more">
          <p>
            Each artery's color is its own model's calibrated probability: {BUCKETS.join(" · ")}. Uncertain means the conformal prediction set at 90%
            confidence still contains both outcomes; those arteries are translucent, dashed and pulse slowly and irregularly.
          </p>
          <p>
            Glows, the ECG trace and the labs gauge show each measurement group's share of the explanation: violet raised the estimate, blue lowered it.
            The heartbeat, ambient glow and idle rotation are decorative and do not show the patient's rhythm.
          </p>
        </div>
      )}
      <p className="legend-note">Schematic: colors come from artery-level estimates, not lesion locations.</p>
    </div>
  );
}
