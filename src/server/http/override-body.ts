import { z } from "zod";
import { apiError } from "./respond.ts";
import { validateOverride } from "../../shared/scoring.ts";

const Body = z.union([
  z.object({ categoryId: z.string().min(1), remove: z.literal(true) }),
  z.object({ categoryId: z.string().min(1), score: z.unknown(), note: z.unknown() }),
]);

export type OverrideChange = { categoryId: string; remove: true } | { categoryId: string; score: number; note: string };

/** Parse and validate an override request; returns the change or an API error response. */
export async function readOverride(req: Request, categoryIds: string[]): Promise<OverrideChange | Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !categoryIds.includes(parsed.data.categoryId)) return apiError("VALIDATION_FAILED");
  if ("remove" in parsed.data) return parsed.data;
  const code = validateOverride(parsed.data.score, parsed.data.note);
  if (code) return apiError(code);
  return { categoryId: parsed.data.categoryId, score: parsed.data.score as number, note: (parsed.data.note as string).trim() };
}

export function applyChange<T extends Record<string, { score: number; note: string; at: string }>>(current: T | undefined, change: OverrideChange): T {
  const next = { ...(current ?? {}) } as T;
  if ("remove" in change) delete next[change.categoryId];
  else (next as Record<string, unknown>)[change.categoryId] = { score: change.score, note: change.note, at: new Date().toISOString() };
  return next;
}
