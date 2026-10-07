import { getApp } from "@/server/app-context.ts";
import { apiError, originAllowed } from "@/server/http/respond.ts";
import { deleteRemoteCopies } from "@/server/jobs/cleanup.ts";
import { isInProgress } from "@/shared/status.ts";
import { log } from "@/server/log.ts";
import { isEvaluationId } from "@/server/store/paths.ts";
import { toPublic } from "@/shared/schemas/evaluation.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isEvaluationId(id)) return apiError("NOT_FOUND");
  const app = getApp();
  await app.ready;
  const rec = await app.evaluations.get(id).catch(() => null);
  if (!rec) return apiError("NOT_FOUND");
  return Response.json(toPublic(rec));
}

/** RSM-07: delete a single evaluation and its stored video. Refused while it is queued or being processed. */
export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const app = getApp();
  await app.ready;
  if (!originAllowed(req)) return apiError("ORIGIN_MISMATCH");
  const { id } = await ctx.params;
  if (!isEvaluationId(id)) return apiError("NOT_FOUND");
  const rec = await app.evaluations.get(id).catch(() => null);
  if (!rec) return apiError("NOT_FOUND");
  if (rec.status === "Pending" || isInProgress(rec.status) || app.singleLane.activeKey() === id) return apiError("JOB_ACTIVE");
  await app.evaluations.delete(rec);
  await deleteRemoteCopies(app.env, rec.geminiFileName ? [rec.geminiFileName] : []);
  log.info("evaluation.deleted", { jobId: id });
  return new Response(null, { status: 204 });
}
