import { z } from "zod";
import type { RubricMeta } from "../rubric/meta-schema.ts";

export const OBSERVATION_KINDS = ["demonstrated", "claimed"] as const;
export const SEGMENTS = ["context", "demo", "value"] as const;
export const AUDIO = ["ok", "missing", "unintelligible"] as const;

const timestamp = z.string().regex(/^\d{1,2}:[0-5]\d$/, "Timestamp must be mm:ss");

/** JDG-08: the whole video in time order; stretches without speech are segments with speech=false. */
export const transcriptSchema = z
  .array(
    z
      .object({
        from: timestamp,
        to: timestamp,
        speech: z.boolean(),
        text: z.string().max(1500),
      })
      .strict(),
  )
  .min(1)
  .max(150);

export const SUMMARY_MIN_WORDS = 40;
export const SUMMARY_MAX_WORDS = 120;
export const wordCount = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;
/** A score or rating in the summary ("4/5", "3 out of 5", "scored") means it judges instead of describing. */
const SCORE_TALK = /\b\d(?:\.\d+)?\s*(?:\/|out of)\s*5\b|\bscor(?:e|es|ed|ing)\b|\brat(?:ing|ed)\b/i;

/** JDG-09: a neutral description of what the video presents. Over-long summaries are trimmed in post-processing. */
export const summarySchema = z
  .string()
  .max(2000)
  .refine((s) => wordCount(s) >= SUMMARY_MIN_WORDS, `Summary must be at least ${SUMMARY_MIN_WORDS} words`)
  .refine((s) => !SCORE_TALK.test(s), "Summary must describe the video without scores or ratings");

/**
 * Fields that support the scorecard but are not needed to score it. They are validated on their own, so a
 * missing or invalid one never discards valid scores (JDG-08, JDG-09 rules); it is stored as null instead.
 */
export const EXTRA_FIELDS = ["transcript", "summary"] as const;
export type ExtraField = (typeof EXTRA_FIELDS)[number];
const extraSchemas: Record<ExtraField, z.ZodType> = { transcript: transcriptSchema, summary: summarySchema };

/**
 * Model output schema (output version 3), built per evaluation from the rubric (agent-design.md section 7.1).
 * Order matters (Gemini generates properties in schema order): the transcript first, so the model goes through
 * the whole video before judging it; the neutral summary next, before any judgement; then observations, so it
 * writes its evidence before scoring; within a category, remarks before score. Categories are keyed by id so the
 * schema can require every category exactly once.
 */
export function buildModelOutputSchema(meta: RubricMeta) {
  return z.object({ transcript: transcriptSchema, summary: summarySchema, ...buildCoreShape(meta) }).strict();
}

/** The scorecard without the extra fields: what must be valid for a result to be saved. */
export function buildCoreOutputSchema(meta: RubricMeta) {
  return z.object(buildCoreShape(meta)).strict();
}

function buildCoreShape(meta: RubricMeta) {
  const categoryShape: Record<string, z.ZodType<{ remarks: string; score: number }>> = {};
  for (const c of meta.categories) {
    categoryShape[c.id] = z
      .object({
        remarks: z.string().min(40).max(2000),
        score: z.number().int().min(1).max(5),
      })
      .strict();
  }
  return {
    observations: z
      .array(
        z
          .object({
            at: timestamp,
            segment: z.enum(SEGMENTS),
            kind: z.enum(OBSERVATION_KINDS),
            note: z.string().min(5).max(300),
          })
          .strict(),
      )
      .min(1)
      .max(40),
    categories: z.object(categoryShape).strict(),
    overallComments: z.string().min(40).max(3000),
    flags: z
      .object({
        noWorkingDemo: z.boolean(),
        audio: z.enum(AUDIO),
        narratedNotShown: z.boolean(),
        impactClaimedWithoutHow: z.boolean(),
      })
      .strict(),
  };
}

/**
 * Salvage a response that failed the full schema: when the core scorecard is valid, keep it and each extra field
 * that is valid on its own; the others become null. Returns null when the core scorecard itself is invalid.
 */
export function salvageOutput(parsed: unknown, meta: RubricMeta): ModelOutput | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const obj = parsed as Record<string, unknown>;
  const core = Object.fromEntries(Object.entries(obj).filter(([k]) => !(EXTRA_FIELDS as readonly string[]).includes(k)));
  const c = buildCoreOutputSchema(meta).safeParse(core);
  if (!c.success) return null;
  const extras = Object.fromEntries(
    EXTRA_FIELDS.map((f) => {
      const v = extraSchemas[f].safeParse(obj[f]);
      return [f, v.success ? v.data : null];
    }),
  ) as Pick<ModelOutput, ExtraField>;
  return { ...(c.data as Omit<ModelOutput, ExtraField>), ...extras };
}

/** Extra fields a salvaged output is missing (fewer is better). */
export function missingExtras(o: ModelOutput): ExtraField[] {
  return EXTRA_FIELDS.filter((f) => o[f] === null);
}

export interface Observation {
  at: string;
  segment: (typeof SEGMENTS)[number];
  kind: (typeof OBSERVATION_KINDS)[number];
  note: string;
}
export interface ModelFlags {
  noWorkingDemo: boolean;
  audio: (typeof AUDIO)[number];
  narratedNotShown: boolean;
  impactClaimedWithoutHow: boolean;
}
export interface TranscriptSegmentOutput {
  from: string;
  to: string;
  speech: boolean;
  text: string;
}
export type ModelOutput = {
  /** Null when the model's transcript was missing or invalid after the repair turn. */
  transcript: TranscriptSegmentOutput[] | null;
  /** Null when the model's summary was missing or invalid after the repair turn. */
  summary: string | null;
  observations: Observation[];
  categories: Record<string, { remarks: string; score: number }>;
  overallComments: string;
  flags: ModelFlags;
};

const ALLOWED_KEYS = new Set([
  "type", "properties", "required", "items", "enum", "minimum", "maximum",
  "minItems", "maxItems", "minLength", "maxLength", "description", "additionalProperties",
]);

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, clean(pv)]));
    } else if (ALLOWED_KEYS.has(k)) {
      out[k] = clean(v);
    }
  }
  return out;
}

/** JSON Schema for `generationConfig.responseJsonSchema`, limited to widely supported keywords. */
export function toRequestSchema(schema: z.ZodType): object {
  return clean(z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" })) as object;
}

/**
 * The request schema for the model call. Vertex AI rejects the whole request (HTTP 400 INVALID_ARGUMENT) when the
 * transcript array carries a maxItems in the 40-150 range next to the other constraints: constrained decoding has a
 * complexity limit. The transcript's size limit is therefore enforced only when validating the answer.
 */
export function buildRequestSchema(meta: RubricMeta): object {
  const js = toRequestSchema(buildModelOutputSchema(meta)) as { properties: { transcript: Record<string, unknown> } };
  delete js.properties.transcript.maxItems;
  return js;
}
