import { z } from "zod";
import type { RubricMeta } from "../rubric/meta-schema.ts";

export const OBSERVATION_KINDS = ["demonstrated", "claimed"] as const;
export const SEGMENTS = ["context", "demo", "value"] as const;
export const AUDIO = ["ok", "missing", "unintelligible"] as const;

/**
 * Model output schema (output version 2), built per evaluation from the rubric (agent-design.md section 7.1).
 * Order matters (Gemini generates properties in schema order): observations first, so the model writes its
 * evidence before scoring; within a category, remarks before score. Categories are keyed by id so the
 * schema can require every category exactly once.
 */
export function buildModelOutputSchema(meta: RubricMeta) {
  const categoryShape: Record<string, z.ZodType<{ remarks: string; score: number }>> = {};
  for (const c of meta.categories) {
    categoryShape[c.id] = z
      .object({
        remarks: z.string().min(40).max(2000),
        score: z.number().int().min(1).max(5),
      })
      .strict();
  }
  return z
    .object({
      observations: z
        .array(
          z
            .object({
              at: z.string().regex(/^\d{1,2}:[0-5]\d$/, "Timestamp must be mm:ss"),
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
    })
    .strict();
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
export type ModelOutput = {
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
