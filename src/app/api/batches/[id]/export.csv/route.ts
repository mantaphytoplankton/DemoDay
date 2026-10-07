import { getApp } from "@/server/app-context.ts";
import { apiError } from "@/server/http/respond.ts";
import { isBatchId } from "@/server/store/batches.ts";
import { inspectRubric, defaultRubricLocation } from "@/server/rubric/load.ts";
import { buildScoresCsv } from "@/server/csv/scores-csv.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TBL-04: download scores.csv (RFC 4180, UTF-8 with BOM). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isBatchId(id)) return apiError("NOT_FOUND");
  const app = getApp();
  await app.ready;
  const batch = await app.batches.get(id).catch(() => null);
  if (!batch) return apiError("NOT_FOUND");
  const rubric = await inspectRubric(defaultRubricLocation(app.env.dataDir));
  const columns = rubric.meta?.categories.map((c) => ({ id: c.id, name: c.name })) ?? [];
  return new Response(buildScoresCsv(batch, columns), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="scores.csv"',
      "Cache-Control": "no-store",
    },
  });
}
