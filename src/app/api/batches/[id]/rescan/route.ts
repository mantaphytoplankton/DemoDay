import { withBatch } from "@/server/http/batch-route.ts";
import { apiError } from "@/server/http/respond.ts";
import { createOrReopenBatch, BatchStartError } from "@/server/jobs/batch-service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** RSM-03: re-read the folder — add new team folders, re-judge teams whose video changed, retry temporary failures. */
export function POST(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  return withBatch(req, ctx.params, async (app, batch) => {
    try {
      const { added } = await createOrReopenBatch(
        batch.folderUrl,
        { drive: app.drive, repo: app.batches, runningBatchId: () => app.batchLane.activeKey() },
        AbortSignal.timeout(120_000),
      );
      const fresh = await app.batches.get(batch.id);
      if (fresh?.teams.some((t) => t.status === "Pending")) app.enqueueBatch(batch.id);
      return Response.json({ batchId: batch.id, added }, { status: 202 });
    } catch (e) {
      if (e instanceof BatchStartError) return apiError(e.code);
      throw e;
    }
  });
}
