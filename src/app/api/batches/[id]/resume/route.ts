import { withBatch } from "@/server/http/batch-route.ts";
import { apiError } from "@/server/http/respond.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RSM-02: continue a paused or interrupted batch from its first Pending team. */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return withBatch(req, ctx.params, async (app, batch) => {
    const active = app.batchLane.activeKey();
    if (active === batch.id) {
      app.clearPause(batch.id);
      return Response.json({ batchId: batch.id }, { status: 202 });
    }
    if (active) return apiError("BATCH_ALREADY_RUNNING");
    if (!batch.teams.some((t) => t.status === "Pending")) return apiError("NOT_RESUMABLE");
    app.clearPause(batch.id);
    app.enqueueBatch(batch.id);
    return Response.json({ batchId: batch.id }, { status: 202 });
  });
}
