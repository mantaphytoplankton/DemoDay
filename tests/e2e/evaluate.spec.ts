import { test, expect, type Page } from "@playwright/test";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const VIDEOS = path.join(process.cwd(), "tests/fixtures/videos");
let dir = "";
const file = (name: string) => path.join(dir, name);

test.beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "dd-e2e-videos-"));
  const alpha = await readFile(path.join(VIDEOS, "team-alpha.webm"));
  const long = await readFile(path.join(VIDEOS, "team-long.webm"));
  await writeFile(file("team-alpha.webm"), alpha);
  await writeFile(file("team-long.webm"), Buffer.concat([long, Buffer.from("DD-DURATION:204")]));
  await writeFile(file("broken-team.webm"), Buffer.concat([alpha, Buffer.from("DD-SCENARIO:unprocessable")]));
  await writeFile(file("slow-team.webm"), Buffer.concat([alpha, Buffer.from("DD-SCENARIO:slow")]));
  await writeFile(file("fake.mp4"), await readFile(path.join(VIDEOS, "fake.mp4")));
  await writeFile(file("slides.pdf"), "%PDF-1.4");
});

async function openEvaluate(page: Page) {
  await page.goto("/evaluate");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Judge the demo");
}

test.describe("Evaluate a video (SNG-01, SNG-02, SNG-03)", () => {
  test("shows banner, rubric stickers and pitch limit before upload", async ({ page }) => {
    await openEvaluate(page);
    const stickers = page.getByRole("list", { name: "Rubric categories and weights" }).getByRole("listitem");
    await expect(stickers).toHaveText(["Working Solution 25%", "Meaningful Use of AI 20%", "User Experience & Value 15%"]);
    await expect(page.getByTestId("pitch-clock")).toContainText("3:00");
    await expect(page.getByText("AI scores are decision support, not final results.")).toBeVisible();
  });

  test("rejects unsupported and non-video files with clear messages", async ({ page }) => {
    await openEvaluate(page);
    await page.getByTestId("video-input").setInputFiles(file("slides.pdf"));
    await expect(page.locator("#file-error")).toHaveText("Unsupported file type. Use MP4, MOV or WebM.");
    await page.getByTestId("video-input").setInputFiles(file("fake.mp4"));
    await expect(page.locator("#file-error")).toHaveText("File is not a readable video");
    await expect(page.getByTestId("video-input")).toHaveAttribute("aria-invalid", "true");
  });

  test("uploads, shows live steps and the weighted scorecard, which survives reload", async ({ page }) => {
    await openEvaluate(page);
    await page.getByTestId("video-input").setInputFiles(file("team-alpha.webm"));
    await expect(page.locator('[aria-current="step"]')).toContainText(/Uploading|Processing Video/);
    await expect(page.getByTestId("pitch-clock")).toContainText("2:00");

    await expect(page.getByTestId("overall-score")).toHaveText("3.92", { timeout: 30_000 });
    await expect(page.getByRole("img", { name: "Working Solution: 4 out of 5" })).toBeVisible();
    await expect(page.getByText("Fixture output for automated tests. This is not an AI evaluation")).toBeVisible();
    await expect(page.getByText("Weighted · WS 25% · AI 20% · UX 15%")).toBeVisible();
    await expect(page.locator(".flag", { hasText: "Exceeds" })).toHaveCount(0);
    await expect(page.locator("h2.panel-title[tabindex='-1']")).toBeFocused();

    await page.keyboard.press("e");
    await expect(page.locator(".cat-remarks:not([hidden])")).toHaveCount(3);
    await page.keyboard.press("e");
    await expect(page.locator(".cat-remarks:not([hidden])")).toHaveCount(0);

    await page.getByRole("link", { name: "Open result page" }).click();
    await expect(page).toHaveURL(/\/results\//);
    await page.reload();
    await expect(page.getByTestId("overall-score")).toHaveText("3.92");
    await page.getByRole("link", { name: "Back to Evaluate" }).click();
    await expect(page.getByRole("region", { name: "Recent evaluations" }).or(page.locator("#recent-title").locator(".."))).toContainText("team-alpha.webm");
  });

  test("flags a video longer than 3:00", async ({ page }) => {
    await openEvaluate(page);
    await page.getByTestId("video-input").setInputFiles(file("team-long.webm"));
    await expect(page.locator(".flag", { hasText: "Exceeds" })).toHaveText("Exceeds 3-minute maximum (3:24)", { timeout: 30_000 });
    await expect(page.getByTestId("pitch-clock")).toHaveAttribute("data-state", "over");
  });

  test("shows the failure reason and lets the judge start again", async ({ page }) => {
    await openEvaluate(page);
    await page.getByTestId("video-input").setInputFiles(file("broken-team.webm"));
    const title = page.locator(".banner-title");
    await expect(title).toHaveText("Video could not be processed (corrupted or unsupported format)", { timeout: 30_000 });
    await expect(title).toBeFocused();
    await expect(page.getByTestId("overall-score")).toHaveCount(0);
    await page.getByRole("button", { name: "Evaluate another video" }).click();
    await expect(page.getByTestId("video-input")).toBeFocused();
  });

  test("shows the 10-second tip during a slow step and never says Timeout", async ({ page }) => {
    await openEvaluate(page);
    await page.getByTestId("video-input").setInputFiles(file("slow-team.webm"));
    await expect(page.getByTestId("soft-tip")).toHaveText("More time is needed. Still processing video…", { timeout: 20_000 });
    await expect(page.locator("body")).not.toContainText(/timeout/i);
    await expect(page.getByTestId("overall-score")).toHaveText("3.92", { timeout: 30_000 });
  });

  test("opens and closes the shortcut list from the keyboard", async ({ page }) => {
    await openEvaluate(page);
    await page.keyboard.press("Shift+?");
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
  });
});

test.describe("Rubric (JDG-01)", () => {
  test("shows the default rubric, weights and tiers", async ({ page }) => {
    await page.goto("/rubric");
    await expect(page.getByText("Default rubric in use")).toBeVisible();
    const rows = page.getByRole("table").getByRole("row");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(1)).toContainText("Working Solution25%Mostly conceptCore flow worksConvincing across realistic cases");
  });
});

test.describe("Unknown result", () => {
  test("shows a not-found state with a way back", async ({ page }) => {
    await page.goto("/results/3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60");
    await expect(page.getByRole("heading", { name: "Result not found" })).toBeVisible();
  });
});

test.describe("@mobile layout", () => {
  for (const p of ["/evaluate", "/rubric"]) {
    test(`has no horizontal overflow at 390px on ${p} @mobile`, async ({ page }) => {
      await page.goto(p);
      await page.waitForLoadState("networkidle");
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    });
  }
  test("completes an evaluation at 390px @mobile", async ({ page }) => {
    await openEvaluate(page);
    await page.getByTestId("video-input").setInputFiles(file("team-alpha.webm"));
    await expect(page.getByTestId("overall-score")).toHaveText("3.92", { timeout: 30_000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});
