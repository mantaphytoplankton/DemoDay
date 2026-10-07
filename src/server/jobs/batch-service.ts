import { parseFolderUrl } from "../drive/url.ts";
import { isDriveError } from "../drive/errors.ts";
import type { DriveClient } from "../drive/client.ts";
import { batchIdFor, type BatchRepo } from "../store/batches.ts";
import type { BatchManifest, TeamRow } from "../../shared/schemas/batch.ts";
import type { ErrorCode } from "../../shared/errors.ts";

/** Failures that may clear on their own; reopening the folder queues these teams again (BAT-01). */
export const TEMPORARY_FAILURES: readonly ErrorCode[] = ["AI_UNAVAILABLE", "DRIVE_UNAVAILABLE", "PROCESSING_TOO_LONG"];
import { naturalCompare } from "../../shared/sort.ts";
import { selectVideo } from "../drive/select-video.ts";
import { sameVideo } from "./batch-job.ts";
import { log } from "../log.ts";

export class BatchStartError extends Error {
  override name = "BatchStartError";
  readonly code: ErrorCode;
  constructor(code: ErrorCode, detail?: string) {
    super(detail ?? code);
    this.code = code;
  }
}

/**
 * BAT-01/BAT-02: validate the link, read the parent folder and its team subfolders, then create the
 * batch or reopen the existing one for the same folder. Existing rows are kept, so completed teams
 * are never judged again; new subfolders are appended as Pending, and teams that failed for a
 * temporary reason (TEMPORARY_FAILURES) are queued again.
 */
export async function createOrReopenBatch(
  folderUrl: string,
  deps: { drive: DriveClient | null; repo: BatchRepo; runningBatchId: () => string | null },
  signal: AbortSignal,
): Promise<{ batch: BatchManifest; reopened: boolean; added: number }> {
  const rootFolderId = parseFolderUrl(folderUrl);
  if (!rootFolderId) throw new BatchStartError("INVALID_FOLDER_URL");
  if (!deps.drive) throw new BatchStartError("DRIVE_NOT_CONFIGURED");
  const id = batchIdFor(rootFolderId);
  const running = deps.runningBatchId();
  if (running && running !== id) throw new BatchStartError("BATCH_ALREADY_RUNNING");

  let folder: { name: string; mimeType: string };
  let subfolders: { id: string; name: string }[];
  try {
    folder = await deps.drive.getFolder(rootFolderId, signal);
    if (folder.mimeType !== "application/vnd.google-apps.folder") throw new BatchStartError("INVALID_FOLDER_URL", "not a folder");
    subfolders = await deps.drive.listSubfolders(rootFolderId, signal);
  } catch (e) {
    if (e instanceof BatchStartError) throw e;
    if (isDriveError(e)) throw new BatchStartError(e.kind === "denied" ? "FOLDER_NOT_SHARED" : "DRIVE_UNAVAILABLE", e.message);
    throw e;
  }
  if (subfolders.length === 0) throw new BatchStartError("NO_TEAM_FOLDERS");

  const now = new Date().toISOString();
  const sorted = [...subfolders].sort((a, b) => naturalCompare(a.name, b.name));
  const existing = await deps.repo.get(id);
  if (!existing) {
    const teams: TeamRow[] = sorted.map((f, i) => ({ subfolderId: f.id, teamName: f.name, order: i, status: "Pending", warnings: [], attempts: 0 }));
    const batch: BatchManifest = { schemaVersion: 1, id, rootFolderId, folderName: folder.name, folderUrl: folderUrl.trim(), status: "Running", createdAt: now, updatedAt: now, lastScanAt: now, teams };
    await deps.repo.create(batch);
    return { batch, reopened: false, added: teams.length };
  }
  // RSM-03: a completed team whose video changed in Drive is judged again.
  const changed = new Set<string>();
  for (const r of existing.teams.filter((t) => t.status === "Completed" && t.video)) {
    try {
      const pick = selectVideo(await deps.drive.listVideos(r.subfolderId, signal));
      if (pick.kind === "one" && !sameVideo(r.video, pick.file)) changed.add(r.subfolderId);
    } catch (e) {
      log.warn("batch.recheck_failed", { batchId: id, teamId: r.subfolderId, reason: (e as Error).message });
    }
  }
  let added = 0;
  const batch = await deps.repo.update(id, (b) => {
    const known = new Map(b.teams.map((r) => [r.subfolderId, r]));
    const fresh = sorted.filter((f) => !known.has(f.id));
    added = fresh.length;
    let order = b.teams.reduce((m, r) => Math.max(m, r.order), -1);
    const names = new Map(sorted.map((f) => [f.id, f.name]));
    return {
      ...b,
      folderName: folder.name,
      lastScanAt: now,
      teams: [
        ...b.teams.map((r): TeamRow => {
          const renamed = { ...r, teamName: names.get(r.subfolderId) ?? r.teamName };
          const temporary = r.status === "Failed" && r.error && TEMPORARY_FAILURES.includes(r.error.code);
          if (changed.has(r.subfolderId)) return { ...renamed, status: "Pending", summary: undefined, step: { name: "Pending", startedAt: now } };
          return temporary ? { ...renamed, status: "Pending", error: undefined, step: { name: "Pending", startedAt: now } } : renamed;
        }),
        ...fresh.map((f): TeamRow => ({ subfolderId: f.id, teamName: f.name, order: ++order, status: "Pending", warnings: [], attempts: 0 })),
      ],
    };
  });
  return { batch, reopened: true, added };
}
