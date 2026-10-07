import { describe, it, expect } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { mkdtemp, stat, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { judgeVideo, JudgeError, type JudgeDeps, type JudgeInput } from "../../src/server/agent/index.ts";
import { VertexProvider } from "../../src/server/agent/providers/vertex.ts";
import { ServiceAccountTokenSource, parseServiceAccount } from "../../src/server/agent/providers/google-auth.ts";
import { FakeGemini } from "../../src/server/testing/gemini-fake.ts";
import { inspectRubric, type LoadedRubric } from "../../src/server/rubric/load.ts";
import { loadPrompts } from "../../src/server/agent/prompt.ts";

const VIDEO = path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY = {
  type: "service_account",
  project_id: "demo-project",
  private_key_id: "abc123",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
  client_email: "judge@demo-project.iam.gserviceaccount.com",
  token_uri: "https://oauth.fake/token",
};

/** Fake Google OAuth + Vertex generateContent. Verifies the JWT signature with the key's public half. */
function fakeVertex(opts: { vertexStatus?: number; tokenStatus?: number; scenario?: string } = {}) {
  const gemini = new FakeGemini({ processingPolls: 0 });
  const log = { tokens: 0, generate: 0, urls: [] as string[], auth: [] as string[] };
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    const url = String(input);
    log.urls.push(url);
    if (url === KEY.token_uri) {
      log.tokens++;
      if (opts.tokenStatus) return Response.json({ error: "invalid_grant", error_description: "Invalid JWT Signature." }, { status: opts.tokenStatus });
      const assertion = new URLSearchParams(String(init.body)).get("assertion")!;
      const [h, p, sig] = assertion.split(".");
      const ok = createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(sig!, "base64url"));
      const claims = JSON.parse(Buffer.from(p!, "base64url").toString());
      if (!ok || claims.iss !== KEY.client_email || claims.aud !== KEY.token_uri || !claims.scope.includes("cloud-platform")) {
        return Response.json({ error: "invalid_grant" }, { status: 400 });
      }
      return Response.json({ access_token: `tok-${log.tokens}`, expires_in: 3600, token_type: "Bearer" });
    }
    if (url.includes(":generateContent")) {
      log.generate++;
      log.auth.push(new Headers(init.headers).get("authorization") ?? "");
      if (opts.vertexStatus) return Response.json({ error: { code: opts.vertexStatus, status: opts.vertexStatus === 403 ? "PERMISSION_DENIED" : "UNAVAILABLE", message: "x" } }, { status: opts.vertexStatus });
      // Translate the inline video into a fake Gemini file and reuse its scoring fake.
      const body = JSON.parse(String(init.body));
      const inline = body.contents[0].parts[0].inlineData;
      const name = `files/v${log.generate}`;
      gemini.files.set(name, { name, uri: `fake://${name}`, mimeType: inline.mimeType, scenario: (opts.scenario ?? "normal") as never, durationSeconds: 0, pollsLeft: 0, generateCalls: 0 });
      body.contents[0].parts[0] = { fileData: { mimeType: inline.mimeType, fileUri: `fake://${name}` } };
      return gemini.fetch(`${gemini.base}/v1beta/models/m:generateContent`, { method: "POST", headers: { "x-goog-api-key": "k" }, body: JSON.stringify(body) });
    }
    return new Response("not found", { status: 404 });
  };
  return { fetchImpl, log };
}

async function deps(fetchImpl: typeof fetch, inlineMaxBytes = 80 * 1024 * 1024): Promise<JudgeDeps> {
  const tokens = new ServiceAccountTokenSource(parseServiceAccount(JSON.stringify(KEY)), fetchImpl);
  const provider = new VertexProvider({ model: "gemini-3.8-flash", project: KEY.project_id, location: "global", tokens, fetch: fetchImpl, inlineMaxBytes });
  return { provider, settings: { temperature: 0.2, thinkingBudget: 4096, videoFps: 1 }, prompts: await loadPrompts(), sleep: async () => {}, random: () => 0 };
}
async function input(file = VIDEO, mimeType: "video/webm" | "video/mp4" = "video/webm"): Promise<JudgeInput> {
  const rubric = (await inspectRubric({ dataDir: "/none", defaultPath: path.join(process.cwd(), "config/rubric.default.md") })) as LoadedRubric;
  const steps: string[] = [];
  return { source: { path: file, mimeType, sizeBytes: (await stat(file)).size, displayName: "eval-1" }, rubric, signal: new AbortController().signal, onStep: (s) => void steps.push(s), onRemoteFile: () => {} };
}

describe("VertexProvider (JDG-07)", () => {
  it("should_score_through_vertex_with_a_signed_service_account_token_and_inline_video", async () => {
    const { fetchImpl, log } = fakeVertex();
    const d = await deps(fetchImpl);
    const r = await judgeVideo(await input(), d);
    expect(r.overallScore).toBe(3.92);
    expect(Math.round(r.durationSeconds)).toBe(120); // read from the WebM header
    expect(r.provenance).toMatchObject({ model: "gemini-3.8-flash", provider: "vertex" });
    expect(log.urls.find((u) => u.includes(":generateContent"))).toBe(
      "https://aiplatform.googleapis.com/v1/projects/demo-project/locations/global/publishers/google/models/gemini-3.8-flash:generateContent",
    );
    expect(log.auth[0]).toBe("Bearer tok-1");
    // A second evaluation reuses the cached token.
    await judgeVideo(await input(), d);
    expect(log.tokens).toBe(1);
  });

  it("should_flag_a_3_24_video_using_the_length_read_from_the_file", async () => {
    const { fetchImpl } = fakeVertex();
    const r = await judgeVideo(await input(path.join(process.cwd(), "tests/fixtures/videos/team-long.webm")), await deps(fetchImpl));
    expect(r.exceedsMaxDuration).toBe(true);
  });

  it("should_refuse_a_video_above_the_inline_limit_without_calling_vertex", async () => {
    const { fetchImpl, log } = fakeVertex();
    const e = await judgeVideo(await input(), await deps(fetchImpl, 1024)).catch((x) => x);
    expect(e).toBeInstanceOf(JudgeError);
    expect((e as JudgeError).code).toBe("VIDEO_TOO_LARGE");
    expect((e as JudgeError).message).toBe("Video is too large for Vertex AI (limit 1 KB)");
    expect(log.generate).toBe(0);
  });

  it("should_reject_when_vertex_denies_permission", async () => {
    const { fetchImpl, log } = fakeVertex({ vertexStatus: 403 });
    const e = (await judgeVideo(await input(), await deps(fetchImpl)).catch((x) => x)) as JudgeError;
    expect(e.code).toBe("AI_REJECTED");
    expect(log.generate).toBe(1);
  });

  it("should_reject_when_sign_in_fails_without_leaking_the_key", async () => {
    const { fetchImpl } = fakeVertex({ tokenStatus: 400 });
    const e = (await judgeVideo(await input(), await deps(fetchImpl)).catch((x) => x)) as JudgeError;
    expect(e.code).toBe("AI_REJECTED");
    expect(`${e.message} ${e.detail}`).not.toContain("PRIVATE KEY");
    expect(e.detail).toContain("invalid_grant");
  });

  it("should_wait_out_overload_on_vertex_too", async () => {
    const { fetchImpl, log } = fakeVertex({ vertexStatus: 503 });
    const e = (await judgeVideo(await input(), await deps(fetchImpl)).catch((x) => x)) as JudgeError;
    expect(e.code).toBe("AI_UNAVAILABLE");
    expect(log.generate).toBe(6);
  });
});

describe("parseServiceAccount", () => {
  it("should_reject_files_that_are_not_service_account_keys", () => {
    expect(() => parseServiceAccount("{")).toThrow(/not valid JSON/);
    expect(() => parseServiceAccount(JSON.stringify({ type: "authorized_user" }))).toThrow(/not a service-account key/);
    expect(() => parseServiceAccount(JSON.stringify({ ...KEY, private_key: "x" }))).toThrow(/private_key/);
  });
});

describe("env for Vertex", () => {
  it("should_require_a_readable_service_account_file_and_not_the_gemini_key", async () => {
    const { getEnv } = await import("../../src/server/env.ts");
    const dir = await mkdtemp(path.join(tmpdir(), "dd-vx-"));
    const good = path.join(dir, "key.json");
    await writeFile(good, JSON.stringify(KEY));
    const e = getEnv({ NODE_ENV: "development", AI_PROVIDER: "vertex", VERTEX_SERVICE_ACCOUNT_FILE: good });
    expect(e).toMatchObject({ AI_PROVIDER: "vertex", VERTEX_LOCATION: "global", VERTEX_INLINE_MAX_MB: 80 });
    expect(() => getEnv({ NODE_ENV: "development", AI_PROVIDER: "vertex" })).toThrow(/VERTEX_SERVICE_ACCOUNT_FILE is not set/);
    expect(() => getEnv({ NODE_ENV: "development", AI_PROVIDER: "vertex", VERTEX_SERVICE_ACCOUNT_FILE: path.join(dir, "missing.json") })).toThrow(/VERTEX_SERVICE_ACCOUNT_FILE: file not found/);
    const bad = path.join(dir, "bad.json");
    await writeFile(bad, "{");
    let msg = "";
    try { getEnv({ NODE_ENV: "development", AI_PROVIDER: "vertex", VERTEX_SERVICE_ACCOUNT_FILE: bad }); } catch (x) { msg = (x as Error).message; }
    expect(msg).toMatch(/VERTEX_SERVICE_ACCOUNT_FILE: .*not valid JSON/);
    expect(await readFile(good, "utf8")).toContain("PRIVATE KEY"); // file untouched
  });
});
