import { t } from "../i18n/t.ts";
import { formatDuration, formatTimestamp } from "./format.ts";

export interface FlagSource {
  exceedsMaxDuration: boolean;
  durationSeconds: number;
  maxDurationSeconds?: number;
  flags?: { noWorkingDemo: boolean; audio: "ok" | "missing" | "unintelligible"; narratedNotShown: boolean; impactClaimedWithoutHow: boolean };
  /** JDG-08: where the transcript ends, when it ends early (see shared/transcript.ts). */
  transcriptEarlyEnd?: number;
}

/** "3-minute" for whole minutes, otherwise m:ss. */
export function limitLabel(seconds: number): string {
  return seconds % 60 === 0 ? `${seconds / 60}-minute` : formatDuration(seconds);
}

/** Data-quality flags as shown to judges (JDG-06 wording). The length flag is computed in code; the rest come from the agent. */
export function flagLabels(r: FlagSource): string[] {
  const out: string[] = [];
  if (r.exceedsMaxDuration) out.push(t("flag.overDuration", { limit: limitLabel(r.maxDurationSeconds ?? 180), duration: formatDuration(r.durationSeconds) }));
  const f = r.flags;
  if (f?.noWorkingDemo) out.push(t("flag.noWorkingDemo"));
  if (f?.audio === "missing") out.push(t("flag.audioMissing"));
  if (f?.audio === "unintelligible") out.push(t("flag.audioUnintelligible"));
  if (f?.narratedNotShown) out.push(t("flag.narratedNotShown"));
  if (f?.impactClaimedWithoutHow) out.push(t("flag.impactClaimed"));
  if (r.transcriptEarlyEnd !== undefined) {
    out.push(t("flag.transcriptEarlyEnd", { end: formatTimestamp(r.transcriptEarlyEnd), duration: formatTimestamp(r.durationSeconds) }));
  }
  return out;
}
