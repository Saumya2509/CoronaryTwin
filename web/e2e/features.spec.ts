// The three judge-facing additions, end to end: read reports into the record (multimodal input),
// the guideline comparison (per patient and on the dataset), and comparing two visits on the heart.
// Set SHOTS=<dir> to also save screenshots.
import { expect, test, type Page } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPORTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../samples/reports");
const files = ["lab_report.pdf", "ecg_report.png", "echo_report.png", "referral.png"].map((f) => path.join(REPORTS, f));
const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) });
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("coronarytwin.ack.v1", "1"); } catch { /* ignore */ }
  });
});

test("read reports, compare with guidelines, compare visits", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?page=dashboard#dashboard");

  // 1. Multimodal input: four reports -> proposed values with their source lines -> confirm.
  await page.locator(".pr-actions").getByRole("button", { name: "Read reports" }).click();   // the record drawer is open
  const dialog = page.locator(".report-modal");
  await dialog.locator("input[type=file]").setInputFiles(files);
  await dialog.getByRole("button", { name: /Read 4 files/ }).click();
  await expect(dialog.locator(".report-table tbody tr").first()).toBeVisible({ timeout: 90_000 });
  expect(await dialog.locator(".report-table tbody tr").count()).toBeGreaterThanOrEqual(38);
  await expect(dialog).toContainText("converted from 7.4 mmol/l");
  await shot(page, "1_report_dialog");
  await dialog.getByRole("button", { name: /^Use \d+ values$/ }).click();
  await expect(page.locator(".callout").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".tag-report").first()).toBeAttached();

  // 2. Guideline comparison: hero line, Why tab card, Model trust evidence.
  await expect(page.locator(".hero-guideline")).toContainText("ESC 2019 guideline");
  await page.keyboard.press("Escape");
  await shot(page, "2_dashboard");
  await page.locator("#tab-explain").click();
  await expect(page.locator(".guideline .gl-bars li")).toHaveCount(5);
  await page.locator(".guideline").scrollIntoViewIfNeeded();
  await shot(page, "3_guideline_patient");
  await page.locator("#tab-trust").click();
  await expect(page.locator(".guideline-evidence")).toContainText("over the ESC 2019 guideline score", { timeout: 30_000 });
  await page.locator(".guideline-evidence").scrollIntoViewIfNeeded();
  await shot(page, "4_guideline_evidence");

  // 3. Visits: save, change the record, compare on the heart.
  await page.locator(".visits").scrollIntoViewIfNeeded();
  await page.getByRole("button", { name: "Save as visit 1" }).click();
  await expect(page.locator(".visits")).toContainText("Visit 1 saved");
  const toggle = page.locator("#drawer-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  // Follow-up: a later echo with normal wall motion and EF.
  const search = page.getByPlaceholder("Search 51 measurements");
  await search.fill("Ejection");
  await page.locator("#f-ef_tte").fill("60");
  await search.fill("wall-motion");
  await page.locator("#f-region_rwma").selectOption("0");
  await page.keyboard.press("Escape");
  await expect(page.locator(".visits.is-comparing")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".visits-changes")).toContainText("Ejection fraction");
  await expect(page.locator(".visits-deltas .delta").first()).toBeVisible();
  const slider = page.locator(".visits-slider");
  await slider.fill("0");
  await expect(page.locator(".hero-caption")).toContainText("Visit 1");
  await page.locator(".visits").scrollIntoViewIfNeeded();
  await shot(page, "5_visit_before");
  await slider.fill("1");
  await expect(page.locator(".hero-caption")).toContainText("now");
  await shot(page, "6_visit_now");

  expect(errors).toEqual([]);
});
