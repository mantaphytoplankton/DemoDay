import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getApp } from "@/server/app-context.ts";
import { apiError } from "@/server/http/respond.ts";
import { isEvaluationId } from "@/server/store/paths.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** SNG-04: the stored upload, with HTTP Range support so the player can seek. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isEvaluationId(id)) return apiError("NOT_FOUND");
  const app = getApp();
  await app.ready;
  const rec = await app.evaluations.get(id).catch(() => null);
  if (!rec) return apiError("NOT_FOUND");
  const file = path.join(app.env.dataDir, rec.source.storedFile);
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return apiError("NOT_FOUND");
  }
  const base = { "Content-Type": rec.source.mimeType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  const range = req.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: { ...base, "Content-Length": String(size) } });
  }
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  if (!range[1] && !range[2]) start = 0;
  end = Math.min(end, size - 1);
  if (!Number.isFinite(start) || start < 0 || start > end) {
    return new Response(null, { status: 416, headers: { ...base, "Content-Range": `bytes */${size}` } });
  }
  return new Response(Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream, {
    status: 206,
    headers: { ...base, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": String(end - start + 1) },
  });
}
