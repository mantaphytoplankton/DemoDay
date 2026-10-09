import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const VIDEO = path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm");
const MAIN = "https://drive.google.com/drive/folders/fixtureHackathonRoot01";
const SECOND = "https://drive.google.com/drive/folders/fixtureSecondRoot01";

async function evaluateOnce(page: import("@playwright/test").Page) {
  await page.goto("/evaluate");
  await page.getByTestId("video-input").setInputFiles(VIDEO);
  await expect(page.getByTestId("overall-score")).toHaveText("3.92", { timeout: 30_000 });
  return (await page.getByRole("link", { name: "Open result page" }).getAttribute("href"))!;
}

test.describe("S-4 review (SNG-04, JDG-05, JDG-06)", () => {
  test("shows the video beside the scorecard, evidence, flags, and seeks to an observation", async ({ page }) => {
    test.setTimeout(90_000);
    const url = await evaluateOnce(page);
    await page.goto(url);
    const video = page.getByTestId("review-video");
    const card = page.getByRole("heading", { name: "team-alpha.webm" });
    await expect(video).toBeVisible();
    const v = (await video.boundingBox())!;
    const c = (await card.boundingBox())!;
    expect(v.x + v.width).toBeLessThanOrEqual(c.x + 1); // side by side at 1440 px
    await expect(page.getByRole("group", { name: /Evidence timeline, 3 observations/ })).toBeVisible();
    await expect(page.getByText("Impact claimed without explanation")).toBeVisible();
    await page.getByRole("button", { name: "Play from 01:00" }).first().click();
    await expect.poll(async () => Math.round(await video.evaluate((el: HTMLVideoElement) => el.currentTime))).toBe(60);
  });
});

test.describe("S-4 overrides and delete (TBL-03, RSM-07)", () => {
  test("overrides a team score with a note, shows the final score and exports it", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/batches");
    await page.getByLabel("Google Drive folder link").fill(MAIN);
    await page.getByRole("button", { name: "Start batch" }).click();
    await expect(page.getByTestId("batch-counts")).toHaveText(/0 in progress · \d failed · 0 pending/, { timeout: 120_000 });
    await page.getByRole("button", { name: "Open scorecard for Team 1 Alpha" }).click();
    const panel = page.getByRole("region", { name: "Team 1 Alpha scorecard" });
    await panel.getByRole("button", { name: "Override score for Working Solution" }).click();
    const dialog = page.getByRole("dialog", { name: "Override Working Solution" });
    await dialog.getByLabel("Your score (1 to 5)").fill("2");
    await dialog.getByRole("button", { name: "Save override" }).click();
    await expect(dialog.getByText("Add a note explaining the override")).toBeVisible();
    await dialog.getByLabel("Note explaining the override (required)").fill("Demo used hardcoded output");
    await dialog.getByRole("button", { name: "Save override" }).click();
    await expect(dialog).toBeHidden();
    await expect(panel.getByTestId("overall-score")).toHaveText("3.08");
    await page.keyboard.press("Escape");
    const row = page.getByTestId("row-teamFolderAlpha001");
    await expect(row).toContainText("3.08");
    await expect(row).toContainText("Overridden");
    await page.reload();
    await expect(page.getByTestId("row-teamFolderAlpha001")).toContainText("3.08");

    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const csv = await readFile((await (await download).path())!, "utf8");
    expect(csv.split("\r\n").find((l) => l.startsWith('"Team 1 Alpha"'))).toContain('"3.92","3.08"');
  });

  test("deletes a single evaluation after confirming", async ({ page }) => {
    test.setTimeout(90_000);
    const url = await evaluateOnce(page);
    await page.goto(url);
    await page.getByRole("button", { name: "Delete evaluation" }).click();
    const dialog = page.getByRole("dialog", { name: 'Delete "team-alpha.webm"?' });
    await expect(dialog).toContainText("This cannot be undone.");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "Delete evaluation" })).toBeFocused();
    await page.getByRole("button", { name: "Delete evaluation" }).click();
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/evaluate$/);
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Result not found" })).toBeVisible();
  });

  test("deletes a batch and can judge the folder again from scratch", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/batches");
    await page.getByLabel("Google Drive folder link").fill(SECOND);
    await page.getByRole("button", { name: "Start batch" }).click();
    await expect(page.getByTestId("batch-counts")).toHaveText("3 completed · 0 in progress · 0 failed · 0 pending", { timeout: 60_000 });
    await page.getByRole("button", { name: "Delete batch" }).click();
    const dialog = page.getByRole("dialog", { name: 'Delete "Second Event"?' });
    await expect(dialog).toContainText("3 team results");
    await expect(dialog).toContainText("Files in Google Drive are not changed.");
    await dialog.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(page).toHaveURL(/\/batches$/);
    await expect(page.getByRole("link", { name: "Second Event" })).toHaveCount(0);
    await page.getByLabel("Google Drive folder link").fill(SECOND);
    await page.getByRole("button", { name: "Start batch" }).click();
    // The new run (same folder, same batch id) starts from Pending, not from the deleted batch's results.
    await expect(page.getByTestId("batch-counts")).toHaveText(/^0 completed/, { timeout: 15_000 });
    await expect(page.getByTestId("batch-counts")).toHaveText("3 completed · 0 in progress · 0 failed · 0 pending", { timeout: 60_000 });
  });
});

test.describe("@mobile S-4 layout", () => {
  test("stacks the video above the scorecard at 390px @mobile", async ({ page }) => {
    test.setTimeout(90_000);
    const url = await evaluateOnce(page);
    await page.goto(url);
    const v = (await page.getByTestId("review-video").boundingBox())!;
    const c = (await page.getByRole("heading", { name: "team-alpha.webm" }).boundingBox())!;
    expect(v.y + v.height).toBeLessThanOrEqual(c.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
