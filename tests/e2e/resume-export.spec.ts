import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SECOND = "https://drive.google.com/drive/folders/fixtureSecondRoot01";
const MAIN = "https://drive.google.com/drive/folders/fixtureHackathonRoot01";

test.describe("Resume, retry and export (RSM-02, RSM-04, TBL-04)", () => {
  test("pauses after the current team and resumes from the next one", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/batches");
    await page.getByLabel("Google Drive folder link").fill(SECOND);
    await page.getByRole("button", { name: "Start batch" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Second Event");
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("This batch is paused")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId("batch-counts")).toContainText("pending");
    await page.getByRole("button", { name: "Resume batch" }).click();
    await expect(page.getByTestId("batch-counts")).toHaveText("3 completed · 0 in progress · 0 failed · 0 pending", { timeout: 60_000 });
  });

  test("exports scores.csv and retries a failed team", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/batches");
    await page.getByLabel("Google Drive folder link").fill(MAIN);
    await page.getByRole("button", { name: "Start batch" }).click();
    await expect(page.getByTestId("batch-counts")).toHaveText(/0 in progress · \d failed · 0 pending/, { timeout: 120_000 });

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe("scores.csv");
    const csv = await readFile((await file.path())!, "utf8");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('"Team 1 Alpha","Completed"');
    expect(csv).toContain('"Team 2 Beta","Failed","No video found in folder"');

    // Beta still has no video, so the retry runs again and ends Failed again with the same reason.
    await page.getByRole("button", { name: "Retry for Team 2 Beta" }).click();
    await expect(page.getByTestId("row-teamFolderBeta0001")).toHaveAttribute("data-status", "Failed", { timeout: 30_000 });
    await expect(page.getByTestId("row-teamFolderBeta0001")).toContainText("No video found in folder");
  });

  test("retries a failed single evaluation without a new upload", async ({ page }) => {
    test.setTimeout(90_000);
    const video = await readFile(path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm"));
    await page.goto("/evaluate");
    await page.getByTestId("video-input").setInputFiles({ name: "retry-me.webm", mimeType: "video/webm", buffer: Buffer.concat([video, Buffer.from("DD-SCENARIO:unprocessable")]) });
    await expect(page.locator(".banner-title")).toHaveText("Video could not be processed (corrupted or unsupported format)", { timeout: 30_000 });
    await page.getByRole("button", { name: "Retry" }).click();
    await expect(page.locator('[aria-current="step"]')).toBeVisible();
    await expect(page.locator(".banner-title")).toHaveText("Video could not be processed (corrupted or unsupported format)", { timeout: 30_000 });
  });
});
