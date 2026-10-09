import { describe, it, expect } from "vitest";
import path from "node:path";
import { inspectRubric, type LoadedRubric } from "../../src/server/rubric/load.ts";
import { missingExtras, salvageOutput, summarySchema, wordCount } from "../../src/server/agent/output-schema.ts";
import { finalizeResult, trimToWords } from "../../src/server/agent/postprocess.ts";
import { loadPrompts } from "../../src/server/agent/prompt.ts";
import { buildScoresCsv } from "../../src/server/csv/scores-csv.ts";
import type { BatchManifest } from "../../src/shared/schemas/batch.ts";

const rubric = async () => (await inspectRubric({ dataDir: "/none", defaultPath: path.join(process.cwd(), "config/rubric.default.md") })) as LoadedRubric;
const SUMMARY =
  "A lease-review app for first-time renters who struggle to understand rental contracts. The demo uploads a twelve-page PDF lease " +
  "and the app returns a plain-language summary with highlighted risk clauses. The team says it saves renters the cost of a legal review.";
const remarks = "The flow runs at 01:42 where a summary is generated from an uploaded PDF, shown on screen.";
const output = {
  transcript: [{ from: "00:00", to: "02:00", speech: true, text: "We built a lease summariser." }],
  summary: SUMMARY,
  observations: [{ at: "01:42", segment: "demo", kind: "demonstrated", note: "AI summary generated from uploaded PDF" }],
  categories: { working_solution: { remarks, score: 4 }, meaningful_ai: { remarks, score: 3 }, ux_value: { remarks, score: 5 } },
  overallComments: "Working core flow; translation is claimed but never demonstrated in the video.",
  flags: { noWorkingDemo: false, audio: "ok", narratedNotShown: false, impactClaimedWithoutHow: false },
};
const sentence = (i: number) => `Sentence number ${i} has exactly eight words here.`;

describe("summary schema (JDG-09)", () => {
  it("should_accept_a_neutral_summary_of_at_least_40_words", () => {
    expect(wordCount(SUMMARY)).toBeGreaterThanOrEqual(40);
    expect(summarySchema.safeParse(SUMMARY).success).toBe(true);
  });

  it("should_reject_a_summary_under_40_words", () => {
    const r = summarySchema.safeParse("A lease app for renters. The demo shows a summary.");
    expect(r.success).toBe(false);
    expect(r.error!.issues[0]!.message).toBe("Summary must be at least 40 words");
  });

  it.each(["It deserves 4/5 for the demo.", "Working Solution scored highly.", "Overall 3.5 out of 5.", "Our rating is high."])(
    "should_reject_scores_or_ratings_in_the_summary: %s",
    (judging) => {
      const r = summarySchema.safeParse(`${SUMMARY} ${judging}`);
      expect(r.success).toBe(false);
      expect(r.error!.issues.map((i) => i.message)).toContain("Summary must describe the video without scores or ratings");
    },
  );

  it("should_keep_valid_scores_and_transcript_and_null_an_invalid_summary", async () => {
    const out = salvageOutput({ ...output, summary: "Too short." }, (await rubric()).meta)!;
    expect(out.summary).toBeNull();
    expect(out.transcript).toHaveLength(1);
    expect(missingExtras(out)).toEqual(["summary"]);
  });
});

describe("summary post-processing (JDG-09)", () => {
  it("should_trim_a_summary_over_120_words_at_a_sentence_end", () => {
    const long = Array.from({ length: 17 }, (_, i) => sentence(i + 1)).join(" "); // 136 words
    const out = trimToWords(long, 120);
    expect(wordCount(out)).toBeLessThanOrEqual(120);
    expect(out.endsWith("here.")).toBe(true);
  });

  it("should_cut_mid_sentence_with_an_ellipsis_only_when_no_sentence_end_fits", () => {
    const out = trimToWords(`${"word ".repeat(130).trim()}.`, 120);
    expect(wordCount(out)).toBe(120);
    expect(out.endsWith("…")).toBe(true);
  });

  it("should_leave_a_summary_within_the_limit_unchanged_apart_from_spacing", () => {
    expect(trimToWords(`  ${SUMMARY.replace(/ /g, "  ")} `, 120)).toBe(SUMMARY);
  });

  it("should_put_the_summary_into_the_finalized_result_and_pass_null_through", async () => {
    const r = await rubric();
    expect(finalizeResult(output as never, r, 120).summary).toBe(SUMMARY);
    expect(finalizeResult({ ...output, summary: null } as never, r, 120).summary).toBeNull();
  });
});

describe("summary prompt and export (JDG-09)", () => {
  it("should_ask_for_a_described_not_judged_summary_in_order", async () => {
    const p = await loadPrompts(path.join(process.cwd(), "prompts"));
    expect(p.system).toMatch(/40 to 120 words of plain English, whatever language is spoken/);
    expect(p.system).toMatch(/the problem and the target user, what the demo shows, and the value the team claims/);
    expect(p.system).toMatch(/Describe; do not judge/);
    expect(p.system).toMatch(/only claimed as claimed/);
    expect(p.system).toMatch(/If no working product is shown/);
  });

  it("should_export_the_video_summary_in_one_cell", () => {
    const at = "2026-10-09T10:00:00.000Z";
    const batch: BatchManifest = {
      schemaVersion: 1, id: "0123456789abcdef", rootFolderId: "fixtureHackathonRoot01", folderName: "F", folderUrl: "u",
      status: "Completed", createdAt: at, updatedAt: at, lastScanAt: at,
      teams: [{
        subfolderId: "teamFolder00000001", teamName: "Team A", order: 0, status: "Completed", warnings: [], attempts: 1,
        summary: {
          categories: { working_solution: { score: 4, remarks: "r" } }, overallScore: 4, overallComments: "c", durationSeconds: 120,
          exceedsMaxDuration: false, rubricVersion: "v", model: "m", completedAt: at, videoSummary: `${SUMMARY}\nSecond line, with "quotes".`,
        },
      }],
    };
    const csv = buildScoresCsv(batch, [{ id: "working_solution", name: "Working Solution" }]);
    expect(csv.split("\r\n")[0]).toContain('"Status reason","Video summary","Working Solution AI score"');
    expect(csv).toContain(`"${SUMMARY}\nSecond line, with ""quotes""."`);
  });
});
