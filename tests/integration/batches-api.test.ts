import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetEnvCache } from "../../src/server/env.ts";
import { getApp, resetAppForTests } from "../../src/server/app-context.ts";
import { POST, GET as LIST } from "../../src/app/api/batches/route.ts";
import { GET as GET_ONE } from "../../src/app/api/batches/[id]/route.ts";
import { GET as EVENTS } from "../../src/app/api/batches/[id]/events/route.ts";
import { GET as TEAM } from "../../src/app/api/batches/[id]/teams/[teamId]/route.ts";
import { getSharedFakeGemini } from "../../src/server/testing/gemini-fake-shared.ts";
import { getSharedFakeDrive } from "../../src/server/testing/drive-fake-shared.ts";
import { fixtureVideo } from "../../src/server/testing/drive-fake.ts";

const ROOT = "https://drive.google.com/drive/folders/fixtureHackathonRoot01";
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "dd-batch-"));
  Object.assign(process.env, { NODE_ENV: "test", JUDGE_UPSTREAM: "fixture", DATA_DIR: dataDir, MAX_UPLOAD_MB: "10", JUDGE_POLL_MS: "5" });
  resetEnvCache();
  await resetAppForTests();
  const g = globalThis as { __demodayFakeGemini?: unknown; __demodayFakeDrive?: unknown };
  g.__demodayFakeGemini = undefined;
  g.__demodayFakeDrive = undefined;
});
afterEach(async () => {
  await resetAppForTests();
});

const start = (folderUrl: string, origin = "http://127.0.0.1:3000") =>
  POST(new Request("http://127.0.0.1:3000/api/batches", { method: "POST", headers: { host: "127.0.0.1:3000", origin, "content-type": "application/json" }, body: JSON.stringify({ folderUrl }) }));
const params = <T extends object>(p: T) => ({ params: Promise.resolve(p) });
const getBatch = async (id: string) => (await (await GET_ONE(new Request("http://x"), params({ id }))).json()) as any;

describe("POST /api/batches (BAT-01, BAT-02)", () => {
  it("should_create_a_batch_with_teams_in_natural_order_all_pending", async () => {
    const res = await start(ROOT);
    expect(res.status).toBe(202);
    const { batchId, reopened } = (await res.json()) as { batchId: string; reopened: boolean };
    expect(reopened).toBe(false);
    const b = await getBatch(batchId);
    expect(b.folderName).toBe("Fixture Hackathon 2026");
    expect(b.teams.map((t: any) => t.teamName)).toEqual(["Team 1 Alpha", "Team 2 Beta", "Team 3 Gamma", "Team 4 Echo", "Team 5 Foxtrot", "Team 10 Delta"]);
    await getApp().batchLane.idle();
  });

  it.each([
    ["https://example.com/videos", 400, "Enter a Google Drive folder link"],
    ["https://drive.google.com/drive/folders/privateFolder00001", 403, "DemoDay cannot read this folder. Share it as 'Anyone with the link' and try again."],
    ["https://drive.google.com/drive/folders/fixtureEmptyRoot01", 422, "No team folders found in this folder"],
    ["https://drive.google.com/drive/folders/notAFolderFile0001", 400, "Enter a Google Drive folder link"],
  ])("should_reject_%s", async (url, status, message) => {
    const res = await start(url);
    expect(res.status).toBe(status);
    expect(((await res.json()) as any).error.message).toBe(message);
    expect(await getApp().batches.list()).toEqual([]);
  });

  it("should_refuse_cross_origin_requests", async () => {
    expect((await start(ROOT, "https://evil.example")).status).toBe(403);
  });
});

describe("batch run (BAT-03, BAT-04, BAT-05, RSM-06)", () => {
  it("should_judge_teams_one_at_a_time_and_isolate_failures", async () => {
    const { batchId } = (await (await start(ROOT)).json()) as { batchId: string };
    await getApp().batchLane.idle();
    const b = await getBatch(batchId);
    const row = (name: string) => b.teams.find((t: any) => t.teamName === name);

    expect(b.status).toBe("Completed");
    expect(row("Team 1 Alpha")).toMatchObject({ status: "Completed", summary: { overallScore: 3.92 } });
    expect(row("Team 2 Beta")).toMatchObject({ status: "Failed", error: { code: "NO_VIDEO_IN_FOLDER", message: "No video found in folder", step: "Downloading" } });
    expect(row("Team 3 Gamma")).toMatchObject({ status: "Completed", video: { name: "v2.webm" }, warnings: [{ code: "multipleVideos", count: 2, chosen: "v2.webm" }] });
    expect(row("Team 4 Echo")).toMatchObject({ status: "Failed", error: { code: "DRIVE_PERMISSION_DENIED", message: "Permission denied or file not shared" } });
    expect(row("Team 5 Foxtrot")).toMatchObject({ status: "Failed", error: { code: "VIDEO_UNPROCESSABLE", step: "Processing Video" } });
    expect(row("Team 10 Delta")).toMatchObject({ status: "Completed", video: { fileId: "videoDeltaReal001" }, summary: { exceedsMaxDuration: true } });
    expect(b.teams.every((t: any) => t.geminiFileName === undefined)).toBe(true);

    // Alpha's first listing hit a rate limit and was retried (RSM-06).
    const alphaListings = getSharedFakeDrive().requests.filter((r) => r.q?.startsWith("'teamFolderAlpha001'"));
    expect(alphaListings).toHaveLength(2);
    // One video at a time: no remote files left, temp folder empty.
    expect(getSharedFakeGemini().files.size).toBe(0);
    expect(await readdir(path.join(dataDir, "tmp"))).toEqual([]);
  });

  it("should_store_the_full_scorecard_per_completed_team", async () => {
    const { batchId } = (await (await start(ROOT)).json()) as { batchId: string };
    await getApp().batchLane.idle();
    const d = (await (await TEAM(new Request("http://x"), params({ id: batchId, teamId: "teamFolderAlpha001" }))).json()) as any;
    expect(d.teamName).toBe("Team 1 Alpha");
    expect(Object.keys(d.result.categories)).toEqual(["working_solution", "meaningful_ai", "ux_value"]);
    expect((await TEAM(new Request("http://x"), params({ id: batchId, teamId: "teamFolderBeta0001" }))).status).toBe(404);
  });

  it("should_reopen_the_same_folder_without_rejudging_completed_teams", async () => {
    const { batchId } = (await (await start(ROOT)).json()) as { batchId: string };
    await getApp().batchLane.idle();
    const uploadsBefore = getSharedFakeGemini().requests.filter((r) => r.path === "/upload/v1beta/files").length;
    const res = await start(`${ROOT}?usp=sharing`);
    expect(((await res.json()) as any)).toEqual({ batchId, reopened: true });
    await getApp().batchLane.idle();
    expect(getSharedFakeGemini().requests.filter((r) => r.path === "/upload/v1beta/files").length).toBe(uploadsBefore);
    expect((await LIST()).status).toBe(200);
  });

  it("should_stream_a_snapshot_then_row_updates_until_completed", async () => {
    const { batchId } = (await (await start(ROOT)).json()) as { batchId: string };
    const text = await (await EVENTS(new Request("http://x"), params({ id: batchId }))).text();
    const events = [...text.matchAll(/^event: (\w+)$/gm)].map((m) => m[1]);
    expect(events[0]).toBe("snapshot");
    expect(events).toContain("row");
    expect(events.at(-1)).toBe("status");
    expect(text).toContain('"status":"Completed"');
  });
});

describe("reopening retries temporary failures (BAT-01)", () => {
  it("should_requeue_teams_that_failed_for_temporary_reasons_only", async () => {
    const drive = getSharedFakeDrive();
    drive.nodes.set("teamFolderBusy0001", { id: "teamFolderBusy0001", name: "Team 6 Busy", mimeType: "application/vnd.google-apps.folder", parent: "fixtureHackathonRoot01" });
    drive.nodes.set("videoBusy00000001", { id: "videoBusy00000001", name: "busy.webm", mimeType: "video/webm", parent: "teamFolderBusy0001", modifiedTime: "2026-10-02T10:00:00Z", content: fixtureVideo("DD-SCENARIO:unavailable") });
    const { batchId } = (await (await start(ROOT)).json()) as { batchId: string };
    await getApp().batchLane.idle();
    let b = await getBatch(batchId);
    const busy = () => b.teams.find((t: any) => t.subfolderId === "teamFolderBusy0001");
    expect(busy()).toMatchObject({ status: "Failed", error: { code: "AI_UNAVAILABLE" } });

    // The overload has cleared: the same video now scores normally.
    drive.nodes.get("videoBusy00000001")!.content = fixtureVideo();
    const res = await start(ROOT);
    expect(((await res.json()) as any).reopened).toBe(true);
    await getApp().batchLane.idle();
    b = await getBatch(batchId);
    expect(busy()).toMatchObject({ status: "Completed", attempts: 2, summary: { overallScore: 3.92 } });
    expect(busy().error).toBeUndefined();
    // Lasting failures stay failed and are not retried.
    expect(b.teams.find((t: any) => t.teamName === "Team 2 Beta")).toMatchObject({ status: "Failed", attempts: 1, error: { code: "NO_VIDEO_IN_FOLDER" } });
    expect(b.teams.find((t: any) => t.teamName === "Team 4 Echo")).toMatchObject({ status: "Failed", attempts: 1 });
    expect(b.teams.find((t: any) => t.teamName === "Team 5 Foxtrot")).toMatchObject({ status: "Failed", attempts: 1, error: { code: "VIDEO_UNPROCESSABLE" } });
    expect(b.status).toBe("Completed");
  });
});

describe("transcript in a batch (JDG-08)", () => {
  it("should_store_the_transcript_in_the_team_detail_and_flag_an_early_end_in_the_row", async () => {
    const drive = getSharedFakeDrive();
    drive.nodes.set("teamFolderEarly001", { id: "teamFolderEarly001", name: "Team 7 Early", mimeType: "application/vnd.google-apps.folder", parent: "fixtureHackathonRoot01" });
    drive.nodes.set("videoEarly0000001", { id: "videoEarly0000001", name: "early.webm", mimeType: "video/webm", parent: "teamFolderEarly001", modifiedTime: "2026-10-02T10:00:00Z", content: fixtureVideo("DD-SCENARIO:transcript-early DD-DURATION:165") });
    const { batchId } = (await (await start(ROOT)).json()) as { batchId: string };
    await getApp().batchLane.idle();
    const b = await getBatch(batchId);
    const early = b.teams.find((t: any) => t.subfolderId === "teamFolderEarly001");
    expect(early).toMatchObject({ status: "Completed", summary: { transcriptEarlyEnd: 82 } });
    expect(b.teams.find((t: any) => t.subfolderId === "teamFolderAlpha001").summary.transcriptEarlyEnd).toBeUndefined();

    const detail = (await (await TEAM(new Request("http://x"), params({ id: batchId, teamId: "teamFolderAlpha001" }))).json()) as any;
    expect(detail.result.transcript).toHaveLength(5);
    expect(detail.result.transcript[0].text).toBe("Fixture output: spoken words, part 1.");
  });

  it("should_keep_the_video_summary_in_the_team_row_for_the_export (JDG-09)", async () => {
    const { batchId } = (await (await start(ROOT)).json()) as { batchId: string };
    await getApp().batchLane.idle();
    const b = await getBatch(batchId);
    const alpha = b.teams.find((t: any) => t.subfolderId === "teamFolderAlpha001");
    expect(alpha.summary.videoSummary).toMatch(/^Fixture output for automated tests/);
    expect(b.teams.find((t: any) => t.teamName === "Team 2 Beta").summary).toBeUndefined();
  });
});

describe("recovery", () => {
  it("should_mark_a_running_batch_interrupted_and_reset_in_flight_rows", async () => {
    const { batchId } = (await (await start(ROOT)).json()) as { batchId: string };
    const app = getApp();
    await app.batches.stepRow(batchId, "teamFolderAlpha001", "Downloading");
    app.batchLane.abortAll();
    await app.batchLane.idle();
    await app.batches.update(batchId, (b) => ({ ...b, status: "Running", teams: b.teams.map((t) => (t.subfolderId === "teamFolderGamma001" ? { ...t, status: "Scoring", geminiFileName: "files/orphan" } : t)) }));
    await resetAppForTests();
    const b2 = await getBatch(batchId);
    expect(b2.status).toBe("Interrupted");
    expect(b2.teams.find((t: any) => t.subfolderId === "teamFolderGamma001").status).toBe("Pending");
  });
});
