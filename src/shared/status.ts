export const TEAM_STATUSES = ["Pending", "Downloading", "Uploading", "Processing Video", "Scoring", "Completed", "Failed"] as const;
export type TeamStatus = (typeof TEAM_STATUSES)[number];

export const IN_PROGRESS: readonly TeamStatus[] = ["Downloading", "Uploading", "Processing Video", "Scoring"];

/** Allowed status changes (app-design.md section 7.2). */
const NEXT: Record<TeamStatus, readonly TeamStatus[]> = {
  Pending: ["Downloading", "Uploading", "Failed"],
  // Completed directly from Downloading when a saved result for the same video is reused (RSM-01/03).
  Downloading: ["Uploading", "Completed", "Failed", "Pending"],
  Uploading: ["Processing Video", "Failed", "Pending"],
  "Processing Video": ["Scoring", "Failed", "Pending"],
  Scoring: ["Completed", "Failed", "Pending"],
  Completed: ["Pending"],
  Failed: ["Pending"],
};

export function canTransition(from: TeamStatus, to: TeamStatus): boolean {
  return from === to || NEXT[from].includes(to);
}

export function isInProgress(s: TeamStatus): boolean {
  return IN_PROGRESS.includes(s);
}

/** Steps shown in the single-evaluation tracker. */
export const SINGLE_STEPS = ["Uploading", "Processing Video", "Scoring", "Completed"] as const;
