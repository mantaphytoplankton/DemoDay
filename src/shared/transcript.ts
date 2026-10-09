import { parseTimestamp } from "./format.ts";

/** One stretch of the video: what was said, or a stretch without speech (JDG-08). */
export interface TranscriptSegment {
  from: string;
  to: string;
  speech: boolean;
  text: string;
}

/** A transcript ending more than this before the end of the video is flagged (JDG-08: 02:30 of 02:45 passes, 02:29 does not). */
export const EARLY_END_TOLERANCE_SECONDS = 15;

export interface TranscriptCoverage {
  startSeconds: number;
  endSeconds: number;
  hasSpeech: boolean;
  /** True when the transcript has speech and stops early; a video without speech is never flagged. */
  endsEarly: boolean;
}

export function transcriptCoverage(segments: TranscriptSegment[], durationSeconds: number): TranscriptCoverage {
  const hasSpeech = segments.some((s) => s.speech);
  if (segments.length === 0) return { startSeconds: 0, endSeconds: 0, hasSpeech, endsEarly: false };
  const startSeconds = Math.min(...segments.map((s) => parseTimestamp(s.from)));
  const endSeconds = Math.max(...segments.map((s) => parseTimestamp(s.to)));
  const endsEarly = hasSpeech && durationSeconds > 0 && Math.round(durationSeconds) - endSeconds > EARLY_END_TOLERANCE_SECONDS;
  return { startSeconds, endSeconds, hasSpeech, endsEarly };
}

/** End of the transcript in seconds when it ends early, otherwise undefined (input for the data-quality flags). */
export function transcriptEarlyEnd(segments: TranscriptSegment[] | null | undefined, durationSeconds: number): number | undefined {
  if (!segments) return undefined;
  const c = transcriptCoverage(segments, durationSeconds);
  return c.endsEarly ? c.endSeconds : undefined;
}
