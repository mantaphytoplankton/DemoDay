import { getApp, type AppContext } from "../app-context.ts";
import { apiError, originAllowed } from "./respond.ts";
import { isBatchId } from "../store/batches.ts";
import type { BatchManifest } from "../../shared/schemas/batch.ts";

/** Shared guard for batch mutations: origin check, id check, batch lookup. */
export async function withBatch(
  req: Request,
  params: Promise<{ id: string }>,
  fn: (app: AppContext, batch: BatchManifest) => Promise<Response>,
): Promise<Response> {
  const app = getApp();
  await app.ready;
  if (!originAllowed(req)) return apiError("ORIGIN_MISMATCH");
  const { id } = await params;
  if (!isBatchId(id)) return apiError("NOT_FOUND");
  const batch = await app.batches.get(id).catch(() => null);
  if (!batch) return apiError("NOT_FOUND");
  return fn(app, batch);
}
