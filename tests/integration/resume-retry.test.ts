import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetEnvCache } from "../../src/server/env.ts";
import { getApp, resetAppForTests } from "../../src/server/app-context.ts";
import { POST as START } from "../../src/app/api/batches/route.ts";
import { GET as GET_BATCH } from "../../src/app/api/batches/[id]/route.ts";
import { POST as PAUSE } from "../../src/app/api/batches/[id]/pause/route.ts";
import { POST as RESUME } from "../../src/app/api/batches/[id]/resume/route.ts";
import { POST as RESCAN } from "../../src/app/api/batches/[id]/rescan/route.ts";
import { POST as RETRY_TEAM } from "../../src/app/api/batches/[id]/teams/[teamId]/retry/route.ts";
import { GET as EXPORT } from "../../src/app/api/batches/[id]/export.csv/route.ts";
import { POST as UPLOAD } from "../../src/app/api/evaluations/route.ts";
import { GET as GET_EVAL } from "../../src/app/api/evaluations/[id]/route.ts";
import { POST as RETRY_EVAL } from "../../src/app/api/evaluations/[id]/retry/route.ts";
import { getSharedFakeGemini } from "../../src/server/testing/gemini-fake-shared.ts";
import { getSharedFakeDrive } from "../../src/server/testing/drive-fake-shared.ts";
import { fixtureVideo } from "../../src/server/testing/drive-fake.ts";

const ROOT = "https://drive.google.com/drive/folders/fixtureHackathonRoot01";
const H = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" };
const post = (url: string, body?: unknown, headers: Record<string, string> = H) =>
  new Request(`http://127.0.0.1:3000${url}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
const p = <T extends object>(x: T) => ({ params: Promise.resolve(x) });

beforeEach(async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "dd-s3-"));
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

async function startAndFinish() {
  const { batchId } = (await (await START(post("/api/batches", { folderUrl: ROOT }))).json()) as { batchId: string };
  await getApp().batchLane.idle();
  return batchId;
}
const batchOf = async (id: string) => (await (await GET_BATCH(new Request("http://x"), p({ id }))).json()) as any;
const team = (b: any, id: string) => b.teams.find((t: any) => t.subfolderId === id);
const uploads = () => getSharedFakeGemini().requests.filter((r) => r.path === "/upload/v1beta/files").length;

describe("RSM-01 checkpoint: a crash between saving the result and the row does not re-judge", () => {
  it("should_restore_the_row_from_the_saved_team_result_without_calling_the_ai", async () => {
    const id = await startAndFinish();
    const app = getApp();
    // Simulate the crash window: team file written, row not yet updated.
    await app.batches.update(id, (b) => ({ ...b, status: "Interrupted", teams: b.teams.map((t) => (t.subfolderId === "teamFolderAlpha001" ? { ...t, status: "Pending", summary: undefined } : t)) }));
    const before = uploads();
    expect((await RESUME(post(`/api/batches/${id}/resume`), p({ id }))).status).toBe(202);
    await app.batchLane.idle();
    const b = await batchOf(id);
    expect(team(b, "teamFolderAlpha001").error).toBeUndefined();
    expect(team(b, "teamFolderAlpha001")).toMatchObject({ status: "Completed", summary: { overallScore: 3.92 } });
    expect(uploads()).toBe(before);
  });
});

describe("RSM-02 pause and resume", () => {
  it("should_pause_after_the_current_team_and_resume_from_the_next_one", async () => {
    // Pause as soon as the first team starts downloading, the way a judge would mid-run.
    const app = getApp();
    await app.ready;
    let paused: Promise<Response> | null = null;
    const { batchId: id } = (await (await START(post("/api/batches", { folderUrl: ROOT }))).json()) as { batchId: string };
    await new Promise<void>((resolve) => {
      const stop = app.bus.onBatch(id, (e) => {
        if (!paused && e.type === "row" && e.row.status === "Downloading") {
          paused = PAUSE(post(`/api/batches/${id}/pause`), p({ id }));
          stop();
          resolve();
        }
      });
    });
    expect((await paused!).status).toBe(202);
    await getApp().batchLane.idle();
    let b = await batchOf(id);
    expect(b.status).toBe("Paused");
    const done = b.teams.filter((t: any) => t.status !== "Pending");
    expect(done).toHaveLength(1);
    expect(done[0].teamName).toBe("Team 1 Alpha");

    expect((await RESUME(post(`/api/batches/${id}/resume`), p({ id }))).status).toBe(202);
    await getApp().batchLane.idle();
    b = await batchOf(id);
    expect(b.status).toBe("Completed");
    expect(team(b, "teamFolderAlpha001").attempts).toBe(1);
    expect(b.teams.every((t: any) => t.status !== "Pending")).toBe(true);
  });

  it("should_refuse_to_pause_a_batch_that_is_not_running_and_to_resume_a_completed_one", async () => {
    const id = await startAndFinish();
    const r1 = await PAUSE(post(`/api/batches/${id}/pause`), p({ id }));
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as any).error.code).toBe("NOT_RUNNING");
    const r2 = await RESUME(post(`/api/batches/${id}/resume`), p({ id }));
    expect(((await r2.json()) as any).error.code).toBe("NOT_RESUMABLE");
  });

  it("should_resume_an_interrupted_batch_from_the_first_pending_team", async () => {
    const id = await startAndFinish();
    const app = getApp();
    await app.batches.update(id, (b) => ({ ...b, status: "Running", teams: b.teams.map((t) => (t.order >= 3 ? { ...t, status: "Scoring", summary: undefined, error: undefined } : t)) }));
    await resetAppForTests(); // restart: recovery marks Interrupted and resets in-flight rows
    let b = await batchOf(id);
    expect(b.status).toBe("Interrupted");
    expect((await RESUME(post(`/api/batches/${id}/resume`), p({ id }))).status).toBe(202);
    await getApp().batchLane.idle();
    b = await batchOf(id);
    expect(b.status).toBe("Completed");
    expect(team(b, "teamFolderAlpha001").attempts).toBe(1);
    expect(team(b, "teamFolderEcho0001").attempts).toBe(2);
  });

  it("should_refuse_mutations_from_another_origin", async () => {
    const id = await startAndFinish();
    expect((await RESUME(post(`/api/batches/${id}/resume`, undefined, { ...H, origin: "https://evil.example" }), p({ id }))).status).toBe(403);
  });
});

describe("RSM-03 reuse completed evaluations", () => {
  it("should_rejudge_only_a_team_whose_video_changed", async () => {
    const id = await startAndFinish();
    getSharedFakeDrive().nodes.get("videoAlpha00000001")!.content = fixtureVideo("new cut");
    const before = uploads();
    expect((await RESCAN(post(`/api/batches/${id}/rescan`), p({ id }))).status).toBe(202);
    await getApp().batchLane.idle();
    const b = await batchOf(id);
    expect(team(b, "teamFolderAlpha001")).toMatchObject({ status: "Completed", attempts: 2 });
    expect(team(b, "teamFolderGamma001").attempts).toBe(1);
    expect(team(b, "teamFolderDelta001").attempts).toBe(1);
    expect(uploads()).toBe(before + 1);
  });

  it("should_add_new_team_folders_on_rescan_and_keep_completed_teams", async () => {
    const id = await startAndFinish();
    const d = getSharedFakeDrive();
    d.nodes.set("teamFolderNew00001", { id: "teamFolderNew00001", name: "Team 11 Newcomer", mimeType: "application/vnd.google-apps.folder", parent: "fixtureHackathonRoot01" });
    d.nodes.set("videoNew000000001", { id: "videoNew000000001", name: "new.webm", mimeType: "video/webm", parent: "teamFolderNew00001", content: fixtureVideo() });
    const res = await RESCAN(post(`/api/batches/${id}/rescan`), p({ id }));
    expect(((await res.json()) as any).added).toBe(1);
    await getApp().batchLane.idle();
    const b = await batchOf(id);
    expect(team(b, "teamFolderNew00001")).toMatchObject({ status: "Completed", order: 6 });
    expect(team(b, "teamFolderAlpha001").attempts).toBe(1);
  });
});

describe("RSM-04 retry", () => {
  it("should_retry_one_failed_team_after_its_cause_is_fixed_without_touching_others", async () => {
    const id = await startAndFinish();
    getSharedFakeDrive().nodes.get("videoEchoLocked01")!.restricted = false;
    const res = await RETRY_TEAM(post(`/api/batches/${id}/teams/teamFolderEcho0001/retry`, {}), p({ id, teamId: "teamFolderEcho0001" }));
    expect(res.status).toBe(202);
    await getApp().batchLane.idle();
    const b = await batchOf(id);
    expect(team(b, "teamFolderEcho0001")).toMatchObject({ status: "Completed", attempts: 2 });
    expect(team(b, "teamFolderAlpha001").attempts).toBe(1);
    expect(team(b, "teamFolderBeta0001").attempts).toBe(1);
  });

  it("should_rejudge_a_completed_team_only_when_asked", async () => {
    const id = await startAndFinish();
    const r1 = await RETRY_TEAM(post(`/api/batches/${id}/teams/teamFolderAlpha001/retry`, {}), p({ id, teamId: "teamFolderAlpha001" }));
    expect(((await r1.json()) as any).error.code).toBe("NOT_RETRYABLE");
    const r2 = await RETRY_TEAM(post(`/api/batches/${id}/teams/teamFolderAlpha001/retry`, { rejudge: true }), p({ id, teamId: "teamFolderAlpha001" }));
    expect(r2.status).toBe(202);
    await getApp().batchLane.idle();
    expect(team(await batchOf(id), "teamFolderAlpha001")).toMatchObject({ status: "Completed", attempts: 2 });
  });

  it("should_retry_a_failed_single_evaluation_with_the_stored_upload", async () => {
    const body = Buffer.concat([await readFile(path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm")), Buffer.from("DD-SCENARIO:repair")]);
    const up = await UPLOAD(new Request("http://127.0.0.1:3000/api/evaluations", { method: "POST", headers: { ...H, "content-type": "video/webm", "x-file-name": "a.webm" }, body: new Uint8Array(body) }));
    const { evaluationId: id } = (await up.json()) as { evaluationId: string };
    await getApp().singleLane.idle();
    // Force a failure, then retry: the stored file is judged again without a new upload from the browser.
    await getApp().evaluations.update(id, (r) => ({ ...r, status: "Failed", result: undefined, error: { code: "AI_UNAVAILABLE", message: "AI service unavailable, retry later", step: "Scoring", at: new Date().toISOString() } }));
    expect((await RETRY_EVAL(post(`/api/evaluations/${id}/retry`), p({ id }))).status).toBe(202);
    await getApp().singleLane.idle();
    const rec = (await (await GET_EVAL(new Request("http://x"), p({ id }))).json()) as any;
    expect(rec).toMatchObject({ status: "Completed", attempts: 2 });
    expect(rec.error).toBeUndefined();
    const r2 = await RETRY_EVAL(post(`/api/evaluations/${id}/retry`), p({ id }));
    expect(((await r2.json()) as any).error.code).toBe("NOT_RETRYABLE");
  });
});

describe("TBL-04 export route", () => {
  it("should_download_scores_csv_for_the_batch", async () => {
    const id = await startAndFinish();
    const res = await EXPORT(new Request("http://x"), p({ id }));
    expect(res.headers.get("content-disposition")).toBe('attachment; filename="scores.csv"');
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    const text = await res.text();
    expect(text.split("\r\n").filter(Boolean)).toHaveLength(7);
    expect(text).toContain('"Team 1 Alpha","Completed"');
  });
});
