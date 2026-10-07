import { test, expect, type Page } from "@playwright/test";

const ROOT = "https://drive.google.com/drive/folders/fixtureHackathonRoot01";

async function startBatch(page: Page, url: string) {
  await page.goto("/batches");
  await page.getByLabel("Google Drive folder link").fill(url);
  await page.getByRole("button", { name: "Start batch" }).click();
}
const row = (page: Page, id: string) => page.getByTestId(`row-${id}`);

test.describe("Batch Drive evaluation (BAT-01..05, TBL-01, TBL-02, RSM-06)", () => {
  test("rejects a link that is not a Drive folder, before contacting the server", async ({ page }) => {
    await startBatch(page, "https://example.com/videos");
    await expect(page.locator("#folder-error")).toHaveText("Enter a Google Drive folder link");
    await expect(page).toHaveURL(/\/batches$/);
  });

  test("explains a folder that is not shared", async ({ page }) => {
    await startBatch(page, "https://drive.google.com/drive/folders/privateFolder00001");
    await expect(page.locator("#folder-error")).toHaveText("DemoDay cannot read this folder. Share it as 'Anyone with the link' and try again.");
  });

  test("judges every team in order, shows failures inline and opens scorecards", async ({ page }) => {
    test.setTimeout(150_000);
    await startBatch(page, ROOT);
    await expect(page).toHaveURL(/\/batches\/[a-f0-9]{16}$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Fixture Hackathon 2026");
    const names = page.locator("tbody tr[data-status] th button.row-open");
    await expect(names).toHaveText(["Team 1 Alpha", "Team 2 Beta", "Team 3 Gamma", "Team 4 Echo", "Team 5 Foxtrot", "Team 10 Delta"]);

    // Rows fill in as teams finish; the first one completes while later teams are still pending.
    await expect(row(page, "teamFolderAlpha001")).toHaveAttribute("data-status", "Completed", { timeout: 40_000 });
    await expect(row(page, "teamFolderAlpha001")).toContainText("3.92");

    await expect(page.getByTestId("batch-counts")).toHaveText("3 completed · 0 in progress · 3 failed · 0 pending", { timeout: 120_000 });
    await expect(row(page, "teamFolderBeta0001")).toContainText("Failed");
    await expect(row(page, "teamFolderBeta0001")).toContainText("No video found in folder");
    await expect(row(page, "teamFolderEcho0001")).toContainText("Permission denied or file not shared");
    await expect(row(page, "teamFolderFoxtrot1")).toContainText("Video could not be processed (corrupted or unsupported format)");
    await expect(row(page, "teamFolderGamma001")).toContainText("2 videos found; used the most recent (v2.webm)");
    await expect(row(page, "teamFolderDelta001")).toContainText("Exceeds 3-minute maximum (3:24)");

    // Remarks expand in place.
    await page.getByRole("button", { name: "Show remarks for Team 1 Alpha" }).click();
    await expect(page.getByText("Fixture output for automated tests. This is not an AI evaluation of the uploaded video.")).toBeVisible();

    // Review panel: open, move with J/K, close with Escape back to the row.
    await page.getByRole("button", { name: "Open scorecard for Team 1 Alpha" }).click();
    const panel = page.getByRole("region", { name: "Team 1 Alpha scorecard" });
    await expect(panel.getByTestId("overall-score")).toHaveText("3.92");
    await expect(panel.locator("iframe")).toHaveAttribute("src", /drive\.google\.com\/file\/d\/videoAlpha00000001\/preview/);
    await page.keyboard.press("j");
    await expect(page.getByRole("region", { name: "Team 2 Beta scorecard" })).toContainText("No video found in folder");
    await page.keyboard.press("k");
    await expect(page.getByRole("region", { name: "Team 1 Alpha scorecard" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("region", { name: /scorecard/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open scorecard for Team 1 Alpha" })).toBeFocused();

    // Stored rows render immediately after a reload, and the batch is listed.
    await page.reload();
    await expect(row(page, "teamFolderAlpha001")).toContainText("3.92");
    await page.getByRole("link", { name: "All batches" }).click();
    await expect(page.getByRole("link", { name: "Fixture Hackathon 2026" })).toBeVisible();
    await expect(page.getByText("3 of 6 completed · 3 failed")).toBeVisible();
  });

  test("reopens the same folder without judging completed teams again", async ({ page }) => {
    await startBatch(page, `${ROOT}?usp=sharing`);
    await expect(page.getByTestId("batch-counts")).toHaveText("3 completed · 0 in progress · 3 failed · 0 pending", { timeout: 60_000 });
  });
});

test.describe("@mobile batch layout", () => {
  test("has no horizontal page overflow at 390px @mobile", async ({ page }) => {
    await page.goto("/batches");
    await page.waitForLoadState("networkidle");
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("link", { name: "Fixture Hackathon 2026" }).click();
    await expect(page.locator("tbody tr[data-status]")).toHaveCount(6);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await page.getByRole("button", { name: "Open scorecard for Team 1 Alpha" }).click();
    await expect(page.getByRole("region", { name: "Team 1 Alpha scorecard" })).toBeVisible();
    await page.keyboard.press("Escape");
  });
});
