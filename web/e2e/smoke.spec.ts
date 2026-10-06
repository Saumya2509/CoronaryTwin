// The judge path, end to end: upload a patient, see every surface agree, explain, present.
import { expect, test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSV = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../csv/04_typical_angina_smoker.csv");

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try { localStorage.setItem("coronarytwin.ack.v1", "1"); } catch { /* ignore */ }
  });
});

test("upload a patient: KPI tiles, callouts, hero and tabs agree", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/?page=dashboard#dashboard");
  await expect(page.getByRole("note").filter({ hasText: "Not a diagnosis" })).toBeVisible(); // safety banner

  await page.setInputFiles("input[type=file]", CSV);
  await expect(page.locator(".callout").first()).toBeVisible({ timeout: 60_000 });

  // The overall number in the hero equals the overall KPI tile (both count up, so wait until settled).
  await expect(async () => {
    const hero = (await page.locator(".hero-number").innerText()).replace(/\D/g, "");
    const tile = (await page.locator(".kpi-overall .kpi-num").innerText()).replace(/\D/g, "");
    expect(hero).toBe(tile);
  }).toPass({ timeout: 5_000 });
  await expect(page.locator(".callout")).toHaveCount(3);

  // Selecting an artery from its KPI tile opens the detail panel.
  await page.locator("button.kpi").first().click();
  await expect(page.locator(".detail")).toBeVisible();
  await page.locator(".detail .icon-btn").click();

  // Why: waterfall adds up; Model trust: results at a glance.
  await page.locator("#tab-explain").click();
  await expect(page.locator(".waterfall")).toBeVisible();
  await page.locator("#tab-trust").click();
  await expect(page.locator(".glance")).toBeVisible({ timeout: 30_000 });

  expect(errors).toEqual([]);
});

test("guided tour starts Present mode with data-driven captions", async ({ page }) => {
  await page.goto("/?page=dashboard&drawer=0#dashboard");
  await page.getByRole("button", { name: "Guided tour" }).click();
  const caption = page.locator(".present-caption");
  await expect(caption).toContainText("Overall estimate", { timeout: 60_000 });
  await expect(caption).toContainText("%");
  await page.keyboard.press("ArrowRight");
  await expect(caption).toContainText("(LAD)");
  await page.keyboard.press("Escape");
  await expect(page.locator(".present")).toHaveCount(0);
});

test("keyboard: Escape closes the detail panel and drawer, and focus comes back", async ({ page }) => {
  await page.goto("/?page=dashboard#dashboard");
  await page.setInputFiles("input[type=file]", CSV);
  await expect(page.locator(".callout").first()).toBeVisible({ timeout: 60_000 });

  const tile = page.locator("button.kpi").first();
  await tile.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".detail")).toBeVisible();
  await page.locator(".detail .icon-btn").focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".detail")).toHaveCount(0);
  await expect(tile).toBeFocused();

  const toggle = page.locator("#drawer-toggle");
  if (await page.locator(".drawer.is-open").count()) {
    await page.locator(".drawer-close").click();
    await expect(toggle).toBeFocused();
  }
  await toggle.click();
  await expect(page.locator(".drawer-close")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.locator(".drawer.is-open")).toHaveCount(0);
  await expect(toggle).toBeFocused();
});
