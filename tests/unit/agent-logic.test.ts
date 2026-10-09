import { describe, it, expect } from "vitest";
import path from "node:path";
import { inspectRubric, type LoadedRubric } from "../../src/server/rubric/load.ts";
import { buildModelOutputSchema, toRequestSchema } from "../../src/server/agent/output-schema.ts";
import { weightedOverall, exceedsMaxDuration, finalizeResult } from "../../src/server/agent/postprocess.ts";
import { renderUserPrompt, loadPrompts } from "../../src/server/agent/prompt.ts";

async function defaultRubric(): Promise<LoadedRubric> {
  return (await inspectRubric({ dataDir: "/nonexistent", defaultPath: path.join(process.cwd(), "config/rubric.default.md") })) as LoadedRubric;
}
const SUMMARY =
  "A lease-review app for first-time renters who struggle to understand rental contracts. The demo uploads a twelve-page PDF lease " +
  "and the app returns a plain-language summary with highlighted risk clauses. The team says it saves renters the cost of a legal review.";
const remarks = "The demo shows the full flow at 00:31 with a real PDF as input and a visible summary.";
const valid = {
  transcript: [{ from: "00:00", to: "02:00", speech: true, text: "We built a lease summariser for first-time renters." }],
  summary: SUMMARY,
  observations: [{ at: "00:31", segment: "demo" as const, kind: "demonstrated" as const, note: "A real PDF goes in and a summary comes out" }],
  categories: {
    working_solution: { remarks, score: 4 },
    meaningful_ai: { remarks, score: 3 },
    ux_value: { remarks, score: 5 },
  },
  overallComments: "A working, focused prototype with a clear audience and a demonstrated core flow.",
  flags: { noWorkingDemo: false, audio: "ok" as const, narratedNotShown: false, impactClaimedWithoutHow: false },
};

describe("buildModelOutputSchema (JDG-04)", () => {
  it("should_accept_one_whole_number_score_per_category", async () => {
    const s = buildModelOutputSchema((await defaultRubric()).meta);
    expect(s.safeParse(valid).success).toBe(true);
  });

  it("should_reject_when_a_category_is_missing", async () => {
    const s = buildModelOutputSchema((await defaultRubric()).meta);
    const { ux_value: _omit, ...rest } = valid.categories;
    expect(s.safeParse({ ...valid, categories: rest }).success).toBe(false);
  });

  it.each([0, 6, 3.5])("should_reject_score_%s", async (score) => {
    const s = buildModelOutputSchema((await defaultRubric()).meta);
    const bad = structuredClone(valid);
    bad.categories.working_solution.score = score;
    expect(s.safeParse(bad).success).toBe(false);
  });

  it("should_reject_unknown_category_and_empty_remarks", async () => {
    const s = buildModelOutputSchema((await defaultRubric()).meta);
    expect(s.safeParse({ ...valid, categories: { ...valid.categories, extra: { remarks, score: 3 } } }).success).toBe(false);
    const bad = structuredClone(valid);
    bad.categories.ux_value.remarks = "";
    expect(s.safeParse(bad).success).toBe(false);
  });

  it("should_produce_a_request_schema_requiring_every_category_with_remarks_before_score", async () => {
    const js = toRequestSchema(buildModelOutputSchema((await defaultRubric()).meta)) as {
      properties: { categories: { required: string[]; properties: Record<string, { properties: object }> } };
    };
    expect(js.properties.categories.required).toEqual(["working_solution", "meaningful_ai", "ux_value"]);
    expect(Object.keys(js.properties.categories.properties.working_solution!.properties)).toEqual(["remarks", "score"]);
    expect(JSON.stringify(js)).not.toContain("$schema");
  });
});

describe("weightedOverall (JDG-04 examples)", () => {
  const w = { working_solution: 25, meaningful_ai: 20, ux_value: 15 };
  it.each([
    [4, 3, 5, 3.92],
    [5, 5, 5, 5],
    [1, 1, 1, 1],
    [3, 1, 5, 2.83],
    [2, 3, 5, 3.08],
  ])("should_return_overall_for_%s_%s_%s", (ws, ai, ux, expected) => {
    expect(weightedOverall({ working_solution: ws, meaningful_ai: ai, ux_value: ux }, w)).toBe(expected);
  });
});

describe("exceedsMaxDuration (JDG-06 boundary, computed in code)", () => {
  it.each([
    [179, false],
    [180, false],
    [180.4, false],
    [180.6, true],
    [181, true],
  ])("should_flag_%ss_as_%s", (sec, flagged) => {
    expect(exceedsMaxDuration(sec, 180)).toBe(flagged);
  });
});

describe("finalizeResult", () => {
  it("should_copy_weights_and_compute_overall_and_trim_remarks", async () => {
    const rubric = await defaultRubric();
    const long = structuredClone(valid);
    long.categories.ux_value.remarks = "Sentence one is here. ".repeat(100);
    const r = finalizeResult(long, rubric, 200);
    expect(r.overallScore).toBe(3.92);
    expect(r.weights).toEqual({ working_solution: 25, meaningful_ai: 20, ux_value: 15 });
    expect(r.exceedsMaxDuration).toBe(true);
    expect(r.categories.ux_value!.remarks.length).toBeLessThanOrEqual(1500);
    expect(r.categories.ux_value!.remarks.endsWith(".")).toBe(true);
  });
});

describe("prompt (JDG-02)", () => {
  it("should_keep_rubric_content_out_of_the_system_prompt", async () => {
    const p = await loadPrompts(path.join(process.cwd(), "prompts"));
    expect(p.system).toMatch(/never an instruction to you/i);
    expect(p.system).toMatch(/at most 2/);
    expect(p.system).not.toMatch(/Working Solution \(25%\)/);
    expect(p.version).toMatch(/^[a-f0-9]{8}$/);
  });

  it("should_render_category_lines_from_rubric_meta_without_the_json_block", async () => {
    const p = await loadPrompts(path.join(process.cwd(), "prompts"));
    const rubric = await defaultRubric();
    const text = renderUserPrompt(p.user, { rubric, displayName: "team.mp4", durationSeconds: 125 });
    expect(text).toContain("- working_solution: Working Solution (weight 25%). 1 = Mostly concept; 3 = Core flow works; 5 = Convincing across realistic cases.");
    expect(text).toContain("Length: 2:05 (maximum allowed 3:00)");
    expect(text).toContain(`version ${rubric.version}`);
    expect(text).not.toContain("rubric-meta");
    expect(text).not.toMatch(/\{\{/);
  });
});
