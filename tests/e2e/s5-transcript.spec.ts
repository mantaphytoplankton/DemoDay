import { test, expect } from "@playwright/test";
import path from "node:path";
import { readFile } from "node:fs/promises";

const VIDEO = path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm");
const MAIN = "https://drive.google.com/drive/folders/fixtureHackathonRoot01";

async function evaluateOnce(page: import("@playwright/test").Page) {
  await page.goto("/evaluate");
  await page.getByTestId("video-input").setInputFiles(VIDEO);
  await expect(page.getByTestId("overall-score")).toHaveText("3.92", { timeout: 30_000 });
  return (await page.getByRole("link", { name: "Open result page" }).getAttribute("href"))!;
}

test.describe("S-5 transcript (JDG-08)", () => {
  test("shows the transcript with its coverage beside the video and seeks from a segment", async ({ page }) => {
    test.setTimeout(90_000);
    const errors: string[] = [];
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    const url = await evaluateOnce(page);
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await expect(page.getByText("Transcript covers 00:00–02:00 of 02:00")).toBeVisible();
    const list = page.getByRole("list", { name: "Transcript, 5 segments" });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list.getByRole("listitem").nth(2)).toHaveText("00:48[No speech]");
    await expect(page.getByText(/may not have processed the whole video/)).toHaveCount(0);

    await list.getByRole("button", { name: "Play from 01:24" }).click();
    const video = page.getByTestId("review-video");
    await expect.poll(async () => Math.round(await video.evaluate((el: HTMLVideoElement) => el.currentTime))).toBe(84);
    expect(errors).toEqual([]);
  });

  test("shows the same transcript in a batch team's scorecard", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/batches");
    await page.getByLabel("Google Drive folder link").fill(MAIN);
    await page.getByRole("button", { name: "Start batch" }).click();
    await expect(page.getByTestId("batch-counts")).toHaveText(/0 in progress · \d failed · 0 pending/, { timeout: 120_000 });
    await page.getByRole("button", { name: "Open scorecard for Team 1 Alpha" }).click();
    const panel = page.getByRole("region", { name: "Team 1 Alpha scorecard" });
    await expect(panel.getByRole("heading", { name: "Transcript" })).toBeVisible();
    await expect(panel.getByRole("list", { name: /^Transcript, \d+ segments$/ })).toContainText("Fixture output: spoken words, part 1.");
  });
});

test.describe("S-5 video summary (JDG-09)", () => {
  test("shows the summary above the category scores", async ({ page }) => {
    test.setTimeout(90_000);
    const url = await evaluateOnce(page);
    await page.goto(url);
    const summary = page.getByTestId("video-summary");
    await expect(summary).toContainText("Fixture output for automated tests, not a description of the uploaded video.");
    const s = (await summary.boundingBox())!;
    const c = (await page.getByRole("heading", { name: "Category scores" }).boundingBox())!;
    expect(s.y + s.height).toBeLessThanOrEqual(c.y);
  });

  test("exports the summary in scores.csv", async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto("/batches");
    await page.getByLabel("Google Drive folder link").fill(MAIN);
    await page.getByRole("button", { name: "Start batch" }).click();
    await expect(page.getByTestId("batch-counts")).toHaveText(/0 in progress · \d failed · 0 pending/, { timeout: 120_000 });
    const download = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const csv = await readFile((await (await download).path())!, "utf8");
    const lines = csv.split("\r\n");
    expect(lines[0]).toContain('"Status reason","Video summary"');
    expect(lines.find((l) => l.startsWith('"Team 1 Alpha"'))).toContain('"Fixture output for automated tests, not a description');
  });
});

test.describe("@mobile S-5 layout", () => {
  test("keeps the transcript inside the 390px viewport @mobile", async ({ page }) => {
    test.setTimeout(90_000);
    const url = await evaluateOnce(page);
    await page.goto(url);
    await expect(page.getByRole("list", { name: "Transcript, 5 segments" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
