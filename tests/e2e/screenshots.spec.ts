import { test, expect } from "@playwright/test";
import path from "node:path";

// Visual evidence for review (not pixel assertions). Saved under test-results/screens.
const OUT = path.join(process.cwd(), "test-results/screens");
const VIDEO = path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm");

test("capture S-1 screens @screens", async ({ page }, info) => {
  const tag = info.project.name;
  await page.goto("/evaluate");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${tag}-evaluate-idle.png`, fullPage: true });
  await page.getByTestId("video-input").setInputFiles(VIDEO);
  await expect(page.locator('[aria-current="step"]')).toBeVisible();
  await page.screenshot({ path: `${OUT}/${tag}-evaluate-running.png`, fullPage: true });
  await expect(page.getByTestId("overall-score")).toHaveText("3.92", { timeout: 30_000 });
  await page.keyboard.press("e");
  await page.screenshot({ path: `${OUT}/${tag}-evaluate-scorecard.png`, fullPage: true });
  const resultUrl = await page.getByRole("link", { name: "Open result page" }).getAttribute("href");
  await page.goto(resultUrl!);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${tag}-result-review.png`, fullPage: true });
  await page.getByRole("button", { name: "Override score for Working Solution" }).click();
  await page.screenshot({ path: `${OUT}/${tag}-override-dialog.png` });
  await page.keyboard.press("Escape");
  await page.goto("/rubric");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${tag}-rubric.png`, fullPage: true });

  await page.goto("/batches");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${OUT}/${tag}-batches.png`, fullPage: true });
  const link = page.getByRole("link", { name: "Fixture Hackathon 2026" });
  if (await link.count()) {
    await link.click();
    await expect(page.locator("tbody tr[data-status]").first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/${tag}-batch-table.png`, fullPage: true });
    await page.getByRole("button", { name: "Open scorecard for Team 1 Alpha" }).click();
    await expect(page.getByTestId("overall-score").first()).toBeVisible();
    await page.screenshot({ path: `${OUT}/${tag}-batch-panel.png`, fullPage: false });
  }
});
