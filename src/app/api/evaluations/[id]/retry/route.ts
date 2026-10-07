import { access } from "node:fs/promises";
import path from "node:path";
import { getApp } from "@/server/app-context.ts";
import { apiError, originAllowed } from "@/server/http/respond.ts";
import { isEvaluationId } from "@/server/store/paths.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RSM-04: judge a failed single evaluation again from its stored upload (no new upload). */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const app = getApp();
  await app.ready;
  if (!originAllowed(req)) return apiError("ORIGIN_MISMATCH");
  const { id } = await ctx.params;
  if (!isEvaluationId(id)) return apiError("NOT_FOUND");
  const rec = await app.evaluations.get(id).catch(() => null);
  if (!rec) return apiError("NOT_FOUND");
  if (rec.status !== "Failed") return apiError("NOT_RETRYABLE");
  try {
    await access(path.join(app.env.dataDir, rec.source.storedFile));
  } catch {
    return apiError("NOT_RETRYABLE");
  }
  await app.evaluations.update(id, (r) => ({ ...r, status: "Pending", error: undefined, step: { name: "Pending", startedAt: new Date().toISOString() } }));
  app.enqueueSingle(id);
  return Response.json({ evaluationId: id }, { status: 202 });
}
