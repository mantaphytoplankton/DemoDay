import { z } from "zod";
import { withBatch } from "@/server/http/batch-route.ts";
import { apiError } from "@/server/http/respond.ts";
import { isDriveId } from "@/server/drive/url.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ rejudge: z.boolean().optional() }).optional();

/** RSM-04: retry one failed team; with { rejudge: true } also re-judge a completed team (RSM-03). */
export function POST(req: Request, ctx: { params: Promise<{ id: string; teamId: string }> }): Promise<Response> {
  return withBatch(req, ctx.params, async (app, batch) => {
    const { teamId } = await ctx.params;
    const row = isDriveId(teamId) ? batch.teams.find((t) => t.subfolderId === teamId) : undefined;
    if (!row) return apiError("NOT_FOUND");
    const body = Body.safeParse(await req.json().catch(() => undefined));
    const rejudge = body.success && body.data?.rejudge === true;
    if (!(row.status === "Failed" || (rejudge && row.status === "Completed"))) return apiError("NOT_RETRYABLE");
    await app.batches.updateRow(batch.id, teamId, (r) => ({
      ...r,
      status: "Pending",
      error: undefined,
      forceJudge: rejudge || undefined,
      step: { name: "Pending", startedAt: new Date().toISOString() },
    }));
    app.enqueueBatch(batch.id);
    return Response.json({ batchId: batch.id, teamId }, { status: 202 });
  });
}
