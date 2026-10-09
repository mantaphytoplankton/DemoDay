import { z } from "zod";
import { TEAM_STATUSES } from "../status.ts";
import { ERROR_CATALOG, type ErrorCode } from "../errors.ts";
import { JudgeResultSchema } from "./judge-result.ts";
import { FinalSchema, OverridesSchema } from "../scoring.ts";

const DriveId = z.string().regex(/^[A-Za-z0-9_-]{10,128}$/);
const Status = z.enum(TEAM_STATUSES);
const Code = z.enum(Object.keys(ERROR_CATALOG) as [ErrorCode, ...ErrorCode[]]);

export const BATCH_STATUSES = ["Running", "Paused", "Completed", "Interrupted"] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

export const VideoRefSchema = z.object({
  fileId: DriveId,
  name: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  md5Checksum: z.string().optional(),
  modifiedTime: z.string().optional(),
});

export const WarningSchema = z.object({ code: z.literal("multipleVideos"), count: z.number().int(), chosen: z.string() });

export const TeamSummarySchema = z.object({
  categories: z.record(z.string(), z.object({ score: z.number().int().min(1).max(5), remarks: z.string() })),
  overallScore: z.number(),
  overallComments: z.string(),
  durationSeconds: z.number(),
  exceedsMaxDuration: z.boolean(),
  maxDurationSeconds: z.number().int().optional(),
  flags: z
    .object({ noWorkingDemo: z.boolean(), audio: z.enum(["ok", "missing", "unintelligible"]), narratedNotShown: z.boolean(), impactClaimedWithoutHow: z.boolean() })
    .optional(),
  /** JDG-08: end of the transcript in seconds, present only when it ends early. */
  transcriptEarlyEnd: z.number().nonnegative().optional(),
  /** JDG-09: the video summary, for the score table export. Absent when there is none. */
  videoSummary: z.string().optional(),
  rubricVersion: z.string(),
  model: z.string(),
  completedAt: z.string(),
  /** Present once a judge overrides a score (TBL-03). */
  final: FinalSchema.optional(),
});

export const TeamRowSchema = z.object({
  subfolderId: DriveId,
  teamName: z.string(),
  order: z.number().int().nonnegative(),
  status: Status,
  step: z.object({ name: Status, startedAt: z.string(), note: z.string().optional() }).optional(),
  video: VideoRefSchema.optional(),
  warnings: z.array(WarningSchema),
  error: z.object({ code: Code, message: z.string(), step: Status, at: z.string() }).optional(),
  attempts: z.number().int().nonnegative(),
  geminiFileName: z.string().optional(),
  summary: TeamSummarySchema.optional(),
  /** Set by an explicit re-judge: bypasses reuse of the saved result once (RSM-03). */
  forceJudge: z.boolean().optional(),
});

export const BatchManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-f0-9]{16}$/),
  rootFolderId: DriveId,
  folderName: z.string(),
  folderUrl: z.string(),
  status: z.enum(BATCH_STATUSES),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastScanAt: z.string(),
  teams: z.array(TeamRowSchema),
});

/** Full result for one team (TBL-02): batches/{id}/teams/{subfolderId}.json */
export const TeamDetailSchema = z.object({
  schemaVersion: z.literal(1),
  batchId: z.string(),
  subfolderId: DriveId,
  teamName: z.string(),
  video: VideoRefSchema,
  result: JudgeResultSchema,
  completedAt: z.string(),
  overrides: OverridesSchema.optional(),
});

export type TeamRow = z.infer<typeof TeamRowSchema>;
export type BatchManifest = z.infer<typeof BatchManifestSchema>;
export type TeamDetail = z.infer<typeof TeamDetailSchema>;
export type TeamSummary = z.infer<typeof TeamSummarySchema>;

/** Rows without server-only fields (remote file names). */
export type PublicTeamRow = Omit<TeamRow, "geminiFileName">;
export type PublicBatch = Omit<BatchManifest, "teams"> & { teams: PublicTeamRow[] };

export function toPublicRow(r: TeamRow): PublicTeamRow {
  const { geminiFileName: _g, ...rest } = r;
  return rest;
}
export function toPublicBatch(b: BatchManifest): PublicBatch {
  return { ...b, teams: b.teams.map(toPublicRow) };
}

export interface BatchSummary {
  id: string;
  folderName: string;
  status: BatchStatus;
  total: number;
  completed: number;
  failed: number;
  updatedAt: string;
}
export function toBatchSummary(b: BatchManifest): BatchSummary {
  return {
    id: b.id,
    folderName: b.folderName,
    status: b.status,
    total: b.teams.length,
    completed: b.teams.filter((t) => t.status === "Completed").length,
    failed: b.teams.filter((t) => t.status === "Failed").length,
    updatedAt: b.updatedAt,
  };
}
