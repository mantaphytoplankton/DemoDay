import { test, expect, type Page } from "@playwright/test";
import path from "node:path";

// A judge's browser in another time zone and locale than the server must not break hydration.
test.use({ timezoneId: "America/Los_Angeles", locale: "en-GB" });

const VIDEO = path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm");

function trackHydration(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => /hydrat/i.test(e.message) && errors.push(e.message.slice(0, 200)));
  page.on("console", (m) => m.type() === "error" && /hydrat|didn't match/i.test(m.text()) && errors.push(m.text().slice(0, 200)));
  return errors;
}

test("pages with timestamps hydrate without mismatch in another time zone", async ({ page }) => {
  test.setTimeout(90_000);
  const errors = trackHydration(page);
  await page.goto("/evaluate");
  await page.getByTestId("video-input").setInputFiles(VIDEO);
  await expect(page.getByTestId("overall-score")).toHaveText("3.92", { timeout: 30_000 });
  const resultUrl = await page.getByRole("link", { name: "Open result page" }).getAttribute("href");

  for (const url of ["/evaluate", resultUrl!, "/batches"]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
  }
  // Local time is shown after hydration (Los Angeles is UTC-7/-8, so it differs from the UTC fallback).
  await page.goto(resultUrl!);
  await expect(page.locator("time").first()).not.toContainText("UTC");
  expect(errors).toEqual([]);
});

test("the shortcuts-off preference does not break hydration @mobile", async ({ page }) => {
  const errors = trackHydration(page);
  await page.goto("/evaluate");
  await page.evaluate(() => localStorage.setItem("dd.shortcutsOff", "1"));
  await page.reload();
  await page.waitForLoadState("networkidle");
  expect(errors).toEqual([]);
});
