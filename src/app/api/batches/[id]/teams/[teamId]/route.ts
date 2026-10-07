import { getApp } from "@/server/app-context.ts";
import { apiError } from "@/server/http/respond.ts";
import { isBatchId } from "@/server/store/batches.ts";
import { isDriveId } from "@/server/drive/url.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TBL-02: the full scorecard for one completed team. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; teamId: string }> }): Promise<Response> {
  const { id, teamId } = await ctx.params;
  if (!isBatchId(id) || !isDriveId(teamId)) return apiError("NOT_FOUND");
  const app = getApp();
  await app.ready;
  const d = await app.batches.getTeam(id, teamId).catch(() => null);
  return d ? Response.json(d) : apiError("NOT_FOUND");
}
