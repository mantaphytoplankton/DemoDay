import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { stat } from "node:fs/promises";
import { judgeVideo, JudgeError, type JudgeInput, type JudgeDeps } from "../../src/server/agent/index.ts";
import { GeminiProvider } from "../../src/server/agent/providers/gemini.ts";
import { FakeGemini, type FakeGeminiOptions } from "../../src/server/testing/gemini-fake.ts";
import { inspectRubric, type LoadedRubric } from "../../src/server/rubric/load.ts";
import { loadPrompts } from "../../src/server/agent/prompt.ts";
import { JudgeResultSchema } from "../../src/shared/schemas/judge-result.ts";
import { transcriptEarlyEnd } from "../../src/shared/transcript.ts";

const VIDEO = path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm");

async function setup(fakeOpts: FakeGeminiOptions = {}, apiKey = "test-key") {
  const fake = new FakeGemini(fakeOpts);
  const provider = new GeminiProvider({ apiKey, model: "gemini-3.8-flash", baseUrl: fake.base, fetch: fake.fetch });
  const rubric = (await inspectRubric({ dataDir: "/none", defaultPath: path.join(process.cwd(), "config/rubric.default.md") })) as LoadedRubric;
  let clock = Date.parse("2026-10-05T10:00:00Z");
  const sleeps: number[] = [];
  const deps: JudgeDeps = {
    provider,
    settings: { temperature: 0.2, thinkingBudget: 4096, videoFps: 1 },
    prompts: await loadPrompts(),
    now: () => clock,
    random: () => 0,
    sleep: async (ms, signal) => {
      if (signal.aborted) throw signal.reason;
      sleeps.push(ms);
      clock += ms;
    },
  };
  const steps: [string, string | undefined][] = [];
  const remote: (string | null)[] = [];
  const size = (await stat(VIDEO)).size;
  const input: JudgeInput = {
    source: { path: VIDEO, mimeType: "video/webm", sizeBytes: size, displayName: "eval-123" },
    rubric,
    signal: new AbortController().signal,
    onStep: (s, n) => void steps.push([s, n]),
    onRemoteFile: (n) => void remote.push(n),
  };
  return { fake, provider, deps, input, steps, remote, sleeps };
}

describe("judgeVideo happy path (JDG-03, JDG-04)", () => {
  it("should_upload_wait_until_active_score_and_delete_remote_file", async () => {
    const { fake, deps, input, steps, remote } = await setup();
    const r = await judgeVideo(input, deps);

    expect(JudgeResultSchema.safeParse(r).success).toBe(true);
    expect(Object.keys(r.categories)).toEqual(["working_solution", "meaningful_ai", "ux_value"]);
    expect(r.overallScore).toBe(3.92);
    expect(r.durationSeconds).toBe(120.4);
    expect(r.exceedsMaxDuration).toBe(false);
    expect(r.provenance.model).toBe("gemini-3.8-flash");
    expect(r.provenance.modelVersion).toBe("fake-gemini-001");
    expect(r.provenance.usage.totalTokens).toBe(54100);
    expect(r.provenance.repairUsed).toBe(false);

    const order = steps.map(([s]) => s).filter((s, i, a) => s !== a[i - 1]);
    expect(order).toEqual(["Uploading", "Processing Video", "Scoring"]);
    expect(remote).toEqual(["files/f2", null]);
    expect(fake.deleted).toEqual(["files/f2"]);
    expect(fake.requests.every((q) => q.hasKey)).toBe(true);
  });

  it("should_send_the_api_key_only_in_headers", async () => {
    const { fake, deps, input } = await setup();
    await judgeVideo(input, deps);
    expect(fake.requests.some((q) => q.path.includes("key="))).toBe(false);
  });

  it("should_flag_duration_over_three_minutes_from_file_metadata", async () => {
    const { deps, input } = await setup({ durationSeconds: 204 });
    const r = await judgeVideo(input, deps);
    expect(r.exceedsMaxDuration).toBe(true);
  });

  it("should_resume_an_interrupted_upload_from_the_received_offset", async () => {
    const { fake, deps, input } = await setup({ failUploadAfterBytes: 10_000 });
    const r = await judgeVideo(input, deps);
    expect(r.overallScore).toBe(3.92);
    expect(fake.requests.filter((q) => q.path.startsWith("/upload-session")).length).toBe(3); // bytes, query, bytes
  });

  it("should_poll_every_2s_then_every_5s_after_30s", async () => {
    const { deps, input, sleeps } = await setup({ processingPolls: 20 });
    await judgeVideo(input, deps);
    expect(sleeps.slice(0, 15).every((ms) => ms === 2000)).toBe(true);
    expect(sleeps.slice(15)).toContain(5000);
  });
});

describe("judgeVideo transcript (JDG-08)", () => {
  const generateCalls = (fake: FakeGemini) => fake.requests.filter((q) => q.path.endsWith(":generateContent")).length;

  it("should_return_a_transcript_covering_the_whole_video_in_the_same_request_as_the_scores", async () => {
    const { fake, deps, input } = await setup();
    const r = await judgeVideo(input, deps);
    expect(r.outputVersion).toBe(3);
    expect(r.transcript!.map((s) => [s.from, s.to, s.speech])).toEqual([
      ["00:00", "00:24", true], ["00:24", "00:48", true], ["00:48", "01:00", false], ["01:00", "01:24", true], ["01:24", "02:00", true],
    ]);
    expect(transcriptEarlyEnd(r.transcript, r.durationSeconds)).toBeUndefined();
    expect(generateCalls(fake)).toBe(1);
  });

  it("should_ask_for_the_transcript_in_the_request_schema_before_the_observations", async () => {
    const { fake, deps, input } = await setup();
    const sent: string[] = [];
    const capture: typeof fetch = (url, init) => {
      if (String(url).endsWith(":generateContent")) sent.push(String(init?.body));
      return fake.fetch(url, init);
    };
    const provider = new GeminiProvider({ apiKey: "k", model: "m", baseUrl: fake.base, fetch: capture });
    await judgeVideo(input, { ...deps, provider });
    const schema = (JSON.parse(sent[0]!) as { generationConfig: { responseJsonSchema: { properties: object; required: string[] } } }).generationConfig.responseJsonSchema;
    expect(Object.keys(schema.properties)[0]).toBe("transcript");
    expect(schema.required).toContain("transcript");
  });

  it("should_repair_once_then_keep_valid_scores_when_the_transcript_is_still_missing", async () => {
    const { fake, deps, input, steps } = await setup({ scenario: "transcript-missing" });
    const logs: [string, Record<string, unknown>][] = [];
    const r = await judgeVideo(input, { ...deps, log: (e, d) => void logs.push([e, d]) });
    expect(generateCalls(fake)).toBe(2);
    expect(steps).toContainEqual(["Scoring", "Checking scorecard format · retrying once"]);
    expect(r.provenance.repairUsed).toBe(true);
    expect(r.transcript).toBeNull();
    expect(r.overallScore).toBe(3.92);
    expect(JudgeResultSchema.safeParse(r).success).toBe(true);
    expect(logs.find(([e]) => e === "agent.extras_missing")?.[1]).toMatchObject({ fields: ["transcript"] });
  });

  it("should_report_where_a_transcript_ends_early", async () => {
    const { deps, input } = await setup({ scenario: "transcript-early", durationSeconds: 165 });
    const r = await judgeVideo(input, deps);
    expect(r.transcript!.at(-1)!.to).toBe("01:22");
    expect(transcriptEarlyEnd(r.transcript, r.durationSeconds)).toBe(82);
  });

  it("should_mark_a_video_without_speech_and_never_flag_it_as_ending_early", async () => {
    const { deps, input } = await setup({ scenario: "no-speech" });
    const r = await judgeVideo(input, deps);
    expect(r.transcript).toEqual([{ from: "00:00", to: "02:00", speech: false, text: "" }]);
    expect(r.flags!.audio).toBe("missing");
    expect(transcriptEarlyEnd(r.transcript, r.durationSeconds)).toBeUndefined();
  });
});

describe("judgeVideo summary (JDG-09)", () => {
  it("should_return_the_summary_from_the_same_request_as_the_scores", async () => {
    const { fake, deps, input } = await setup();
    const r = await judgeVideo(input, deps);
    expect(r.summary).toMatch(/^Fixture output for automated tests, not a description of the uploaded video\./);
    expect(fake.requests.filter((q) => q.path.endsWith(":generateContent"))).toHaveLength(1);
  });

  it("should_repair_once_then_keep_scores_and_transcript_when_the_summary_is_still_missing", async () => {
    const { deps, input } = await setup({ scenario: "summary-missing" });
    const r = await judgeVideo(input, deps);
    expect(r.provenance.repairUsed).toBe(true);
    expect(r.summary).toBeNull();
    expect(r.transcript).toHaveLength(5);
    expect(r.overallScore).toBe(3.92);
  });
});

describe("judgeVideo failures (RSM-05)", () => {
  async function expectCode(p: Promise<unknown>, code: string, step?: string) {
    const e = await p.then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(JudgeError);
    expect((e as JudgeError).code).toBe(code);
    if (step) expect((e as JudgeError).step).toBe(step);
    expect((e as JudgeError).message).not.toMatch(/timeout/i);
    return e as JudgeError;
  }

  it("should_fail_unprocessable_video_and_still_delete_remote_file", async () => {
    const { fake, deps, input } = await setup({ scenario: "unprocessable" });
    const e = await expectCode(judgeVideo(input, deps), "VIDEO_UNPROCESSABLE", "Processing Video");
    expect(e.message).toBe("Video could not be processed (corrupted or unsupported format)");
    expect(fake.deleted).toHaveLength(1);
  });

  it("should_fail_processing_too_long_after_10_minutes", async () => {
    const { fake, deps, input } = await setup({ processingPolls: 10_000 });
    await expectCode(judgeVideo(input, deps), "PROCESSING_TOO_LONG", "Processing Video");
    expect(fake.deleted).toHaveLength(1);
  });

  it("should_retry_temporary_overload_and_report_attempts", async () => {
    const { deps, input, steps } = await setup({ scenario: "busy-once" });
    const r = await judgeVideo(input, deps);
    expect(r.overallScore).toBe(3.92);
    expect(steps).toContainEqual(["Scoring", "AI service busy · attempt 2 of 4"]);
  });

  it("should_wait_through_6_attempts_when_the_model_is_overloaded_then_fail_without_a_score", async () => {
    const { fake, deps, input, sleeps, steps } = await setup({ scenario: "unavailable" });
    const e = await expectCode(judgeVideo(input, deps), "AI_UNAVAILABLE", "Scoring");
    expect(e.message).toBe("AI service unavailable, retry later");
    expect(fake.requests.filter((q) => q.path.endsWith(":generateContent"))).toHaveLength(6);
    expect(sleeps.slice(-5)).toEqual([5000, 10000, 20000, 40000, 80000]);
    expect(steps).toContainEqual(["Scoring", "AI service busy · attempt 6 of 6"]);
    expect(fake.deleted).toHaveLength(1);
  });

  it("should_give_up_after_4_attempts_on_other_server_errors", async () => {
    const { fake, deps, input, sleeps } = await setup({ scenario: "server-error" });
    await expectCode(judgeVideo(input, deps), "AI_UNAVAILABLE", "Scoring");
    expect(fake.requests.filter((q) => q.path.endsWith(":generateContent"))).toHaveLength(4);
    expect(sleeps.slice(-3)).toEqual([2000, 4000, 8000]);
  });

  it("should_give_up_after_3_unanswered_scoring_requests", async () => {
    const { fake, deps, input } = await setup();
    const real = fake.fetch;
    // Google holds the request: no response until our per-request deadline aborts it.
    const silent: typeof fetch = async (url, init) =>
      String(url).endsWith(":generateContent")
        ? new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("t"), { name: "TimeoutError" }))))
        : real(url, init);
    const provider = new GeminiProvider({ apiKey: "k", model: "m", baseUrl: fake.base, fetch: silent, generateTimeoutMs: 20 });
    const e = await expectCode(judgeVideo(input, { ...deps, provider }), "AI_UNAVAILABLE", "Scoring");
    expect(e.detail).toContain("no response in time");
    expect(fake.deleted).toHaveLength(1);
  });

  it("should_not_retry_an_invalid_api_key_and_not_leak_it", async () => {
    const { fake, deps, input } = await setup({}, "invalid");
    const e = await expectCode(judgeVideo(input, deps), "AI_REJECTED", "Uploading");
    expect(e.message).toBe("AI service rejected the request (check configuration)");
    expect(`${e.message} ${e.detail}`).not.toContain("invalid");
    expect(fake.requests).toHaveLength(1);
  });

  it("should_repair_once_when_output_does_not_match_schema", async () => {
    const { deps, input, steps } = await setup({ scenario: "repair" });
    const r = await judgeVideo(input, deps);
    expect(r.provenance.repairUsed).toBe(true);
    expect(steps).toContainEqual(["Scoring", "Checking scorecard format · retrying once"]);
  });

  it("should_fail_with_incomplete_scorecard_after_failed_repair", async () => {
    const { deps, input } = await setup({ scenario: "incomplete" });
    const e = await expectCode(judgeVideo(input, deps), "INVALID_MODEL_OUTPUT", "Scoring");
    expect(e.message).toBe("The AI returned an incomplete scorecard");
  });

  it("should_report_safety_blocks_without_retrying", async () => {
    const { deps, input } = await setup({ scenario: "blocked" });
    const e = await expectCode(judgeVideo(input, deps), "AI_BLOCKED", "Scoring");
    expect(e.message).toContain("SAFETY");
  });

  it("should_stop_and_clean_up_when_aborted", async () => {
    const { fake, deps, input } = await setup({ processingPolls: 50 });
    const ac = new AbortController();
    const onStep = vi.fn((s: string) => {
      if (s === "Processing Video") ac.abort();
    });
    await expectCode(judgeVideo({ ...input, signal: ac.signal, onStep }, deps), "ABORTED");
    expect(fake.deleted).toHaveLength(1);
  });
});
