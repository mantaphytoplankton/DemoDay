import { z } from "zod";
import { getApp } from "@/server/app-context.ts";
import { apiError, originAllowed } from "@/server/http/respond.ts";
import { createOrReopenBatch, BatchStartError } from "@/server/jobs/batch-service.ts";
import { toBatchSummary } from "@/shared/schemas/batch.ts";
import { log } from "@/server/log.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ folderUrl: z.string().min(1).max(2000) });

/** BAT-01: start a batch from a Drive folder link, or reopen the existing batch for that folder. */
export async function POST(req: Request): Promise<Response> {
  const app = getApp();
  await app.ready;
  if (!originAllowed(req)) return apiError("ORIGIN_MISMATCH");
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError("INVALID_FOLDER_URL");
  try {
    const { batch, reopened } = await createOrReopenBatch(
      parsed.data.folderUrl,
      { drive: app.drive, repo: app.batches, runningBatchId: () => app.batchLane.activeKey() },
      AbortSignal.timeout(120_000),
    );
    if (batch.teams.some((t) => t.status === "Pending")) app.enqueueBatch(batch.id);
    log.info("batch.created", { batchId: batch.id, teams: batch.teams.length, reopened });
    return Response.json({ batchId: batch.id, reopened }, { status: 202 });
  } catch (e) {
    if (e instanceof BatchStartError) {
      log.warn("batch.rejected", { code: e.code, detail: e.message });
      return apiError(e.code);
    }
    throw e;
  }
}

export async function GET(): Promise<Response> {
  const app = getApp();
  await app.ready;
  return Response.json({ items: (await app.batches.list()).map(toBatchSummary) });
}
