import { describe, it, expect } from "vitest";
import { computeFinal, validateOverride } from "../../src/shared/scoring.ts";

const result = {
  categories: { working_solution: { score: 4, remarks: "" }, meaningful_ai: { score: 3, remarks: "" }, ux_value: { score: 5, remarks: "" } },
  weights: { working_solution: 25, meaningful_ai: 20, ux_value: 15 },
  overallScore: 3.92,
};

describe("computeFinal (TBL-03)", () => {
  it("should_equal_the_ai_scores_without_overrides", () => {
    expect(computeFinal(result, {})).toEqual({ categories: { working_solution: 4, meaningful_ai: 3, ux_value: 5 }, overallScore: 3.92, overridden: false });
  });
  it("should_apply_an_override_and_recompute_the_weighted_overall", () => {
    const f = computeFinal(result, { working_solution: { score: 2, note: "Demo used hardcoded output", at: "t" } });
    expect(f).toEqual({ categories: { working_solution: 2, meaningful_ai: 3, ux_value: 5 }, overallScore: 3.08, overridden: true });
  });
  it("should_ignore_overrides_for_categories_not_in_the_result", () => {
    expect(computeFinal(result, { old_category: { score: 1, note: "x", at: "t" } }).overridden).toBe(false);
  });
});

describe("validateOverride (TBL-03 messages)", () => {
  it.each([
    [{ score: 2, note: "Demo used hardcoded output" }, null],
    [{ score: 2, note: "   " }, "OVERRIDE_NOTE_REQUIRED"],
    [{ score: 6, note: "x" }, "OVERRIDE_SCORE_INVALID"],
    [{ score: 0, note: "x" }, "OVERRIDE_SCORE_INVALID"],
    [{ score: 2.5, note: "x" }, "OVERRIDE_SCORE_INVALID"],
  ])("should_validate_%j_as_%s", (input, code) => {
    expect(validateOverride(input.score, input.note)).toBe(code);
  });
});
