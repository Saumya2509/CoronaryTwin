// Sidebar (collapse, active item, phone drawer), the CSV button (ten sample patients to choose from,
// a failed file never breaks it) and the generated PDF report. SHOTS=<dir> saves screenshots.
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

// The page applies a CSS zoom (html { zoom }), so on-screen sizes are the CSS sizes times that factor.
const zoomOf = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).zoom || "1") || 1);
const widthIs = async (page: Page, css: number) => {
  const z = await zoomOf(page);
  await expect(async () => expect((await page.locator("nav.sidebar").boundingBox())!.width).toBeCloseTo(css * z, 0)).toPass();
};

const openSample = async (page: Page, n: number) => {   // n is 1-based, as shown in the dialog
  await page.locator(".masthead").getByRole("button", { name: "CSV", exact: true }).click();
  const dialog = page.locator(".samples-modal");
  await dialog.locator(".samples-list li").first().waitFor({ timeout: 30_000 });
  await dialog.getByRole("button", { name: new RegExp(`^Open sample ${n}:`) }).click();
};

test("sidebar, CSV samples and the PDF report", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?page=dashboard&drawer=0#dashboard");
  const sb = page.locator("nav.sidebar");
  await expect(sb).toBeVisible();
  await widthIs(page, 240);

  // CSV: the dialog lists ten different sample files; picking one fills the dashboard.
  await page.locator(".masthead").getByRole("button", { name: "CSV", exact: true }).click();
  await expect(page.locator(".samples-modal .samples-list li")).toHaveCount(10, { timeout: 30_000 });
  await shot(page, "f0_csv_dialog");
  await page.locator(".samples-modal").getByRole("button", { name: /^Open sample 1:/ }).click();
  await expect(page.locator(".callout").first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator(".demo-switch")).toContainText("Sample 1/10");
  await expect(page.locator(".sb-demo")).toContainText("Sample 1 of 10");
  await shot(page, "f1_demo_sidebar");
  const first = await page.locator(".kpi-overall .kpi-num").innerText();
  await openSample(page, 10);
  await expect(page.locator(".sb-demo")).toContainText("Sample 10 of 10");
  await expect(async () => expect(await page.locator(".kpi-overall .kpi-num").innerText()).not.toBe(first)).toPass({ timeout: 15_000 });

  // The sidebar's Patient record item opens the record drawer; it overlays the page and closes on an outside click.
  await sb.getByRole("button", { name: /Patient record/ }).click();
  await expect(page.locator("#patient-drawer")).toBeVisible();
  await page.locator(".drawer-backdrop").click({ position: { x: 5, y: 300 } });
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
  await widthIs(page, 72);
  await sb.getByRole("button", { name: "Model trust" }).hover();
  await shot(page, "f2_collapsed");
  await page.reload();
  await widthIs(page, 72);
  await page.locator("nav.sidebar").getByRole("button", { name: "Expand sidebar" }).click();

  // Exit returns to an empty report.
  await openSample(page, 3);
  await expect(page.locator(".demo-switch")).toBeVisible({ timeout: 30_000 });
  await page.locator(".demo-switch").getByRole("button", { name: "Exit" }).click();
  await expect(page.locator(".demo-switch")).toHaveCount(0);
  await expect(page.locator(".hero-empty")).toBeVisible();

  expect(errors).toEqual([]);
});

test("a sample file that fails to load is skipped, not fatal", async ({ page }) => {
  await page.route("**/demo-set", async (route) => {
    const res = await route.fetch();
    const body = await res.json();
    body.demo[1].csv = "age\nnot-a-number";
    body.errors.push("missing.csv: not found in csv/");
    await route.fulfill({ response: res, json: body });
  });
  await page.goto("/?page=dashboard&drawer=0#dashboard");
  await page.locator(".masthead").getByRole("button", { name: "CSV", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Skipped", { timeout: 30_000 });
  await expect(page.locator(".samples-modal .samples-list li")).toHaveCount(9);
  await page.locator(".samples-modal").getByRole("button", { name: /^Open sample 1:/ }).click();
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
