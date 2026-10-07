import { z } from "zod";
import type { ErrorCode } from "./errors.ts";

/** Overall = Σ score·weight / Σ weight, 2 decimals. Computed in code, never by the model (ADR-003). */
export function weightedOverall(scores: Record<string, number>, weights: Record<string, number>): number {
  let s = 0;
  let w = 0;
  for (const [id, weight] of Object.entries(weights)) {
    const score = scores[id];
    if (score === undefined) throw new Error(`Missing score for category ${id}`);
    s += score * weight;
    w += weight;
  }
  return Math.round((100 * s) / w) / 100;
}

/** One human override per category (TBL-03). The AI score is never changed. */
export const OverrideSchema = z.object({ score: z.number().int().min(1).max(5), note: z.string().min(1).max(1000), at: z.string() });
export const OverridesSchema = z.record(z.string(), OverrideSchema);
export type Override = z.infer<typeof OverrideSchema>;
export type Overrides = z.infer<typeof OverridesSchema>;

export const FinalSchema = z.object({
  categories: z.record(z.string(), z.number().int()),
  overallScore: z.number(),
  overridden: z.boolean(),
});
export type FinalScores = z.infer<typeof FinalSchema>;

interface ScoredResult {
  categories: Record<string, { score: number }>;
  weights: Record<string, number>;
}

/** Final scores = AI scores with the judges' overrides applied; overall recomputed with the rubric weights. */
export function computeFinal(result: ScoredResult, overrides: Overrides): FinalScores {
  let overridden = false;
  const categories: Record<string, number> = {};
  for (const [id, v] of Object.entries(result.categories)) {
    const o = overrides[id];
    if (o) overridden = true;
    categories[id] = o ? o.score : v.score;
  }
  return { categories, overallScore: weightedOverall(categories, result.weights), overridden };
}

/** Returns the error code for an invalid override, or null (wording in stories.md TBL-03). */
export function validateOverride(score: unknown, note: unknown): ErrorCode | null {
  if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) return "OVERRIDE_SCORE_INVALID";
  if (typeof note !== "string" || note.trim() === "") return "OVERRIDE_NOTE_REQUIRED";
  return null;
}
