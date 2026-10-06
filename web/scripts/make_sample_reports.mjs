// Writes synthetic clinical reports to samples/reports/ for the report-upload feature (feature 2):
// a lab report as a PDF (text layer), and ECG / echo / referral reports as PNG images (read by OCR).
// The patient is invented. Units are deliberately mixed (mmol/L, µmol/L, g/L) to exercise conversion.
//   cd web && node scripts/make_sample_reports.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const out = path.join(root, "samples", "reports");
mkdirSync(out, { recursive: true });

const css = `
  body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; background: #fff; }
  .sheet { width: 760px; padding: 36px 44px; }
  h1 { font-size: 22px; margin: 0 0 2px; } .sub { color: #444; font-size: 13px; margin-bottom: 18px; }
  .banner { font-size: 12px; color: #a00; border: 1px solid #a00; padding: 4px 8px; display: inline-block; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; font-size: 15px; margin: 8px 0 18px; }
  th, td { text-align: left; padding: 6px 10px; border-bottom: 1px solid #ccc; } th { background: #eee; }
  h2 { font-size: 16px; margin: 18px 0 6px; border-bottom: 2px solid #333; padding-bottom: 3px; }
  p, li { font-size: 15px; line-height: 1.5; margin: 4px 0; }
`;
const page = (title, sub, body) => `<!doctype html><meta charset="utf-8"><style>${css}</style>
  <div class="sheet"><div class="banner">SYNTHETIC SAMPLE: invented patient for software testing</div>
  <h1>${title}</h1><div class="sub">${sub}</div>${body}</div>`;
const header = "Patient: SAMPLE, Test · ID: DEMO-0042 · Collected: 2026-09-14";

const lab = page("City Hospital Laboratory: Clinical Chemistry", header, `
  <h2>Biochemistry</h2>
  <table><tr><th>Test</th><th>Result</th><th>Units</th><th>Reference</th></tr>
    <tr><td>Fasting glucose</td><td>7.4</td><td>mmol/L</td><td>3.9 - 5.5</td></tr>
    <tr><td>Creatinine</td><td>97</td><td>µmol/L</td><td>53 - 106</td></tr>
    <tr><td>Urea nitrogen (BUN)</td><td>18</td><td>mg/dL</td><td>7 - 20</td></tr>
    <tr><td>Sodium</td><td>139</td><td>mmol/L</td><td>135 - 145</td></tr>
    <tr><td>Potassium</td><td>4.3</td><td>mmol/L</td><td>3.5 - 5.0</td></tr></table>
  <h2>Lipid profile</h2>
  <table><tr><th>Test</th><th>Result</th><th>Units</th><th>Reference</th></tr>
    <tr><td>Triglycerides</td><td>2.6</td><td>mmol/L</td><td>&lt; 1.7</td></tr>
    <tr><td>LDL cholesterol</td><td>3.9</td><td>mmol/L</td><td>&lt; 2.6</td></tr>
    <tr><td>HDL cholesterol</td><td>0.9</td><td>mmol/L</td><td>&gt; 1.0</td></tr></table>
  <h2>Haematology</h2>
  <table><tr><th>Test</th><th>Result</th><th>Units</th><th>Reference</th></tr>
    <tr><td>Haemoglobin</td><td>138</td><td>g/L</td><td>130 - 175</td></tr>
    <tr><td>White blood cells</td><td>7.8</td><td>x10^9/L</td><td>4.0 - 11.0</td></tr>
    <tr><td>Neutrophils</td><td>62</td><td>%</td><td>40 - 70</td></tr>
    <tr><td>Lymphocytes</td><td>29</td><td>%</td><td>20 - 40</td></tr>
    <tr><td>Platelets</td><td>245</td><td>x10^9/L</td><td>150 - 450</td></tr>
    <tr><td>ESR</td><td>22</td><td>mm/h</td><td>0 - 20</td></tr></table>`);

const ecg = page("12-lead ECG report", header, `
  <h2>Measurements</h2><p>Heart rate: 84 bpm · PR 168 ms · QRS 92 ms · QTc 421 ms</p>
  <h2>Interpretation</h2>
  <ul><li>Sinus rhythm.</li>
    <li>ST depression of 1 mm in leads V4-V6.</li>
    <li>T wave inversion in leads III and aVF.</li>
    <li>No pathological Q waves. No ST elevation.</li>
    <li>No left ventricular hypertrophy. No bundle branch block.</li>
    <li>Normal R wave progression.</li></ul>
  <p>Reported by: Cardiology (sample)</p>`);

const echo = page("Transthoracic echocardiogram", header, `
  <h2>Findings</h2>
  <ul><li>Left ventricle normal in size. LVEF 45% (biplane).</li>
    <li>Regional wall motion abnormality: hypokinesia of the inferior and inferolateral walls (2 regions).</li>
    <li>Mild mitral regurgitation. Aortic valve normal.</li>
    <li>No pericardial effusion.</li></ul>`);

const referral = page("Cardiology referral", header, `
  <h2>Patient</h2>
  <p>Age: 61 years &nbsp;&nbsp; Sex: Male &nbsp;&nbsp; BMI: 28.4 kg/m2</p>
  <p>Blood pressure: 148/92 mmHg &nbsp;&nbsp; Pulse: 84 bpm</p>
  <h2>History</h2>
  <p>Hypertension: Yes &nbsp;&nbsp; Diabetes: Yes &nbsp;&nbsp; Dyslipidaemia: Yes</p>
  <p>Current smoker: No &nbsp;&nbsp; Ex-smoker: Yes &nbsp;&nbsp; Family history of CAD: No</p>
  <h2>Presenting complaint</h2>
  <p>Typical angina on exertion for 3 months, relieved by rest. No dyspnoea. No oedema.</p>`);

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const p = await browser.newPage({ viewport: { width: 848, height: 600 }, deviceScaleFactor: 1.5 });
await p.setContent(lab);
await p.pdf({ path: path.join(out, "lab_report.pdf"), format: "A4", printBackground: true });
for (const [name, html] of [["ecg_report.png", ecg], ["echo_report.png", echo], ["referral.png", referral]]) {
  await p.setContent(html);
  await p.locator(".sheet").screenshot({ path: path.join(out, name) });
}
await browser.close();
console.log(`wrote 4 sample reports to ${path.relative(root, out)}`);
