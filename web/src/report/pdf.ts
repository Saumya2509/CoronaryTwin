// Export PDF (md/final.md part 3): an A4 report generated with jsPDF + autoTable, always on white.
//   Cover header  logo, title, patient, date/time, report ID, model version ("Demo data" in demo mode)
//   Summary       four estimate cards (value, state color) + a plain-language summary
//   Visuals       the 3D view (snapshot of the live canvas), estimates with sub-model ranges, top drivers,
//                 guideline comparison (vector charts, so they print sharp)
//   Data table    every measurement: value, normal range, status, source; repeating header, zebra rows
//   Findings      what is high/low, cautions, and the next step to discuss
//   Footer        disclaimer, app name, "Page X of Y" on every page
// Nothing is cut across pages: every block checks the space left first. Loaded lazily on first export.
import { jsPDF } from "jspdf";
import { autoTable } from "jspdf-autotable";
import { nextBestTest } from "../api/client";
import type { FeatureSpec, PredictResponse, RiskState, TargetResult } from "../api/types";
import { anatomy } from "../anatomy";
import { formatValue, normalRangeText, pct, rangeStatus, specMap } from "../features";
import { riskCss } from "../scene/colorScale";
import { overallKey, useRisk } from "../store/risk";

type RGB = [number, number, number];
const INK: RGB = [14, 24, 48];
const INK2: RGB = [52, 66, 94];
const MUTED: RGB = [86, 102, 131];
const LINE: RGB = [214, 222, 236];
const PANEL: RGB = [244, 246, 251];
const ACCENT: RGB = [15, 143, 130];
const BAND: RGB = [12, 16, 24];
const RAISE: RGB = [109, 79, 216];
const LOWER: RGB = [11, 121, 184];
const STATE: Record<RiskState, RGB> = { Likely: [214, 31, 69], Uncertain: [168, 101, 0], Unlikely: [25, 128, 79] };

const W = 210, H = 297, M = 15, CW = W - 2 * M;
const BOTTOM = H - 22;   // content stops above the footer

const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** The standard PDF fonts are WinAnsi only: map the few symbols the app uses that they lack. */
const safe = (s: string) => s
  .replace(/≥/g, ">=").replace(/≤/g, "<=").replace(/[−‐‑]/g, "-").replace(/→/g, "->").replace(/←/g, "<-")
  .replace(/⇄/g, "<->").replace(/≈/g, "~").replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (c) => "⁰¹²³⁴⁵⁶⁷⁸⁹".indexOf(c).toString())
  .replace(/[▶▲▼◆◇○●]/g, "").replace(/ /g, " ");

function reportId(): string {
  const a = new Uint8Array(4);
  crypto.getRandomValues(a);
  return `CT-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${[...a].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

export async function exportPdf(snapshot: string | null): Promise<void> {
  const st = useRisk.getState();
  // Exact model output only: a visit-comparison blend is not an estimate; what-if results are labeled.
  const res: PredictResponse | null = st.compare !== null ? st.base : st.result;
  if (!res || !st.spec) throw new Error("load a patient first");
  const specs = specMap(st.spec);
  const okey = overallKey(res);
  const whatIf = st.compare === null && Object.keys(st.overrides).length > 0;
  const demo = st.demo ? st.demo.sets[st.demo.active] : null;

  // Next-best-test ranking only makes sense when something is missing; never block the export on it.
  let nbt: string | null = null;
  if ((res.imputed?.length ?? 0) > 0) {
    try {
      const ctl = new AbortController();
      const timer = window.setTimeout(() => ctl.abort(), 4000);
      const r = await nextBestTest(st.inputs, ctl.signal);
      window.clearTimeout(timer);
      if (r.tests[0]) nbt = r.tests[0].label;
    } catch { /* optional */ }
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", compress: true });
  doc.setProperties({ title: `CoronaryTwin report ${st.patientId || ""}`.trim(), creator: "CoronaryTwin" });
  const id = reportId();
  const now = new Date();
  let y = 0;

  const text = (s: string, x: number, yy: number, o: { size?: number; bold?: boolean; color?: RGB; align?: "left" | "right" | "center"; maxW?: number } = {}) => {
    doc.setFont("helvetica", o.bold ? "bold" : "normal");
    doc.setFontSize(o.size ?? 9);
    doc.setTextColor(...(o.color ?? INK));
    const lines = o.maxW ? doc.splitTextToSize(safe(s), o.maxW) : safe(s);
    doc.text(lines, x, yy, { align: o.align ?? "left" });
    return Array.isArray(lines) ? lines.length : 1;
  };
  const lineH = (size: number) => size * 0.42;
  /** Wrap with the font that will draw the text, so widths are measured correctly. */
  const wrap = (s: string, size: number, maxW: number, bold = false): string[] => {
    doc.setFont("helvetica", bold ? "bold" : "normal");
    doc.setFontSize(size);
    return doc.splitTextToSize(safe(s), maxW);
  };
  const ensure = (h: number) => {
    if (y + h > BOTTOM) {
      doc.addPage();
      y = M + 4;
    }
  };
  const heading = (s: string, keepWith = 0) => {
    ensure(14 + keepWith);   // never leave a heading alone at the bottom of a page
    text(s, M, y + 4, { size: 12, bold: true });
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.4);
    doc.line(M, y + 6.2, M + CW, y + 6.2);
    y += 11;
  };

  // ---------------------------------------------------------------- cover header
  doc.setFillColor(...BAND);
  doc.rect(0, 0, W, 30, "F");
  // logo: a heart from two circles and a triangle, in the accent color
  doc.setFillColor(45, 212, 191);
  doc.circle(M + 3.2, 11.5, 3.2, "F");
  doc.circle(M + 8.8, 11.5, 3.2, "F");
  doc.triangle(M + 0.15, 12.6, M + 11.85, 12.6, M + 6, 19.5, "F");
  text("CoronaryTwin report", M + 16, 14, { size: 17, bold: true, color: [255, 255, 255] });
  text("Coronary risk estimate with uncertainty and explanations", M + 16, 20.5, { size: 9, color: [188, 198, 218] });
  text(now.toLocaleString(), W - M, 11, { size: 8.5, color: [232, 237, 247], align: "right" });
  text(`Report ID ${id}`, W - M, 16, { size: 8.5, color: [188, 198, 218], align: "right" });
  text(`Model ${res.model_version}`, W - M, 21, { size: 8.5, color: [188, 198, 218], align: "right" });
  if (demo) {
    doc.setFillColor(245, 165, 36);
    doc.roundedRect(W - M - 24, 23.5, 24, 5, 1.5, 1.5, "F");
    text("DEMO DATA", W - M - 12, 27, { size: 7.5, bold: true, color: BAND, align: "center" });
  }
  y = 37;
  text(`Patient: ${st.patientId || "patient"}`, M, y, { size: 11, bold: true });
  const sub = [
    demo ? `Demo sample: ${demo.label} (${demo.description})` : st.patientNote,
    whatIf ? "Includes what-if changes (model sensitivity, not advice)." : "",
  ].filter(Boolean).join(" ");
  if (sub) y += lineH(8.5) * (text(sub, M, y + 5, { size: 8.5, color: MUTED, maxW: CW }) - 1) + 5;
  y += 4;
  // disclaimer box, always on page 1
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.5);
  const disc = wrap(`${res.disclaimer} The 3D mapping is schematic. Explanations describe model behavior, not causes.`, 8.5, CW - 6, true);
  doc.rect(M, y, CW, disc.length * 3.6 + 4);
  text(disc.join("\n"), M + 3, y + 4.8, { size: 8.5, bold: true });
  y += disc.length * 3.6 + 9;

  // ---------------------------------------------------------------- summary
  heading("Summary");
  const targets: { key: string; name: string; r: TargetResult }[] = [
    { key: okey, name: `Overall ${okey}`, r: res.overall },
    ...anatomy.vessels.map((v) => ({ key: v.id, name: `${v.id} (${v.label})`, r: res.vessels[v.id] })),
  ];
  const cw = (CW - 9) / 4;
  targets.forEach((t, i) => {
    const x = M + i * (cw + 3);
    doc.setFillColor(...PANEL);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, y, cw, 25, 2, 2, "FD");
    doc.setFillColor(...hex(riskCss(t.r.prob)));
    doc.rect(x, y + 1, 1.4, 23, "F");
    text(t.key === okey ? `OVERALL ${okey}` : t.key, x + 4, y + 5.5, { size: 7.5, bold: true, color: MUTED });
    text(t.key === okey ? "any main artery" : anatomy.vessels.find((v) => v.id === t.key)?.label ?? "", x + 4, y + 9.3, { size: 6.8, color: MUTED });
    text(pct(t.r.prob), x + 4, y + 18, { size: 17, bold: true });
    doc.setFillColor(...STATE[t.r.state]);
    doc.roundedRect(x + cw - 21, y + 13.6, 18, 5, 1.6, 1.6, "F");
    text(t.r.state, x + cw - 12, y + 17.1, { size: 7.2, bold: true, color: [255, 255, 255], align: "center" });
    if (t.r.range) text(`sub-models ${pct(t.r.range[0])}-${pct(t.r.range[1])}`, x + 4, y + 22.6, { size: 6.8, color: MUTED });
  });
  y += 30;

  const vessels = anatomy.vessels.map((v) => ({ id: v.id, label: v.label, r: res.vessels[v.id] }));
  const top = [...vessels].sort((a, b) => b.r.prob - a.r.prob)[0];
  const uncertain = vessels.filter((v) => v.r.state === "Uncertain").map((v) => v.id);
  const esc = res.guideline?.scores.find((s) => s.id === "esc2019");
  const summary = [
    `The models estimate a ${pct(res.overall.prob)} chance of at least 50% narrowing in one or more main coronary arteries (${res.overall.state.toLowerCase()}).`,
    `The highest artery estimate is the ${top.label} (${top.id}) at ${pct(top.r.prob)}${uncertain.length ? `; ${uncertain.join(" and ")} ${uncertain.length > 1 ? "remain" : "remains"} uncertain, meaning both outcomes are still possible` : ""}.`,
    esc ? `For comparison, the ESC 2019 guideline pre-test probability from age, sex and symptoms alone is ${pct(esc.prob)}.` : "",
  ].filter(Boolean).join(" ");
  const n = text(summary, M, y + 1, { size: 9.5, color: INK2, maxW: CW });
  y += n * lineH(9.5) * 1.15 + 6;

  // ---------------------------------------------------------------- visuals
  heading("Visuals");
  const half = (CW - 6) / 2;
  // left: the 3D view
  let leftH = 0;
  if (snapshot) {
    try {
      const props = doc.getImageProperties(snapshot);
      const h = Math.min(78, (props.height / props.width) * half);
      ensure(h + 8);
      doc.addImage(snapshot, "PNG", M, y, half, h, undefined, "FAST");
      doc.setDrawColor(...LINE);
      doc.rect(M, y, half, h);
      text("3D view: arteries colored by estimate; dashed = uncertain (schematic placement).", M, y + h + 3.5, { size: 6.8, color: MUTED, maxW: half });
      leftH = h + 7;
    } catch { leftH = 0; }
  }
  // right (or full width without a snapshot): estimates with sub-model ranges and thresholds
  const bx = snapshot && leftH ? M + half + 6 : M;
  const bw = snapshot && leftH ? half : CW;
  ensure(Math.max(leftH, 52));
  let by = y;
  text("Estimates and sub-model ranges", bx, by + 2, { size: 9, bold: true });
  by += 6;
  const labelW = 16, barW = bw - labelW - 14;
  targets.forEach((t) => {
    text(t.key, bx, by + 3.4, { size: 8, bold: true });
    doc.setFillColor(...PANEL);
    doc.rect(bx + labelW, by, barW, 4.6, "F");
    doc.setFillColor(...hex(riskCss(t.r.prob)));
    doc.rect(bx + labelW, by, barW * t.r.prob, 4.6, "F");
    if (t.r.state === "Uncertain") {
      doc.setLineDashPattern([0.8, 0.6], 0);
      doc.setDrawColor(...INK2);
      doc.rect(bx + labelW, by, barW * t.r.prob, 4.6);
      doc.setLineDashPattern([], 0);
    }
    if (t.r.range) {
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.35);
      const [a, b] = t.r.range;
      doc.line(bx + labelW + barW * a, by + 6, bx + labelW + barW * b, by + 6);
    }
    if (t.r.threshold != null) {
      doc.setDrawColor(...INK);
      doc.setLineWidth(0.5);
      doc.line(bx + labelW + barW * t.r.threshold, by - 0.8, bx + labelW + barW * t.r.threshold, by + 5.4);
    }
    text(pct(t.r.prob), bx + labelW + barW + 2, by + 3.4, { size: 8 });
    by += 9;
  });
  text("Bar = estimate · line below = range of the 5 calibrated sub-models · tick = decision threshold.", bx, by + 1, { size: 6.8, color: MUTED, maxW: bw });
  by += 6;
  y = Math.max(y + leftH, by) + 4;

  // drivers (left) and guideline comparison (right)
  const exp = res.explanations[okey];
  const feats = exp ? exp.features.filter((f) => f.shap !== 0).slice(0, 8) : [];
  const gl = res.guideline;
  const blockH = Math.max(feats.length * 6 + 12, gl ? gl.scores.length * 6 + 18 : 0);
  if (feats.length || gl) {
    ensure(blockH);
    const top0 = y;
    if (feats.length) {
      text(`Top drivers of the overall estimate (${exp!.units})`, M, y + 2, { size: 9, bold: true, maxW: half });
      let fy = y + 7;
      const fmax = Math.max(...feats.map((f) => Math.abs(f.shap)));
      const mid = M + 44 + (half - 44) / 2, span = (half - 44) / 2 - 2;
      doc.setDrawColor(...LINE);
      doc.line(mid, fy - 1, mid, fy + feats.length * 6 - 1);
      feats.forEach((f) => {
        const label = specs[f.name]?.label ?? f.name;
        text(label.length > 26 ? `${label.slice(0, 25)}…` : label, M, fy + 3, { size: 7.4 });
        const w = (Math.abs(f.shap) / fmax) * span;
        doc.setFillColor(...(f.shap > 0 ? RAISE : LOWER));
        doc.rect(f.shap > 0 ? mid : mid - w, fy, w, 4, "F");
        fy += 6;
      });
      text("Right = raised the estimate · left = lowered it. Associations, not causes.", M, fy + 1.5, { size: 6.8, color: MUTED, maxW: half });
    }
    if (gl) {
      const gx = M + half + 6;
      text("Versus guideline pre-test scores", gx, top0 + 2, { size: 9, bold: true });
      let gy = top0 + 7;
      const rows = [{ label: "CoronaryTwin", prob: res.overall.prob, model: true }, ...gl.scores.map((s) => ({ label: s.short, prob: s.prob, model: false }))];
      rows.forEach((r) => {
        text(r.label, gx, gy + 3, { size: 7.4, bold: r.model });
        doc.setFillColor(...PANEL);
        doc.rect(gx + 36, gy, half - 50, 4, "F");
        doc.setFillColor(...(r.model ? ACCENT : MUTED));
        doc.rect(gx + 36, gy, (half - 50) * r.prob, 4, "F");
        text(pct(r.prob), gx + half - 12, gy + 3, { size: 7.4 });
        gy += 6;
      });
      text(`ESC 2019 band: ${gl.esc2019_band}. Published scores were derived in lower-risk populations.`, gx, gy + 1.5, { size: 6.8, color: MUTED, maxW: half });
    }
    y += blockH + 4;
  }

  // ---------------------------------------------------------------- data table
  heading("Measurements", 30);
  const body: string[][] = [];
  for (const g of st.spec.groups) {
    for (const f of st.spec.features.filter((x: FeatureSpec) => x.group === g)) {
      const v = st.inputs[f.name] ?? null;
      const status = rangeStatus(f, v);
      const source = v === null ? "imputed (missing)" : st.provenance[f.name] ? `report: ${st.provenance[f.name]}` : "entered";
      body.push([g, f.label, v === null ? "-" : formatValue(f, v), normalRangeText(f) ?? "", status && status !== "within" ? status : status ? "normal" : "", source].map(safe));
    }
  }
  autoTable(doc, {
    startY: y,
    head: [["Group", "Measurement", "Value", "Normal range", "Status", "Source"]],
    body,
    margin: { left: M, right: M, top: M + 4, bottom: H - BOTTOM },
    theme: "plain",
    showHead: "everyPage",
    rowPageBreak: "avoid",
    styles: { font: "helvetica", fontSize: 7.6, cellPadding: { top: 1.3, bottom: 1.3, left: 2, right: 2 }, textColor: INK, lineColor: LINE, lineWidth: { bottom: 0.15 } },
    headStyles: { fillColor: BAND, textColor: [255, 255, 255], fontStyle: "bold" },
    alternateRowStyles: { fillColor: PANEL },
    columnStyles: { 0: { cellWidth: 24, textColor: MUTED }, 1: { cellWidth: 48 }, 2: { cellWidth: 30 }, 3: { cellWidth: 30 }, 4: { cellWidth: 16 } },
    didParseCell: (d) => {
      if (d.section === "body" && d.column.index === 4 && (d.cell.raw === "above" || d.cell.raw === "below")) {
        d.cell.styles.textColor = STATE.Uncertain;
        d.cell.styles.fontStyle = "bold";
      }
      if (d.section === "body" && d.column.index === 5 && String(d.cell.raw).startsWith("imputed")) d.cell.styles.fontStyle = "italic";
    },
  });
  y = ((doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY ?? y) + 8;

  // ---------------------------------------------------------------- findings
  const findings: string[] = [];
  findings.push(`Overall ${okey} ${pct(res.overall.prob)} (${res.overall.state}). Highest artery: ${top.id} ${pct(top.r.prob)}.` +
    (uncertain.length ? ` Uncertain: ${uncertain.join(", ")} (the routine data cannot separate the two outcomes here).` : ""));
  const flagged = st.spec.features
    .map((f) => ({ f, v: st.inputs[f.name] ?? null, s: rangeStatus(f, st.inputs[f.name] ?? null) }))
    .filter((x) => x.s === "above" || x.s === "below");
  if (flagged.length) findings.push(`Outside the normal range: ${flagged.slice(0, 8).map((x) => `${x.f.label} ${formatValue(x.f, x.v)} (${x.s})`).join("; ")}${flagged.length > 8 ? `; +${flagged.length - 8} more` : ""}.`);
  else findings.push("All recorded measurements with a reference range are within it.");
  if (exp) {
    const ups = exp.features.filter((f) => f.shap > 0).slice(0, 3).map((f) => specs[f.name]?.label ?? f.name);
    const downs = exp.features.filter((f) => f.shap < 0).slice(0, 2).map((f) => specs[f.name]?.label ?? f.name);
    findings.push(`Strongest drivers upward: ${ups.join(", ") || "none"}${downs.length ? `; downward: ${downs.join(", ")}` : ""}.`);
  }
  if (esc) findings.push(`CoronaryTwin ${pct(res.overall.prob)} vs ESC 2019 guideline ${pct(esc.prob)} (${res.guideline!.esc2019_band}).`);
  if (res.coherence.flag) findings.push(`Caution: ${res.coherence.note}`);
  if (res.ood?.flag) findings.push(`Caution, this input is unlike the training data: ${res.ood.reasons.join(" ")}`);
  if (res.imputed?.length) findings.push(`${res.imputed.length} of ${st.spec.features.length} measurements were missing and filled with typical values.`);
  if (st.visit && st.compare === null && st.base) {
    const a = st.visit.result;
    findings.push(`Since ${st.visit.label}: overall ${pct(a.overall.prob)} -> ${pct(res.overall.prob)}; ` +
      anatomy.vessels.map((v) => `${v.id} ${pct(a.vessels[v.id]?.prob ?? 0)} -> ${pct(res.vessels[v.id].prob)}`).join(", ") + ".");
  }
  findings.push(nbt
    ? `Next step to discuss: of the missing tests, ${nbt} would change these estimates the most (a model-uncertainty ranking, not a clinical recommendation).`
    : uncertain.length
      ? "Next step to discuss: the uncertain arteries cannot be settled from routine data; whether to test further is a clinical decision."
      : "Next step to discuss: review the estimate together with the full clinical picture; it does not replace diagnostic imaging.");

  heading("Findings", 12);
  for (const f of findings) {
    const lines = wrap(f, 8.8, CW - 6);
    ensure(lines.length * 4 + 2);
    doc.setFillColor(...ACCENT);
    doc.circle(M + 1.3, y - 1.1, 0.8, "F");
    text(lines.join("\n"), M + 5, y, { size: 8.8, color: INK2 });
    y += lines.length * 4 + 2;
  }

  // ---------------------------------------------------------------- footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.3);
    doc.line(M, H - 16, W - M, H - 16);
    text(safe(res.disclaimer), M, H - 12, { size: 6.8, color: MUTED, maxW: CW });
    text(`CoronaryTwin · Generated by the CoronaryTwin dashboard · ${id}${demo ? " · Demo data" : ""}`, M, H - 7, { size: 7, color: MUTED });
    text(`Page ${p} of ${pages}`, W - M, H - 7, { size: 7, color: MUTED, align: "right" });
  }

  doc.save(`coronarytwin-${(st.patientId || "patient").replace(/[^\w-]+/g, "_")}-${now.toISOString().slice(0, 10)}.pdf`);
}
