import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetEnvCache } from "../../src/server/env.ts";
import { getApp, resetAppForTests } from "../../src/server/app-context.ts";
import { POST, GET as LIST } from "../../src/app/api/evaluations/route.ts";
import { GET as GET_ONE } from "../../src/app/api/evaluations/[id]/route.ts";
import { GET as EVENTS } from "../../src/app/api/evaluations/[id]/events/route.ts";
import { GET as RUBRIC } from "../../src/app/api/rubric/route.ts";
import { GET as VIDEO } from "../../src/app/api/evaluations/[id]/video/route.ts";
import { getSharedFakeGemini } from "../../src/server/testing/gemini-fake-shared.ts";

const VIDEOS = path.join(process.cwd(), "tests/fixtures/videos");
let dataDir: string;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "dd-api-"));
  Object.assign(process.env, { NODE_ENV: "test", JUDGE_UPSTREAM: "fixture", DATA_DIR: dataDir, MAX_UPLOAD_MB: "1", JUDGE_POLL_MS: "10" });
  resetEnvCache();
  await resetAppForTests();
  (globalThis as { __demodayFakeGemini?: unknown }).__demodayFakeGemini = undefined;
});
afterEach(async () => {
  await resetAppForTests();
});

async function upload(name: string, body: Buffer, type: string, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://127.0.0.1:3000/api/evaluations", {
      method: "POST",
      headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000", "content-type": type, "x-file-name": encodeURIComponent(name), ...headers },
      body: new Uint8Array(body),
    }),
  );
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const video = (f = "team-alpha.webm") => readFile(path.join(VIDEOS, f));

describe("POST /api/evaluations (SNG-01)", () => {
  it("should_store_the_upload_and_complete_the_evaluation", async () => {
    const res = await upload("Team Alpha.webm", await video(), "video/webm");
    expect(res.status).toBe(202);
    const { evaluationId } = (await res.json()) as { evaluationId: string };
    await getApp().singleLane.idle();

    const rec = (await (await GET_ONE(new Request("http://x"), params(evaluationId))).json()) as Record<string, any>;
    expect(rec.status).toBe("Completed");
    expect(rec.source.fileName).toBe("Team Alpha.webm");
    expect(rec.source.storedFile).toBeUndefined();
    expect(rec.geminiFileName).toBeUndefined();
    expect(rec.result.overallScore).toBe(3.92);
    expect(rec.attempts).toBe(1);
    expect(await readdir(path.join(dataDir, "uploads"))).toEqual([`${evaluationId}.webm`]);
    expect(getSharedFakeGemini().files.size).toBe(0); // remote copy deleted
  });

  it("should_reject_a_pdf_as_unsupported_type", async () => {
    const res = await upload("slides.pdf", Buffer.from("%PDF-1.4"), "application/pdf");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: { code: "UNSUPPORTED_TYPE", message: "Unsupported file type. Use MP4, MOV or WebM." } });
  });

  it("should_reject_an_extension_that_disagrees_with_the_type", async () => {
    const res = await upload("clip.mp4", await video(), "video/webm");
    expect(((await res.json()) as any).error.code).toBe("UNSUPPORTED_TYPE");
  });

  it("should_reject_a_file_whose_content_is_not_a_video", async () => {
    const res = await upload("fake.mp4", await video("fake.mp4"), "video/mp4");
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).error.message).toBe("File is not a readable video");
    expect((await readdir(path.join(dataDir, "tmp"))).length).toBe(0);
  });

  it("should_reject_a_file_over_the_size_limit_while_streaming", async () => {
    const res = await upload("big.webm", Buffer.concat([await video(), Buffer.alloc(1024 * 1024)]), "video/webm");
    expect(res.status).toBe(413);
    expect(((await res.json()) as any).error.message).toBe("File is larger than 1 MB");
    expect((await readdir(path.join(dataDir, "tmp"))).length).toBe(0);
  });

  it("should_refuse_cross_origin_uploads", async () => {
    const res = await upload("a.webm", await video(), "video/webm", { origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });
});

describe("evaluation failures surface with reasons (SNG-02, RSM-05)", () => {
  it("should_mark_failed_with_reason_when_video_is_unprocessable", async () => {
    const body = Buffer.concat([await video(), Buffer.from("DD-SCENARIO:unprocessable")]);
    const { evaluationId } = (await (await upload("bad.webm", body, "video/webm")).json()) as { evaluationId: string };
    await getApp().singleLane.idle();
    const rec = (await (await GET_ONE(new Request("http://x"), params(evaluationId))).json()) as any;
    expect(rec.status).toBe("Failed");
    expect(rec.error).toMatchObject({ code: "VIDEO_UNPROCESSABLE", step: "Processing Video", message: "Video could not be processed (corrupted or unsupported format)" });
    expect(rec.result).toBeUndefined();
  });

  it("should_fail_with_rubric_invalid_when_rubric_md_is_malformed", async () => {
    await writeFile(path.join(dataDir, "rubric.md"), "# Rubric\nno block");
    const { evaluationId } = (await (await upload("a.webm", await video(), "video/webm")).json()) as { evaluationId: string };
    await getApp().singleLane.idle();
    const rec = (await (await GET_ONE(new Request("http://x"), params(evaluationId))).json()) as any;
    expect(rec.error.code).toBe("RUBRIC_INVALID");
    expect(getSharedFakeGemini().requests).toHaveLength(0); // nothing sent to the AI
  });
});

describe("GET events (SNG-02)", () => {
  it("should_stream_snapshot_then_steps_in_order_until_completed", async () => {
    const { evaluationId } = (await (await upload("a.webm", await video(), "video/webm")).json()) as { evaluationId: string };
    const res = await EVENTS(new Request("http://x"), params(evaluationId));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const text = await res.text(); // stream closes on the final state
    const statuses = [...text.matchAll(/^data: (.*)$/gm)].map((m) => JSON.parse(m[1]!).status as string);
    const distinct = statuses.filter((s, i) => s !== statuses[i - 1]);
    expect(distinct.at(-1)).toBe("Completed");
    expect(distinct).toEqual(expect.arrayContaining(["Processing Video", "Scoring", "Completed"]));
  });
});

describe("GET /api/evaluations and /api/rubric", () => {
  it("should_list_recent_evaluations_newest_first", async () => {
    await upload("one.webm", await video(), "video/webm");
    await getApp().singleLane.idle();
    await upload("two.webm", await video(), "video/webm");
    await getApp().singleLane.idle();
    const { items } = (await (await LIST(new Request("http://x/api/evaluations"))).json()) as { items: { fileName: string; overallScore: number }[] };
    expect(items.map((i) => i.fileName)).toEqual(["two.webm", "one.webm"]);
    expect(items[0]!.overallScore).toBe(3.92);
  });

  it("should_return_404_for_unknown_or_malformed_ids", async () => {
    expect((await GET_ONE(new Request("http://x"), params("../../etc"))).status).toBe(404);
    expect((await GET_ONE(new Request("http://x"), params("3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60"))).status).toBe(404);
  });

  it("should_report_the_default_rubric_and_its_version", async () => {
    const r = (await (await RUBRIC()).json()) as any;
    expect(r.source).toBe("default");
    expect(r.meta.categories).toHaveLength(3);
    expect(r.error).toBeNull();
  });
});

describe("GET video (SNG-04)", () => {
  it("should_serve_the_stored_upload_with_range_support_for_seeking", async () => {
    const bytes = await video();
    const { evaluationId } = (await (await upload("a.webm", bytes, "video/webm")).json()) as { evaluationId: string };
    await getApp().singleLane.idle();
    const full = await VIDEO(new Request("http://x"), params(evaluationId));
    expect(full.status).toBe(200);
    expect(full.headers.get("accept-ranges")).toBe("bytes");
    expect(Buffer.from(await full.arrayBuffer()).equals(bytes)).toBe(true);
    const part = await VIDEO(new Request("http://x", { headers: { range: "bytes=100-199" } }), params(evaluationId));
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe(`bytes 100-199/${bytes.length}`);
    expect(Buffer.from(await part.arrayBuffer()).equals(bytes.subarray(100, 200))).toBe(true);
    const bad = await VIDEO(new Request("http://x", { headers: { range: `bytes=${bytes.length + 5}-` } }), params(evaluationId));
    expect(bad.status).toBe(416);
  });

  it("should_return_404_for_unknown_ids", async () => {
    expect((await VIDEO(new Request("http://x"), params("3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60"))).status).toBe(404);
  });

  it("should_store_evidence_and_flags_in_the_result", async () => {
    const { evaluationId } = (await (await upload("a.webm", await video(), "video/webm")).json()) as { evaluationId: string };
    await getApp().singleLane.idle();
    const rec = (await (await GET_ONE(new Request("http://x"), params(evaluationId))).json()) as any;
    expect(rec.result.outputVersion).toBe(3);
    expect(rec.result.observations.length).toBeGreaterThan(0);
    expect(rec.result.observations.every((o: any) => /^\d{2}:\d{2}$/.test(o.at))).toBe(true);
    expect(rec.result.flags).toMatchObject({ audio: "ok", impactClaimedWithoutHow: true });
  });

  it("should_store_the_transcript_through_the_api_and_return_it_as_plain_data (JDG-08)", async () => {
    const { evaluationId } = (await (await upload("a.webm", await video(), "video/webm")).json()) as { evaluationId: string };
    await getApp().singleLane.idle();
    const rec = (await (await GET_ONE(new Request("http://x"), params(evaluationId))).json()) as any;
    expect(rec.result.transcript.length).toBe(5);
    expect(rec.result.transcript[0]).toEqual({ from: "00:00", to: "00:24", speech: true, text: "Fixture output: spoken words, part 1." });
    expect(rec.result.transcript[2]).toMatchObject({ speech: false, text: "" });
    expect(rec.result.transcript.at(-1).to).toBe("02:00");
  });
});

describe("startup recovery", () => {
  it("should_mark_in_progress_evaluations_interrupted_and_delete_remote_files", async () => {
    const id = "3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60";
    await mkdir(path.join(dataDir, "evaluations"), { recursive: true });
    await mkdir(path.join(dataDir, "tmp"), { recursive: true });
    await writeFile(path.join(dataDir, "tmp", "stale.part"), "x");
    const now = new Date().toISOString();
    await writeFile(
      path.join(dataDir, "evaluations", `${id}.json`),
      JSON.stringify({
        schemaVersion: 1, id, status: "Scoring", step: { name: "Scoring", startedAt: now }, attempts: 1, geminiFileName: "files/orphan",
        source: { kind: "upload", fileName: "a.webm", mimeType: "video/webm", sizeBytes: 10, storedFile: `uploads/${id}.webm` },
        createdAt: now, updatedAt: now,
      }),
    );
    const app = getApp();
    await app.ready;
    const rec = await app.evaluations.get(id);
    expect(rec?.status).toBe("Failed");
    expect(rec?.error?.code).toBe("INTERRUPTED");
    expect(rec?.error?.message).toBe("Interrupted by server restart");
    expect(rec?.geminiFileName).toBeUndefined();
    expect(getSharedFakeGemini().requests.some((r) => r.method === "DELETE" && r.path.endsWith("files/orphan"))).toBe(true);
    expect(await readdir(path.join(dataDir, "tmp"))).toEqual([]);
  });
});
