import path from "node:path";
import { rm } from "node:fs/promises";
import { judgeVideo, JudgeError, type JudgeDeps } from "../agent/index.ts";
import { loadRubric, defaultRubricLocation, RubricError } from "../rubric/load.ts";
import { isDriveError } from "../drive/errors.ts";
import { selectVideo } from "../drive/select-video.ts";
import type { DriveClient } from "../drive/client.ts";
import { FileTooLargeError } from "../upload/stream-to-disk.ts";
import type { BatchRepo } from "../store/batches.ts";
import type { EventBus } from "./events.ts";
import { toPublicRow, type TeamRow, type TeamSummary } from "../../shared/schemas/batch.ts";
import type { JudgeResult } from "../../shared/schemas/judge-result.ts";
import { transcriptEarlyEnd } from "../../shared/transcript.ts";
import { errorMessage, type ErrorCode } from "../../shared/errors.ts";
import type { TeamStatus } from "../../shared/status.ts";
import { t } from "../../i18n/t.ts";
import { log } from "../log.ts";

const VIDEO_EXT: Record<string, string> = { "video/mp4": ".mp4", "video/quicktime": ".mov", "video/webm": ".webm" };

export interface BatchJobContext {
  dataDir: string;
  maxBytes: number;
  repo: BatchRepo;
  bus: EventBus;
  drive: () => DriveClient;
  judgeDeps: () => Promise<JudgeDeps>;
  /** True once a pause was requested; checked between teams so the current team always finishes (RSM-02). */
  takePauseRequest: (batchId: string) => boolean;
}

/** Same Drive file, unchanged content (checksum when Drive provides one, otherwise modification time). */
export function sameVideo(a: { fileId: string; md5Checksum?: string; modifiedTime?: string } | undefined, b: { id: string; md5Checksum?: string; modifiedTime?: string }): boolean {
  if (!a || a.fileId !== b.id) return false;
  if (a.md5Checksum || b.md5Checksum) return a.md5Checksum === b.md5Checksum;
  return a.modifiedTime === b.modifiedTime;
}

/** BAT-05: judge every Pending team in queue order, one at a time. One team's failure never stops the batch. */
export async function runBatch(batchId: string, ctx: BatchJobContext, signal: AbortSignal): Promise<void> {
  const setStatus = async (status: "Running" | "Paused" | "Completed" | "Interrupted") => {
    await ctx.repo.update(batchId, (b) => ({ ...b, status }));
    ctx.bus.emitBatch(batchId, { type: "status", batchId, status });
  };
  await setStatus("Running");
  log.info("batch.start", { batchId });
  for (;;) {
    if (signal.aborted) return;
    if (ctx.takePauseRequest(batchId)) {
      await setStatus("Paused");
      log.info("batch.paused", { batchId });
      return;
    }
    const batch = await ctx.repo.get(batchId);
    const next = batch?.teams.filter((r) => r.status === "Pending").sort((a, b) => a.order - b.order)[0];
    if (!next) break;
    await runTeam(batchId, next, ctx, signal);
  }
  if (signal.aborted) return;
  await setStatus("Completed");
  log.info("batch.done", { batchId });
}

function summaryOf(result: JudgeResult, completedAt: string): TeamSummary {
  return {
    categories: result.categories,
    overallScore: result.overallScore,
    overallComments: result.overallComments,
    durationSeconds: result.durationSeconds,
    exceedsMaxDuration: result.exceedsMaxDuration,
    maxDurationSeconds: result.rubric.maxDurationSeconds,
    flags: result.flags,
    transcriptEarlyEnd: transcriptEarlyEnd(result.transcript, result.durationSeconds),
    videoSummary: result.summary ?? undefined,
    rubricVersion: result.provenance.rubricVersion,
    model: result.provenance.model,
    completedAt,
  };
}

async function runTeam(batchId: string, row: TeamRow, ctx: BatchJobContext, signal: AbortSignal): Promise<void> {
  const id = row.subfolderId;
  const emit = (r: TeamRow) => ctx.bus.emitBatch(batchId, { type: "row", batchId, row: toPublicRow(r) });
  let current: TeamStatus = "Downloading";
  let tmpFile: string | null = null;

  const step = async (to: TeamStatus, note?: string) => {
    const { row: r } = await ctx.repo.stepRow(batchId, id, to, note);
    current = to;
    emit(r);
  };
  const fail = async (code: ErrorCode, detail?: string, vars?: Record<string, string>) => {
    log.warn("team.failed", { batchId, teamId: id, code, step: current, detail });
    const { row: r } = await ctx.repo.updateRow(batchId, id, (x) => ({
      ...x,
      status: "Failed",
      step: { name: "Failed", startedAt: new Date().toISOString() },
      error: { code, message: errorMessage(code, vars), step: current, at: new Date().toISOString() },
    }));
    emit(r);
  };
  const driveNote = (attempt: number, max: number) => step(current, t("note.driveBusy", { attempt, max }));

  try {
    const { row: started } = await ctx.repo.updateRow(batchId, id, (x) => ({
      ...x,
      status: "Downloading",
      attempts: x.attempts + 1,
      error: undefined,
      warnings: [],
      step: { name: "Downloading", startedAt: new Date().toISOString() },
    }));
    emit(started);

    // BAT-03: locate the team's video
    const drive = ctx.drive();
    const selection = selectVideo(await drive.listVideos(id, signal, driveNote));
    if (selection.kind === "none") return await fail("NO_VIDEO_IN_FOLDER");
    const file = selection.file;
    const ext = VIDEO_EXT[file.mimeType];
    if (!ext) return await fail("UNSUPPORTED_TYPE", file.mimeType);
    const sizeBytes = Number(file.size ?? "0");
    const video = { fileId: file.id, name: file.name, mimeType: file.mimeType, sizeBytes, md5Checksum: file.md5Checksum, modifiedTime: file.modifiedTime };
    const { row: located } = await ctx.repo.updateRow(batchId, id, (x) => ({
      ...x,
      video,
      warnings: selection.others > 0 ? [{ code: "multipleVideos" as const, count: selection.others + 1, chosen: file.name }] : [],
    }));
    emit(located);
    if (sizeBytes > ctx.maxBytes) return await fail("FILE_TOO_LARGE", `${sizeBytes} bytes`, { maxMb: `${Math.round(ctx.maxBytes / 1024 / 1024)} MB` });

    // RSM-01/03: a saved result for this exact video is reused (crash between checkpoint writes, or rerun).
    const saved = row.forceJudge ? null : await ctx.repo.getTeam(batchId, id).catch(() => null);
    if (saved && sameVideo(saved.video, file)) {
      const { row: reused } = await ctx.repo.updateRow(batchId, id, (x) => ({
        ...x,
        status: "Completed",
        attempts: x.attempts - 1, // reusing is not a new attempt
        step: { name: "Completed", startedAt: saved.completedAt },
        summary: summaryOf(saved.result, saved.completedAt),
      }));
      emit(reused);
      log.info("team.reused", { batchId, teamId: id });
      return;
    }

    // BAT-04: retrieve to temporary storage
    tmpFile = path.join(ctx.dataDir, "tmp", `${batchId}-${id}${ext}`);
    const received = await drive.download(file.id, tmpFile, { signal, maxBytes: ctx.maxBytes, expectedSize: sizeBytes || undefined, onRetry: driveNote });

    // Judge (JDG-03/04): Uploading → Processing Video → Scoring
    const rubric = await loadRubric(defaultRubricLocation(ctx.dataDir));
    const result = await judgeVideo(
      {
        source: { path: tmpFile, mimeType: file.mimeType as "video/mp4" | "video/quicktime" | "video/webm", sizeBytes: received, displayName: `${batchId}-${id}` },
        rubric,
        signal,
        onStep: (s, note) => step(s, note),
        onRemoteFile: async (name) => {
          await ctx.repo.updateRow(batchId, id, (x) => ({ ...x, geminiFileName: name ?? undefined }));
        },
      },
      await ctx.judgeDeps(),
    );

    // Checkpoint order (app-design.md 7.4): full team result first, then the row, then the event.
    const completedAt = new Date().toISOString();
    await ctx.repo.writeTeam({ schemaVersion: 1, batchId, subfolderId: id, teamName: row.teamName, video: { ...video, sizeBytes: received }, result, completedAt });
    const { row: done } = await ctx.repo.updateRow(batchId, id, (x) => ({
      ...x,
      status: "Completed",
      forceJudge: undefined,
      step: { name: "Completed", startedAt: completedAt },
      summary: summaryOf(result, completedAt),
    }));
    emit(done);
    log.info("team.done", { batchId, teamId: id, usage: result.provenance.usage, steps: result.provenance.stepDurationsMs });
  } catch (e) {
    if (signal.aborted) return; // recovery resets the row to Pending
    if (isDriveError(e)) return await fail(e.kind === "denied" ? "DRIVE_PERMISSION_DENIED" : "DRIVE_UNAVAILABLE", e.message);
    if (e instanceof FileTooLargeError) return await fail("FILE_TOO_LARGE", e.message, { maxMb: `${Math.round(ctx.maxBytes / 1024 / 1024)} MB` });
    if (e instanceof RubricError) return await fail("RUBRIC_INVALID", e.message);
    if (e instanceof JudgeError) {
      const reason = e.code === "AI_BLOCKED" ? (e.detail?.split(" ").pop() ?? "") : undefined;
      return await fail(e.code, e.detail, reason !== undefined ? { reason } : undefined);
    }
    log.error("team.internal", { batchId, teamId: id, error: (e as Error)?.stack ?? String(e) });
    return await fail("INTERNAL");
  } finally {
    if (tmpFile) await rm(tmpFile, { force: true });
  }
}
