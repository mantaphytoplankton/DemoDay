import { z } from "zod";

/** Agent output as stored and shown (agent-design.md section 7.3). */
export const JudgeResultSchema = z.object({
  outputVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /**
   * Version 3 (S-5, JDG-08): the whole video in time order. Absent on earlier results ("judged before this
   * feature"); null when the model returned no valid transcript ("not available for this result").
   */
  transcript: z
    .array(z.object({ from: z.string(), to: z.string(), speech: z.boolean(), text: z.string() }))
    .nullable()
    .optional(),
  /** Version 3 (S-5, JDG-09): neutral summary of what the video presents. Absent / null as for the transcript. */
  summary: z.string().nullable().optional(),
  categories: z.record(z.string(), z.object({ score: z.number().int().min(1).max(5), remarks: z.string() })),
  overallComments: z.string(),
  overallScore: z.number().min(1).max(5),
  weights: z.record(z.string(), z.number().int().positive()),
  durationSeconds: z.number().nonnegative(),
  exceedsMaxDuration: z.boolean(),
  /** Version 2 (S-4): timestamped evidence and data-quality flags. Absent on version-1 results. */
  observations: z
    .array(z.object({ at: z.string(), segment: z.enum(["context", "demo", "value"]), kind: z.enum(["demonstrated", "claimed"]), note: z.string() }))
    .optional(),
  flags: z
    .object({ noWorkingDemo: z.boolean(), audio: z.enum(["ok", "missing", "unintelligible"]), narratedNotShown: z.boolean(), impactClaimedWithoutHow: z.boolean() })
    .optional(),
  rubric: z.object({
    maxDurationSeconds: z.number().int(),
    categories: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        short: z.string(),
        weight: z.number().int(),
        tiers: z.object({ "1": z.string(), "3": z.string(), "5": z.string() }),
      }),
    ),
  }),
  provenance: z.object({
    model: z.string(),
    /** Which API scored the video; absent on results from before JDG-07 (Gemini API). */
    provider: z.enum(["gemini-api", "vertex"]).optional(),
    modelVersion: z.string().optional(),
    promptVersion: z.string(),
    rubricVersion: z.string(),
    rubricSource: z.enum(["active", "default"]),
    temperature: z.number(),
    videoFps: z.number(),
    thinkingBudget: z.number(),
    usage: z.object({ promptTokens: z.number(), outputTokens: z.number(), thoughtsTokens: z.number(), totalTokens: z.number() }),
    stepDurationsMs: z.object({ upload: z.number(), processing: z.number(), scoring: z.number() }),
    repairUsed: z.boolean(),
    droppedObservations: z.number().int().nonnegative().optional(),
    startedAt: z.string(),
    finishedAt: z.string(),
  }),
});

export type JudgeResult = z.infer<typeof JudgeResultSchema>;
