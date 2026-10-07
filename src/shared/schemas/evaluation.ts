import { z } from "zod";
import { TEAM_STATUSES } from "../status.ts";
import { ERROR_CATALOG, type ErrorCode } from "../errors.ts";
import { JudgeResultSchema } from "./judge-result.ts";
import { FinalSchema, OverridesSchema } from "../scoring.ts";

const StatusSchema = z.enum(TEAM_STATUSES);
const ErrorCodeSchema = z.enum(Object.keys(ERROR_CATALOG) as [ErrorCode, ...ErrorCode[]]);

export const EvaluationRecordSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  source: z.object({
    kind: z.literal("upload"),
    fileName: z.string().min(1).max(255),
    mimeType: z.enum(["video/mp4", "video/quicktime", "video/webm"]),
    sizeBytes: z.number().int().positive(),
    storedFile: z.string().min(1), // relative to the data dir
  }),
  status: StatusSchema,
  step: z.object({ name: StatusSchema, startedAt: z.string(), note: z.string().optional() }).optional(),
  attempts: z.number().int().nonnegative(),
  geminiFileName: z.string().optional(),
  error: z.object({ code: ErrorCodeSchema, message: z.string(), step: StatusSchema, at: z.string() }).optional(),
  result: JudgeResultSchema.optional(),
  /** Human overrides per category (TBL-03) and the resulting final scores. Cleared when re-judged. */
  overrides: OverridesSchema.optional(),
  final: FinalSchema.optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().optional(),
});

export type EvaluationRecord = z.infer<typeof EvaluationRecordSchema>;

/** What the browser receives: no server paths, no remote file names. */
export type PublicEvaluation = Omit<EvaluationRecord, "source" | "geminiFileName"> & {
  source: Omit<EvaluationRecord["source"], "storedFile">;
};

export function toPublic(r: EvaluationRecord): PublicEvaluation {
  const { geminiFileName: _g, source, ...rest } = r;
  const { storedFile: _s, ...src } = source;
  return { ...rest, source: src };
}

export interface EvaluationSummary {
  id: string;
  fileName: string;
  status: EvaluationRecord["status"];
  overallScore?: number;
  updatedAt: string;
}

export function toSummary(r: EvaluationRecord): EvaluationSummary {
  return { id: r.id, fileName: r.source.fileName, status: r.status, overallScore: r.result?.overallScore, updatedAt: r.updatedAt };
}
