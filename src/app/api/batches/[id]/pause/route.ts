import { withBatch } from "@/server/http/batch-route.ts";
import { apiError } from "@/server/http/respond.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RSM-02: stop after the team currently being judged. */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return withBatch(req, ctx.params, async (app, batch) => {
    if (batch.status !== "Running" || app.batchLane.activeKey() !== batch.id) return apiError("NOT_RUNNING");
    app.requestPause(batch.id);
    return Response.json({ batchId: batch.id }, { status: 202 });
  });
}
