import { describe, it, expect } from "vitest";
import path from "node:path";
import { inspectRubric, type LoadedRubric } from "../../src/server/rubric/load.ts";
import { buildModelOutputSchema, toRequestSchema } from "../../src/server/agent/output-schema.ts";
import { finalizeResult, parseTimestamp } from "../../src/server/agent/postprocess.ts";
import { loadPrompts } from "../../src/server/agent/prompt.ts";
import type { ModelOutput } from "../../src/server/agent/output-schema.ts";

const rubric = async () => (await inspectRubric({ dataDir: "/none", defaultPath: path.join(process.cwd(), "config/rubric.default.md") })) as LoadedRubric;
const remarks = "The flow runs at 01:42 where a summary is generated from an uploaded PDF, shown on screen.";
const output = (): ModelOutput => ({
  observations: [
    { at: "00:12", segment: "context", kind: "demonstrated", note: "Problem and audience stated" },
    { at: "01:42", segment: "demo", kind: "demonstrated", note: "AI summary generated from uploaded PDF" },
    { at: "02:30", segment: "value", kind: "claimed", note: "Translates into 40 languages (not shown)" },
  ],
  categories: { working_solution: { remarks, score: 4 }, meaningful_ai: { remarks, score: 3 }, ux_value: { remarks, score: 5 } },
  overallComments: "Working core flow; translation is claimed but never demonstrated in the video.",
  flags: { noWorkingDemo: false, audio: "ok", narratedNotShown: true, impactClaimedWithoutHow: false },
});

describe("output schema v2 (JDG-05, JDG-06)", () => {
  it("should_require_observations_and_flags", async () => {
    const s = buildModelOutputSchema((await rubric()).meta);
    expect(s.safeParse(output()).success).toBe(true);
    const { observations: _o, ...noObs } = output();
    expect(s.safeParse(noObs).success).toBe(false);
    const { flags: _f, ...noFlags } = output();
    expect(s.safeParse(noFlags).success).toBe(false);
  });

  it.each(["1:42:00", "142", "aa:bb", "01:7"])("should_reject_timestamp_%s", async (at) => {
    const bad = output();
    bad.observations[0]!.at = at;
    expect(buildModelOutputSchema((await rubric()).meta).safeParse(bad).success).toBe(false);
  });

  it("should_reject_unknown_kinds_segments_and_audio_values", async () => {
    const s = buildModelOutputSchema((await rubric()).meta);
    const a = output(); (a.observations[0] as { kind: string }).kind = "rumoured";
    const b = output(); (b.observations[0] as { segment: string }).segment = "intro";
    const c = output(); (c.flags as { audio: string }).audio = "quiet";
    expect([a, b, c].map((x) => s.safeParse(x).success)).toEqual([false, false, false]);
  });

  it("should_ask_for_evidence_before_scores_in_the_request_schema", async () => {
    const js = toRequestSchema(buildModelOutputSchema((await rubric()).meta)) as { properties: object; required: string[] };
    expect(Object.keys(js.properties)).toEqual(["observations", "categories", "overallComments", "flags"]);
    expect(js.required).toEqual(["observations", "categories", "overallComments", "flags"]);
  });
});

describe("finalizeResult with evidence", () => {
  it("should_keep_observations_within_the_video_and_drop_impossible_timestamps", async () => {
    const r = finalizeResult(output(), await rubric(), 120);
    expect(r.observations!.map((o) => o.at)).toEqual(["00:12", "01:42"]);
    expect(r.droppedObservations).toBe(1);
  });

  it("should_sort_observations_by_time", async () => {
    const o = output();
    o.observations.reverse();
    expect(finalizeResult(o, await rubric(), 200).observations!.map((x) => x.at)).toEqual(["00:12", "01:42", "02:30"]);
  });

  it("should_pass_model_flags_through_and_compute_the_duration_flag_in_code", async () => {
    const r = finalizeResult(output(), await rubric(), 204);
    expect(r.flags).toEqual({ noWorkingDemo: false, audio: "ok", narratedNotShown: true, impactClaimedWithoutHow: false });
    expect(r.exceedsMaxDuration).toBe(true);
  });

  it.each([["00:00", 0], ["01:42", 102], ["3:24", 204], ["59:59", 3599]])("should_parse_%s", (at, sec) => {
    expect(parseTimestamp(at)).toBe(sec);
  });
});

describe("prompt asks for evidence (JDG-05)", () => {
  it("should_instruct_observations_with_kinds_segments_and_cited_timestamps", async () => {
    const p = await loadPrompts();
    expect(p.system).toMatch(/observations/i);
    expect(p.system).toMatch(/"demonstrated"/);
    expect(p.system).toMatch(/"claimed"/);
    expect(p.system).toMatch(/context.*demo.*value/s);
    expect(p.system).toMatch(/flags/i);
  });
});
