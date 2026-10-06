// Prints docs/documentation.html to docs/CoronaryTwin_documentation.pdf (A4) and checks the 6-page limit.
//   cd web && CHROME_PATH="C:/Program Files/Google/Chrome/Application/chrome.exe" node scripts/build_docs_pdf.mjs
// Without CHROME_PATH it uses Playwright's Chromium (npx playwright install chromium).
import { chromium } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const src = path.join(root, "docs", "documentation.html");
const out = path.join(root, "docs", "CoronaryTwin_documentation.pdf");

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
await page.goto(pathToFileURL(src).href, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.pdf({ path: out, format: "A4", printBackground: true, preferCSSPageSize: true });
await browser.close();

const pages = (readFileSync(out, "latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
console.log(`wrote ${path.relative(root, out)}: ${pages} pages`);
if (pages > 6) {
  console.error("over the 6-page limit");
  process.exit(1);
}
