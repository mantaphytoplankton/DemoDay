import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetEnvCache } from "../../src/server/env.ts";
import { getApp, resetAppForTests } from "../../src/server/app-context.ts";
import { POST as UPLOAD, GET as LIST_EVALS } from "../../src/app/api/evaluations/route.ts";
import { GET as GET_EVAL, DELETE as DELETE_EVAL } from "../../src/app/api/evaluations/[id]/route.ts";
import { POST as START, GET as LIST_BATCHES } from "../../src/app/api/batches/route.ts";
import { GET as GET_BATCH, DELETE as DELETE_BATCH } from "../../src/app/api/batches/[id]/route.ts";
import { getSharedFakeGemini } from "../../src/server/testing/gemini-fake-shared.ts";
import { getSharedFakeDrive } from "../../src/server/testing/drive-fake-shared.ts";

const ROOT = "https://drive.google.com/drive/folders/fixtureHackathonRoot01";
const H = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" };
const p = <T extends object>(x: T) => ({ params: Promise.resolve(x) });
const del = (url: string, headers = H) => new Request(`http://127.0.0.1:3000${url}`, { method: "DELETE", headers });
let dataDir = "";

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "dd-del-"));
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

async function upload() {
  const body = await readFile(path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm"));
  const res = await UPLOAD(new Request("http://127.0.0.1:3000/api/evaluations", { method: "POST", headers: { ...H, "content-type": "video/webm", "x-file-name": "team-alpha.webm" }, body: new Uint8Array(body) }));
  return ((await res.json()) as { evaluationId: string }).evaluationId;
}
const exists = (f: string) => access(f).then(() => true, () => false);

describe("delete a single evaluation (RSM-07)", () => {
  it("should_remove_the_record_and_its_stored_video", async () => {
    const id = await upload();
    await getApp().singleLane.idle();
    expect((await DELETE_EVAL(del(`/api/evaluations/${id}`), p({ id }))).status).toBe(204);
    expect((await GET_EVAL(new Request("http://x"), p({ id }))).status).toBe(404);
    expect(await exists(path.join(dataDir, "uploads", `${id}.webm`))).toBe(false);
    const { items } = (await (await LIST_EVALS(new Request("http://x/api/evaluations"))).json()) as { items: unknown[] };
    expect(items).toHaveLength(0);
  });

  it("should_refuse_while_the_evaluation_is_being_processed", async () => {
    const id = await upload();
    await getApp().evaluations.update(id, (r) => ({ ...r, status: "Scoring" }));
    const res = await DELETE_EVAL(del(`/api/evaluations/${id}`), p({ id }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.message).toBe("Pause or wait until it finishes, then delete");
    await getApp().singleLane.idle();
  });

  it("should_delete_a_leftover_remote_copy", async () => {
    const id = await upload();
    await getApp().singleLane.idle();
    await getApp().evaluations.update(id, (r) => ({ ...r, status: "Failed", geminiFileName: "files/leftover" }));
    await DELETE_EVAL(del(`/api/evaluations/${id}`), p({ id }));
    expect(getSharedFakeGemini().requests.some((r) => r.method === "DELETE" && r.path.endsWith("files/leftover"))).toBe(true);
  });

  it("should_refuse_other_origins", async () => {
    const id = await upload();
    await getApp().singleLane.idle();
    expect((await DELETE_EVAL(del(`/api/evaluations/${id}`, { ...H, origin: "https://evil.example" }), p({ id }))).status).toBe(403);
  });
});

describe("delete a batch (RSM-07)", () => {
  it("should_remove_the_batch_and_all_team_results_without_touching_drive", async () => {
    const { batchId: id } = (await (await START(new Request("http://127.0.0.1:3000/api/batches", { method: "POST", headers: H, body: JSON.stringify({ folderUrl: ROOT }) }))).json()) as { batchId: string };
    await getApp().batchLane.idle();
    const driveNodes = getSharedFakeDrive().nodes.size;
    expect((await DELETE_BATCH(del(`/api/batches/${id}`), p({ id }))).status).toBe(204);
    expect((await GET_BATCH(new Request("http://x"), p({ id }))).status).toBe(404);
    expect(await readdir(path.join(dataDir, "batches"))).toEqual([]);
    expect(((await (await LIST_BATCHES()).json()) as any).items).toEqual([]);
    expect(getSharedFakeDrive().nodes.size).toBe(driveNodes);
    expect(getSharedFakeDrive().requests.every((r) => !/DELETE/.test(r.path))).toBe(true);
  });

  it("should_refuse_while_the_batch_is_running", async () => {
    const { batchId: id } = (await (await START(new Request("http://127.0.0.1:3000/api/batches", { method: "POST", headers: H, body: JSON.stringify({ folderUrl: ROOT }) }))).json()) as { batchId: string };
    const res = await DELETE_BATCH(del(`/api/batches/${id}`), p({ id }));
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).error.message).toBe("Pause or wait until it finishes, then delete");
    await getApp().batchLane.idle();
  });

  it("should_judge_the_same_folder_again_from_scratch_after_deletion", async () => {
    const start = () => START(new Request("http://127.0.0.1:3000/api/batches", { method: "POST", headers: H, body: JSON.stringify({ folderUrl: ROOT }) }));
    const { batchId: id } = (await (await start()).json()) as { batchId: string };
    await getApp().batchLane.idle();
    await DELETE_BATCH(del(`/api/batches/${id}`), p({ id }));
    const uploads = () => getSharedFakeGemini().requests.filter((r) => r.path === "/upload/v1beta/files").length;
    const before = uploads();
    const again = (await (await start()).json()) as { batchId: string; reopened: boolean };
    expect(again).toEqual({ batchId: id, reopened: false });
    await getApp().batchLane.idle();
    expect(uploads()).toBeGreaterThan(before);
    const b = (await (await GET_BATCH(new Request("http://x"), p({ id }))).json()) as any;
    expect(b.teams.find((t: any) => t.teamName === "Team 1 Alpha").attempts).toBe(1);
  });
});
