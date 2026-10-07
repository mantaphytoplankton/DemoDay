import type { LoadedRubric } from "../rubric/load.ts";
import type { ModelFlags, ModelOutput, Observation } from "./output-schema.ts";

export const REMARKS_MAX = 1500;
export const COMMENTS_MAX = 2000;

export { weightedOverall } from "../../shared/scoring.ts";
import { weightedOverall } from "../../shared/scoring.ts";

/** Rounded to whole seconds like the displayed length: 3:00 (180.4s) passes, 3:01 (180.6s) is flagged. */
export function exceedsMaxDuration(durationSeconds: number, maxSeconds: number): boolean {
  return Math.round(durationSeconds) > maxSeconds;
}

/** Trim to `max` characters at the last sentence end that fits. */
export function trimAtSentence(text: string, max: number): string {
  const s = text.trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(".\n"), cut.endsWith(".") ? cut.length - 1 : -1);
  return end > max * 0.5 ? cut.slice(0, end + 1) : cut.slice(0, max - 1).trimEnd() + "…";
}

/** "mm:ss" → seconds. */
export function parseTimestamp(at: string): number {
  const [m, s] = at.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

export interface ScoredCategories {
  categories: Record<string, { score: 1 | 2 | 3 | 4 | 5; remarks: string }>;
  overallComments: string;
  overallScore: number;
  weights: Record<string, number>;
  durationSeconds: number;
  exceedsMaxDuration: boolean;
  observations: Observation[];
  flags: ModelFlags;
  /** Observations dropped because their timestamp lies after the end of the video. */
  droppedObservations: number;
}

export function finalizeResult(output: ModelOutput, rubric: LoadedRubric, durationSeconds: number): ScoredCategories {
  const weights = Object.fromEntries(rubric.meta.categories.map((c) => [c.id, c.weight]));
  const categories: ScoredCategories["categories"] = {};
  for (const c of rubric.meta.categories) {
    const o = output.categories[c.id]!;
    categories[c.id] = { score: o.score as 1 | 2 | 3 | 4 | 5, remarks: trimAtSentence(o.remarks, REMARKS_MAX) };
  }
  const scores = Object.fromEntries(Object.entries(categories).map(([id, v]) => [id, v.score]));
  // Observations after the end of the video cannot be real evidence (agent-design.md 6.5 step 3).
  // With an unknown length (0), keep them all.
  const limit = durationSeconds > 0 ? durationSeconds + 1 : Infinity;
  const kept = output.observations.filter((o) => parseTimestamp(o.at) <= limit);
  const observations = kept
    .map((o) => ({ ...o, note: trimAtSentence(o.note, 300) }))
    .sort((a, b) => parseTimestamp(a.at) - parseTimestamp(b.at));
  return {
    observations,
    flags: output.flags,
    droppedObservations: output.observations.length - kept.length,
    categories,
    overallComments: trimAtSentence(output.overallComments, COMMENTS_MAX),
    overallScore: weightedOverall(scores, weights),
    weights,
    durationSeconds,
    exceedsMaxDuration: exceedsMaxDuration(durationSeconds, rubric.meta.maxDurationSeconds),
  };
}
