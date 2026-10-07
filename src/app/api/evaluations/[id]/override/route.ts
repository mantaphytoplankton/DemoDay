import { getApp } from "@/server/app-context.ts";
import { apiError, originAllowed } from "@/server/http/respond.ts";
import { readOverride, applyChange } from "@/server/http/override-body.ts";
import { isEvaluationId } from "@/server/store/paths.ts";
import { computeFinal } from "@/shared/scoring.ts";
import { toPublic } from "@/shared/schemas/evaluation.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TBL-03: set or remove a human override on a single evaluation. */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const app = getApp();
  await app.ready;
  if (!originAllowed(req)) return apiError("ORIGIN_MISMATCH");
  const { id } = await ctx.params;
  if (!isEvaluationId(id)) return apiError("NOT_FOUND");
  const rec = await app.evaluations.get(id).catch(() => null);
  if (!rec) return apiError("NOT_FOUND");
  if (rec.status !== "Completed" || !rec.result) return apiError("NO_RESULT");
  const change = await readOverride(req, Object.keys(rec.result.categories));
  if (change instanceof Response) return change;
  const updated = await app.evaluations.update(id, (r) => {
    const overrides = applyChange(r.overrides, change);
    return { ...r, overrides, final: computeFinal(r.result!, overrides) };
  });
  return Response.json(toPublic(updated));
}
