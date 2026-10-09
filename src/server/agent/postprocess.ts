import type { LoadedRubric } from "../rubric/load.ts";
import { SUMMARY_MAX_WORDS, type ModelFlags, type ModelOutput, type Observation, type TranscriptSegmentOutput } from "./output-schema.ts";
import type { TranscriptSegment } from "../../shared/transcript.ts";

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

export { parseTimestamp } from "../../shared/format.ts";
import { formatTimestamp, parseTimestamp } from "../../shared/format.ts";

/**
 * JDG-08: transcript segments in time order. Segments starting after the end of the video cannot be real and are
 * dropped (like observations); ends are capped at the video length; a "speech" segment without text counts as no speech.
 */
export function finalizeTranscript(segments: TranscriptSegmentOutput[] | null, durationSeconds: number): TranscriptSegment[] | null {
  if (!segments) return null;
  const length = durationSeconds > 0 ? Math.round(durationSeconds) : Infinity;
  return segments
    .map((s) => {
      const from = parseTimestamp(s.from);
      const to = Math.min(Math.max(from, parseTimestamp(s.to)), length);
      const text = s.text.trim();
      const speech = s.speech && text.length > 0;
      return { fromS: from, seg: { from: formatTimestamp(from), to: formatTimestamp(to), speech, text: speech ? text : "" } };
    })
    .filter((x) => x.fromS <= length)
    .sort((a, b) => a.fromS - b.fromS)
    .map((x) => x.seg);
}

/** JDG-09: keep at most `maxWords` words, cut at the last sentence end that fits. */
export function trimToWords(text: string, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  const cut = words.slice(0, maxWords).join(" ");
  const end = cut.lastIndexOf(". ");
  return end > cut.length * 0.5 ? cut.slice(0, end + 1) : cut.replace(/[,;:\s]+$/, "") + "…";
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
  /** Null when the model returned no valid transcript (shown as "Transcript not available for this result"). */
  transcript: TranscriptSegment[] | null;
  /** Null when the model returned no valid summary (shown as "Summary not available for this result"). */
  summary: string | null;
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
    transcript: finalizeTranscript(output.transcript, durationSeconds),
    summary: output.summary === null ? null : trimToWords(output.summary, SUMMARY_MAX_WORDS),
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
