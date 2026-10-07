import { mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import type { EvaluationRepo } from "../store/evaluations.ts";
import type { BatchRepo } from "../store/batches.ts";
import type { VideoJudgeProvider } from "../agent/providers/types.ts";
import { errorMessage } from "../../shared/errors.ts";
import { isInProgress } from "../../shared/status.ts";
import { log } from "../log.ts";

/**
 * Startup recovery (app-design.md section 7.6): temp files, single evaluations and batches.
 * Running batches become Interrupted and their in-flight rows return to Pending; nothing resumes on its own.
 */
export async function recover(
  dataDir: string,
  repo: EvaluationRepo,
  provider: VideoJudgeProvider | null,
  batches?: BatchRepo,
): Promise<{ interrupted: number; remoteDeleted: number; batchesInterrupted: number }> {
  const tmp = path.join(dataDir, "tmp");
  await mkdir(tmp, { recursive: true });
  for (const f of await readdir(tmp)) await rm(path.join(tmp, f), { force: true, recursive: true });

  let interrupted = 0;
  let remoteDeleted = 0;
  for (const r of await repo.list(Number.MAX_SAFE_INTEGER)) {
    if (isInProgress(r.status) || r.status === "Pending") {
      interrupted++;
      await repo.update(r.id, (x) => ({
        ...x,
        status: "Failed",
        step: { name: "Failed", startedAt: new Date().toISOString() },
        error: { code: "INTERRUPTED", message: errorMessage("INTERRUPTED"), step: x.status === "Pending" ? "Uploading" : x.status, at: new Date().toISOString() },
      }));
    }
    if (r.geminiFileName && provider) {
      try {
        await provider.deleteFile(r.geminiFileName);
        remoteDeleted++;
        await repo.update(r.id, (x) => ({ ...x, geminiFileName: undefined }));
      } catch (e) {
        log.warn("recovery.remote_delete_failed", { jobId: r.id, reason: (e as Error).message });
      }
    }
  }
  let batchesInterrupted = 0;
  for (const b of batches ? await batches.list() : []) {
    const orphans = b.teams.map((t) => t.geminiFileName).filter((n): n is string => Boolean(n));
    if (b.status !== "Running" && orphans.length === 0) continue;
    if (b.status === "Running") batchesInterrupted++;
    for (const name of orphans) {
      try {
        await provider?.deleteFile(name);
        remoteDeleted++;
      } catch (e) {
        log.warn("recovery.remote_delete_failed", { batchId: b.id, reason: (e as Error).message });
      }
    }
    await batches!.update(b.id, (x) => ({
      ...x,
      status: x.status === "Running" ? "Interrupted" : x.status,
      teams: x.teams.map((t) => ({
        ...t,
        geminiFileName: undefined,
        ...(isInProgress(t.status) ? { status: "Pending" as const, step: { name: "Pending" as const, startedAt: new Date().toISOString() } } : {}),
      })),
    }));
  }
  if (interrupted || remoteDeleted || batchesInterrupted) log.info("recovery.done", { interrupted, remoteDeleted, batchesInterrupted });
  return { interrupted, remoteDeleted, batchesInterrupted };
}
