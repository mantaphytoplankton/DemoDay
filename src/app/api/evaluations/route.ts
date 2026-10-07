import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { getApp } from "@/server/app-context.ts";
import { apiError, maxUploadLabel, originAllowed } from "@/server/http/respond.ts";
import { streamToFile, FileTooLargeError } from "@/server/upload/stream-to-disk.ts";
import { sniffVideo } from "@/server/upload/sniff.ts";
import { toSummary, type EvaluationRecord } from "@/shared/schemas/evaluation.ts";
import { log } from "@/server/log.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES = {
  "video/mp4": { ext: ".mp4", sniff: "mp4-family" },
  "video/quicktime": { ext: ".mov", sniff: "mp4-family" },
  "video/webm": { ext: ".webm", sniff: "webm" },
} as const;
type VideoMime = keyof typeof TYPES;

/** SNG-01: stream one video to disk, check it, store the record and queue the evaluation. */
export async function POST(req: Request): Promise<Response> {
  const app = getApp();
  await app.ready;
  if (!originAllowed(req)) return apiError("ORIGIN_MISMATCH");
  const max = app.env.maxUploadBytes;
  const maxLabel = { maxMb: maxUploadLabel(max) };

  const mime = (req.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  let fileName = "";
  try {
    fileName = decodeURIComponent(req.headers.get("x-file-name") ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 255);
  } catch {
    return apiError("VALIDATION_FAILED");
  }
  const type = TYPES[mime as VideoMime];
  // The file extension must agree with the declared type (.MP4 and .mp4 both accepted).
  if (!type || !fileName || path.extname(fileName).toLowerCase() !== type.ext) return apiError("UNSUPPORTED_TYPE");
  const declared = Number(req.headers.get("content-length") ?? "NaN");
  if (Number.isFinite(declared) && declared > max) return apiError("FILE_TOO_LARGE", maxLabel);
  if (!req.body) return apiError("EMPTY_FILE");

  const id = randomUUID();
  const partFile = path.join(app.env.dataDir, "tmp", `${id}.part`);
  let size: number;
  try {
    size = await streamToFile(req.body, partFile, max, req.signal);
  } catch (e) {
    if (e instanceof FileTooLargeError) return apiError("FILE_TOO_LARGE", maxLabel);
    log.warn("upload.aborted", { reason: (e as Error).message });
    return apiError("VALIDATION_FAILED");
  }
  if (size === 0) {
    await rm(partFile, { force: true });
    return apiError("EMPTY_FILE");
  }
  const fh = await open(partFile, "r");
  const head = Buffer.alloc(12);
  await fh.read(head, 0, 12, 0).finally(() => fh.close());
  if (sniffVideo(head) !== type.sniff) {
    await rm(partFile, { force: true });
    return apiError("NOT_A_VIDEO");
  }

  const storedFile = `uploads/${id}${type.ext}`;
  await rename(partFile, path.join(app.env.dataDir, storedFile));
  const now = new Date().toISOString();
  const rec: EvaluationRecord = {
    schemaVersion: 1,
    id,
    source: { kind: "upload", fileName, mimeType: mime as VideoMime, sizeBytes: size, storedFile },
    status: "Pending",
    step: { name: "Pending", startedAt: now },
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
  await app.evaluations.create(rec);
  log.info("upload.stored", { jobId: id, sizeBytes: size, mimeType: mime });
  app.enqueueSingle(id);
  return Response.json({ evaluationId: id }, { status: 202 });
}

/** Recent evaluations for the Evaluate page. */
export async function GET(req: Request): Promise<Response> {
  const app = getApp();
  await app.ready;
  const limit = Math.min(50, Math.max(1, Number(new URL(req.url).searchParams.get("limit") ?? "20") || 20));
  const items = (await app.evaluations.list(limit)).map(toSummary);
  return Response.json({ items });
}
