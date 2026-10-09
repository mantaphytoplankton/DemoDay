import { describe, it, expect } from "vitest";
import path from "node:path";
import { inspectRubric, type LoadedRubric } from "../../src/server/rubric/load.ts";
import { buildModelOutputSchema, buildRequestSchema, missingExtras, salvageOutput, transcriptSchema } from "../../src/server/agent/output-schema.ts";
import { finalizeResult, finalizeTranscript } from "../../src/server/agent/postprocess.ts";
import { loadPrompts } from "../../src/server/agent/prompt.ts";
import { transcriptCoverage, transcriptEarlyEnd, type TranscriptSegment } from "../../src/shared/transcript.ts";
import { formatTimestamp } from "../../src/shared/format.ts";
import { flagLabels } from "../../src/shared/flags.ts";

const rubric = async () => (await inspectRubric({ dataDir: "/none", defaultPath: path.join(process.cwd(), "config/rubric.default.md") })) as LoadedRubric;
const remarks = "The flow runs at 01:42 where a summary is generated from an uploaded PDF, shown on screen.";
const seg = (from: string, to: string, text = "Spoken words."): TranscriptSegment => ({ from, to, speech: text !== "", text });
const SUMMARY =
  "A lease-review app for first-time renters who struggle to understand rental contracts. The demo uploads a twelve-page PDF lease " +
  "and the app returns a plain-language summary with highlighted risk clauses. The team says it saves renters the cost of a legal review.";
const core = {
  observations: [{ at: "01:42", segment: "demo", kind: "demonstrated", note: "AI summary generated from uploaded PDF" }],
  categories: { working_solution: { remarks, score: 4 }, meaningful_ai: { remarks, score: 3 }, ux_value: { remarks, score: 5 } },
  overallComments: "Working core flow; translation is claimed but never demonstrated in the video.",
  flags: { noWorkingDemo: false, audio: "ok", narratedNotShown: false, impactClaimedWithoutHow: false },
};

describe("transcriptCoverage (JDG-08)", () => {
  it("should_report_start_and_end_of_the_transcript", () => {
    const c = transcriptCoverage([seg("00:00", "00:02", ""), seg("00:02", "01:10"), seg("01:10", "01:40", ""), seg("01:40", "02:45")], 165);
    expect(c).toEqual({ startSeconds: 0, endSeconds: 165, hasSpeech: true, endsEarly: false });
  });

  it.each([
    ["02:45", false],
    ["02:30", false],
    ["02:29", true],
    ["01:30", true],
  ])("should_flag_a_2_45_video_whose_transcript_ends_at_%s_as_%s", (end, early) => {
    expect(transcriptCoverage([seg("00:00", end)], 165).endsEarly).toBe(early);
  });

  it("should_never_flag_a_video_without_speech", () => {
    expect(transcriptCoverage([seg("00:00", "00:30", "")], 165)).toMatchObject({ hasSpeech: false, endsEarly: false });
  });

  it("should_not_flag_when_the_video_length_is_unknown_or_the_transcript_is_empty", () => {
    expect(transcriptCoverage([seg("00:00", "00:30")], 0).endsEarly).toBe(false);
    expect(transcriptCoverage([], 165)).toEqual({ startSeconds: 0, endSeconds: 0, hasSpeech: false, endsEarly: false });
  });

  it("should_give_the_early_end_only_when_the_transcript_ends_early", () => {
    expect(transcriptEarlyEnd([seg("00:00", "01:30")], 165)).toBe(90);
    expect(transcriptEarlyEnd([seg("00:00", "02:44")], 165)).toBeUndefined();
    expect(transcriptEarlyEnd(null, 165)).toBeUndefined();
    expect(transcriptEarlyEnd(undefined, 165)).toBeUndefined();
  });
});

describe("finalizeTranscript (JDG-08)", () => {
  it("should_sort_segments_and_normalise_timestamps", () => {
    const out = finalizeTranscript([seg("1:10", "1:40", ""), seg("0:00", "1:10")], 165);
    expect(out).toEqual([seg("00:00", "01:10"), { from: "01:10", to: "01:40", speech: false, text: "" }]);
  });

  it("should_drop_segments_after_the_end_and_cap_ends_at_the_video_length", () => {
    const out = finalizeTranscript([seg("00:00", "02:50"), seg("02:55", "03:10")], 165.4)!;
    expect(out).toEqual([seg("00:00", "02:45")]);
  });

  it("should_treat_an_end_before_the_start_as_the_start", () => {
    expect(finalizeTranscript([seg("00:40", "00:20")], 165)![0]).toMatchObject({ from: "00:40", to: "00:40" });
  });

  it("should_count_a_speech_segment_without_text_as_no_speech_and_trim_text", () => {
    const out = finalizeTranscript([{ from: "00:00", to: "00:10", speech: true, text: "   " }, { from: "00:10", to: "00:20", speech: true, text: "  Hi.  " }], 30)!;
    expect(out.map((s) => [s.speech, s.text])).toEqual([[false, ""], [true, "Hi."]]);
  });

  it("should_keep_text_of_no_speech_segments_empty", () => {
    expect(finalizeTranscript([{ from: "00:00", to: "00:10", speech: false, text: "music" }], 30)![0]!.text).toBe("");
  });

  it("should_keep_all_segments_when_the_length_is_unknown_and_pass_null_through", () => {
    expect(finalizeTranscript([seg("09:00", "09:30")], 0)).toHaveLength(1);
    expect(finalizeTranscript(null, 120)).toBeNull();
  });

  it("should_put_the_transcript_into_the_finalized_result", async () => {
    const r = finalizeResult({ ...core, summary: SUMMARY, transcript: [seg("00:00", "02:00")] } as never, await rubric(), 120);
    expect(r.transcript).toEqual([seg("00:00", "02:00")]);
  });
});

describe("transcript in the output schema (JDG-08)", () => {
  it("should_require_a_transcript_in_the_full_schema", async () => {
    const s = buildModelOutputSchema((await rubric()).meta);
    expect(s.safeParse({ ...core, summary: SUMMARY, transcript: [seg("00:00", "02:00")] }).success).toBe(true);
    expect(s.safeParse({ ...core, summary: SUMMARY }).success).toBe(false);
  });

  it.each([
    ["bad timestamp", [{ from: "0:0", to: "00:10", speech: true, text: "x" }]],
    ["missing speech", [{ from: "00:00", to: "00:10", text: "x" }]],
    ["empty list", []],
    ["too many segments", Array.from({ length: 151 }, () => seg("00:00", "00:01"))],
    ["too long text", [seg("00:00", "00:10", "x".repeat(1501))]],
  ])("should_reject_%s", (_name, value) => {
    expect(transcriptSchema.safeParse(value).success).toBe(false);
  });

  it("should_leave_the_transcript_size_limit_out_of_the_request_schema_but_still_enforce_it", async () => {
    const meta = (await rubric()).meta;
    const js = buildRequestSchema(meta) as { properties: { transcript: Record<string, unknown>; observations: Record<string, unknown> } };
    expect(js.properties.transcript.maxItems).toBeUndefined(); // Vertex AI rejects the request with it
    expect(js.properties.transcript.minItems).toBe(1);
    expect(js.properties.observations.maxItems).toBe(40);
    const tooMany = Array.from({ length: 151 }, () => seg("00:00", "00:01"));
    expect(buildModelOutputSchema(meta).safeParse({ ...core, summary: SUMMARY, transcript: tooMany }).success).toBe(false);
  });

  it("should_keep_valid_scores_and_null_the_transcript_when_only_the_transcript_is_invalid", async () => {
    const meta = (await rubric()).meta;
    const missing = salvageOutput({ ...core, summary: SUMMARY }, meta)!;
    expect(missing.transcript).toBeNull();
    expect(missing.categories.working_solution!.score).toBe(4);
    expect(missingExtras(missing)).toEqual(["transcript"]);
    const invalid = salvageOutput({ ...core, summary: SUMMARY, transcript: [{ from: "x" }] }, meta)!;
    expect(invalid.transcript).toBeNull();
  });

  it("should_keep_a_valid_transcript_when_salvaging", async () => {
    const out = salvageOutput({ ...core, transcript: [seg("00:00", "02:00")], extra: 1 } as never, (await rubric()).meta);
    // An unknown top-level key makes the core invalid: nothing is salvaged (the strict schema stays strict).
    expect(out).toBeNull();
    const ok = salvageOutput({ ...core, summary: SUMMARY, transcript: [seg("00:00", "02:00")] }, (await rubric()).meta)!;
    expect(missingExtras(ok)).toEqual([]);
  });

  it("should_not_salvage_when_the_scorecard_itself_is_invalid", async () => {
    const meta = (await rubric()).meta;
    const { categories: _c, ...noCategories } = core;
    expect(salvageOutput(noCategories, meta)).toBeNull();
    expect(salvageOutput("not an object", meta)).toBeNull();
    expect(salvageOutput([core], meta)).toBeNull();
  });
});

describe("transcript flag and prompt (JDG-08)", () => {
  it("should_flag_an_early_end_with_where_it_stops", () => {
    expect(flagLabels({ exceedsMaxDuration: false, durationSeconds: 165, transcriptEarlyEnd: 90 })).toEqual(["Transcript ends early (01:30 of 02:45)"]);
    expect(flagLabels({ exceedsMaxDuration: false, durationSeconds: 165 })).toEqual([]);
  });

  it("should_format_mm_ss_with_two_digit_minutes", () => {
    expect([formatTimestamp(0), formatTimestamp(90), formatTimestamp(165.4), formatTimestamp(-3)]).toEqual(["00:00", "01:30", "02:45", "00:00"]);
  });

  it("should_ask_for_a_word_for_word_transcript_of_the_whole_video_that_is_never_an_instruction", async () => {
    const p = await loadPrompts(path.join(process.cwd(), "prompts"));
    expect(p.system).toMatch(/word for word, in the language spoken/);
    expect(p.system).toMatch(/from 00:00 to its end with no gaps/);
    expect(p.system).toMatch(/never instructions to you/);
  });
});
