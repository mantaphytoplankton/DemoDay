import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetEnvCache } from "../../src/server/env.ts";
import { getApp, resetAppForTests } from "../../src/server/app-context.ts";
import { POST as START } from "../../src/app/api/batches/route.ts";
import { GET as GET_BATCH } from "../../src/app/api/batches/[id]/route.ts";
import { GET as TEAM } from "../../src/app/api/batches/[id]/teams/[teamId]/route.ts";
import { PATCH as TEAM_OVERRIDE } from "../../src/app/api/batches/[id]/teams/[teamId]/override/route.ts";
import { POST as RETRY_TEAM } from "../../src/app/api/batches/[id]/teams/[teamId]/retry/route.ts";
import { GET as EXPORT } from "../../src/app/api/batches/[id]/export.csv/route.ts";
import { POST as UPLOAD } from "../../src/app/api/evaluations/route.ts";
import { PATCH as EVAL_OVERRIDE } from "../../src/app/api/evaluations/[id]/override/route.ts";

const ROOT = "https://drive.google.com/drive/folders/fixtureHackathonRoot01";
const H = { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": "application/json" };
const req = (method: string, url: string, body?: unknown, headers = H) => new Request(`http://127.0.0.1:3000${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
const p = <T extends object>(x: T) => ({ params: Promise.resolve(x) });
const ALPHA = "teamFolderAlpha001";

beforeEach(async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "dd-ovr-"));
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

async function batch() {
  const { batchId } = (await (await START(req("POST", "/api/batches", { folderUrl: ROOT }))).json()) as { batchId: string };
  await getApp().batchLane.idle();
  return batchId;
}
const override = (id: string, body: unknown, headers = H) => TEAM_OVERRIDE(req("PATCH", `/api/batches/${id}/teams/${ALPHA}/override`, body, headers), p({ id, teamId: ALPHA }));
const row = async (id: string) => ((await (await GET_BATCH(new Request("http://x"), p({ id }))).json()) as any).teams.find((t: any) => t.subfolderId === ALPHA);

describe("team override (TBL-03)", () => {
  it("should_set_the_final_score_keep_the_ai_score_and_recompute_overall", async () => {
    const id = await batch();
    const res = await override(id, { categoryId: "working_solution", score: 2, note: "Demo used hardcoded output" });
    expect(res.status).toBe(200);
    const r = await row(id);
    expect(r.summary.categories.working_solution.score).toBe(4); // AI score kept
    expect(r.summary.final).toEqual({ categories: { working_solution: 2, meaningful_ai: 3, ux_value: 5 }, overallScore: 3.08, overridden: true });
    const d = (await (await TEAM(new Request("http://x"), p({ id, teamId: ALPHA }))).json()) as any;
    expect(d.overrides.working_solution).toMatchObject({ score: 2, note: "Demo used hardcoded output" });
  });

  it("should_require_a_note_and_a_whole_score_from_1_to_5", async () => {
    const id = await batch();
    const a = await override(id, { categoryId: "working_solution", score: 2, note: "" });
    expect(((await a.json()) as any).error.message).toBe("Add a note explaining the override");
    const b = await override(id, { categoryId: "working_solution", score: 6, note: "x" });
    expect(((await b.json()) as any).error.message).toBe("Score must be a whole number from 1 to 5");
    const c = await override(id, { categoryId: "nope", score: 2, note: "x" });
    expect(c.status).toBe(400);
    expect((await row(id)).summary.final).toBeUndefined();
  });

  it("should_return_to_the_ai_score_when_the_override_is_removed", async () => {
    const id = await batch();
    await override(id, { categoryId: "working_solution", score: 2, note: "n" });
    const res = await override(id, { categoryId: "working_solution", remove: true });
    expect(res.status).toBe(200);
    expect((await row(id)).summary.final).toMatchObject({ overallScore: 3.92, overridden: false });
  });

  it("should_export_final_scores_in_the_csv", async () => {
    const id = await batch();
    await override(id, { categoryId: "working_solution", score: 2, note: "n" });
    const csv = await (await EXPORT(new Request("http://x"), p({ id }))).text();
    const alpha = csv.split("\r\n").find((l) => l.startsWith('"Team 1 Alpha"'))!;
    expect(alpha).toContain('"4","2"'); // AI 4, final 2 for Working Solution
    expect(alpha).toContain('"3.92","3.08"');
  });

  it("should_clear_overrides_when_the_team_is_re_judged", async () => {
    const id = await batch();
    await override(id, { categoryId: "working_solution", score: 2, note: "n" });
    await RETRY_TEAM(req("POST", `/api/batches/${id}/teams/${ALPHA}/retry`, { rejudge: true }), p({ id, teamId: ALPHA }));
    await getApp().batchLane.idle();
    const r = await row(id);
    expect(r.summary.final).toBeUndefined();
    const d = (await (await TEAM(new Request("http://x"), p({ id, teamId: ALPHA }))).json()) as any;
    expect(d.overrides ?? {}).toEqual({});
  });

  it("should_refuse_overrides_for_teams_without_a_result_and_other_origins", async () => {
    const id = await batch();
    const r = await TEAM_OVERRIDE(req("PATCH", `/api/batches/${id}/teams/teamFolderBeta0001/override`, { categoryId: "working_solution", score: 2, note: "x" }), p({ id, teamId: "teamFolderBeta0001" }));
    expect(r.status).toBe(409);
    expect((await override(id, { categoryId: "working_solution", score: 2, note: "x" }, { ...H, origin: "https://evil.example" })).status).toBe(403);
  });
});

describe("single evaluation override (TBL-03)", () => {
  it("should_override_and_recompute_for_a_single_evaluation", async () => {
    const body = await readFile(path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm"));
    const up = await UPLOAD(new Request("http://127.0.0.1:3000/api/evaluations", { method: "POST", headers: { ...H, "content-type": "video/webm", "x-file-name": "a.webm" }, body: new Uint8Array(body) }));
    const { evaluationId: id } = (await up.json()) as { evaluationId: string };
    await getApp().singleLane.idle();
    const res = await EVAL_OVERRIDE(req("PATCH", `/api/evaluations/${id}/override`, { categoryId: "working_solution", score: 2, note: "Hardcoded" }), p({ id }));
    expect(res.status).toBe(200);
    const rec = (await res.json()) as any;
    expect(rec.final).toMatchObject({ overallScore: 3.08, overridden: true });
    expect(rec.overrides.working_solution.note).toBe("Hardcoded");
  });
});
