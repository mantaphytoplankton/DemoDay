import { getApp } from "@/server/app-context.ts";
import { apiError } from "@/server/http/respond.ts";
import { withBatch } from "@/server/http/batch-route.ts";
import { deleteRemoteCopies } from "@/server/jobs/cleanup.ts";
import { log } from "@/server/log.ts";
import { isBatchId } from "@/server/store/batches.ts";
import { toPublicBatch } from "@/shared/schemas/batch.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TBL-01: the batch manifest — every team row with status and scores. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isBatchId(id)) return apiError("NOT_FOUND");
  const app = getApp();
  await app.ready;
  const b = await app.batches.get(id).catch(() => null);
  return b ? Response.json(toPublicBatch(b)) : apiError("NOT_FOUND");
}

/** RSM-07: delete a batch and all its team results. Drive files are never touched. Refused while running or queued. */
export function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return withBatch(req, ctx.params, async (app, batch) => {
    if (batch.status === "Running" || app.batchLane.activeKey() === batch.id) return apiError("JOB_ACTIVE");
    app.clearPause(batch.id);
    await app.batches.delete(batch.id);
    await deleteRemoteCopies(app.env, batch.teams.map((t) => t.geminiFileName).filter((n): n is string => Boolean(n)));
    log.info("batch.deleted", { batchId: batch.id, teams: batch.teams.length });
    return new Response(null, { status: 204 });
  });
}
