import { withBatch } from "@/server/http/batch-route.ts";
import { apiError } from "@/server/http/respond.ts";
import { readOverride, applyChange } from "@/server/http/override-body.ts";
import { isDriveId } from "@/server/drive/url.ts";
import { computeFinal } from "@/shared/scoring.ts";
import { toPublicRow } from "@/shared/schemas/batch.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TBL-03: set or remove a human override on a batch team; the row's final scores update live. */
export function PATCH(req: Request, ctx: { params: Promise<{ id: string; teamId: string }> }): Promise<Response> {
  return withBatch(req, ctx.params, async (app, batch) => {
    const { teamId } = await ctx.params;
    const row = isDriveId(teamId) ? batch.teams.find((t) => t.subfolderId === teamId) : undefined;
    if (!row) return apiError("NOT_FOUND");
    const detail = await app.batches.getTeam(batch.id, teamId).catch(() => null);
    if (row.status !== "Completed" || !detail) return apiError("NO_RESULT");
    const change = await readOverride(req, Object.keys(detail.result.categories));
    if (change instanceof Response) return change;
    const overrides = applyChange(detail.overrides, change);
    const final = computeFinal(detail.result, overrides);
    await app.batches.writeTeam({ ...detail, overrides });
    const { row: updated } = await app.batches.updateRow(batch.id, teamId, (r) => ({ ...r, summary: r.summary ? { ...r.summary, final } : r.summary }));
    app.bus.emitBatch(batch.id, { type: "row", batchId: batch.id, row: toPublicRow(updated) });
    return Response.json({ overrides, final, row: toPublicRow(updated) });
  });
}
