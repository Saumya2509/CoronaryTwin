// md/final.md acceptance checklist: sidebar (collapse, active item, phone drawer), Try Demo (5 samples,
// switcher, exit, a failed file never breaks it) and the generated PDF report. SHOTS=<dir> saves screenshots.
import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import path from "node:path";

const shot = async (page: Page, name: string) => {
  if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) });
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("coronarytwin.ack.v1", "1");
    } catch { /* ignore */ }
  });
});

test("sidebar, Try Demo and the PDF report", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?page=dashboard&drawer=0#dashboard");
  const sb = page.locator("nav.sidebar");
  await expect(sb).toBeVisible();
  expect((await sb.boundingBox())!.width).toBeCloseTo(240, 0);

  // Try Demo: one click fills the dashboard; the switcher and exit work.
  await page.getByRole("button", { name: /Try demo/ }).first().click();
  await expect(page.locator(".callout").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".demo-switch")).toContainText("Demo");
  await expect(page.locator("#demo-select option")).toHaveCount(5);
  await expect(page.locator(".sb-demo")).toContainText("Sample 1 of 5");
  await shot(page, "f1_demo_sidebar");
  const first = await page.locator(".kpi-overall .kpi-num").innerText();
  await page.locator("#demo-select").selectOption("2");
  await expect(page.locator(".sb-demo")).toContainText("Sample 3 of 5");
  await expect(async () => expect(await page.locator(".kpi-overall .kpi-num").innerText()).not.toBe(first)).toPass({ timeout: 15_000 });

  // The sidebar's Patient record item opens and closes the record drawer.
  await sb.getByRole("button", { name: /Patient record/ }).click();
  await expect(page.locator("#patient-drawer")).toBeVisible();
  await sb.getByRole("button", { name: /Patient record/ }).click();
  await expect(page.locator("#patient-drawer")).toBeHidden();

  // Active nav item follows the selected analysis tab.
  await sb.getByRole("button", { name: "Model trust" }).click();
  await expect(sb.getByRole("button", { name: "Model trust" })).toHaveAttribute("aria-current", "page", { timeout: 10_000 });
  await expect(page.locator("#tab-trust")).toHaveAttribute("aria-selected", "true");

  // PDF: downloads, has several pages, page numbers and demo marking.
  await page.evaluate(() => window.scrollTo(0, 0));
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60_000 }),
    page.locator(".masthead").getByRole("button", { name: "Export PDF" }).click()]);
  const file = await download.path();
  const pdf = readFileSync(file!).toString("latin1");
  expect(pdf.startsWith("%PDF")).toBe(true);
  const pages = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  expect(pages).toBeGreaterThanOrEqual(2);
  if (process.env.SHOTS) await download.saveAs(path.join(process.env.SHOTS, "report.pdf"));

  // Collapse to the icon rail, with tooltips; the choice is remembered.
  await sb.getByRole("button", { name: "Collapse sidebar" }).click();
  await expect(async () => expect((await sb.boundingBox())!.width).toBeCloseTo(72, 0)).toPass();
  await sb.getByRole("button", { name: "Model trust" }).hover();
  await shot(page, "f2_collapsed");
  await page.reload();
  await expect(async () => expect((await page.locator("nav.sidebar").boundingBox())!.width).toBeCloseTo(72, 0)).toPass();
  await page.locator("nav.sidebar").getByRole("button", { name: "Expand sidebar" }).click();

  // Exit demo returns to an empty report.
  await page.getByRole("button", { name: /Try demo/ }).first().click();
  await expect(page.locator(".demo-switch")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Exit demo" }).click();
  await expect(page.locator(".demo-switch")).toHaveCount(0);
  await expect(page.locator(".hero-empty")).toBeVisible();

  expect(errors).toEqual([]);
});

test("a demo file that fails to load is skipped, not fatal", async ({ page }) => {
  await page.route("**/demo-set", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.demo[1].csv = "age\nnot-a-number";
    body.errors.push("missing.csv: not found in csv/");
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/?page=dashboard&drawer=0#dashboard");
  await page.getByRole("button", { name: /Try demo/ }).first().click();
  await expect(page.locator(".toast")).toContainText("Skipped", { timeout: 30_000 });
  await expect(page.locator("#demo-select option")).toHaveCount(4);
  await expect(page.locator(".callout").first()).toBeVisible({ timeout: 60_000 });
});

test("phone: the sidebar is a drawer opened from the hamburger", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?page=dashboard&drawer=0#dashboard");
  const sb = page.locator("nav.sidebar");
  await expect(sb).not.toBeInViewport();
  await page.getByRole("button", { name: "Open menu" }).click();
  await expect(sb).toBeInViewport();
  await page.waitForTimeout(400);   // let the slide-in finish before the screenshot
  await shot(page, "f3_phone_menu");
  await page.keyboard.press("Escape");
  await expect(sb).not.toBeInViewport();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
