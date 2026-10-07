import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { classifyDriveResponse, DriveError } from "./errors.ts";
import type { DriveFile } from "./select-video.ts";
import { FileTooLargeError } from "../upload/stream-to-disk.ts";

const FOLDER = "application/vnd.google-apps.folder";
const SHORTCUT = "application/vnd.google-apps.shortcut";
const FILE_FIELDS = "id,name,mimeType,size,md5Checksum,modifiedTime,shortcutDetails(targetId,targetMimeType)";

export interface DriveRetryPolicy {
  attempts: number;
  baseMs: number;
  jitterMs: number;
  maxRetryAfterMs: number;
}
export const DRIVE_RETRY: DriveRetryPolicy = { attempts: 3, baseMs: 1000, jitterMs: 500, maxRetryAfterMs: 30_000 };

export interface DriveClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  retry?: DriveRetryPolicy;
  controlTimeoutMs?: number;
  stallMs?: number;
}

export type RetryNotice = (attempt: number, max: number) => void | Promise<void>;

const q = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Google Drive API v3 over native fetch (app-design.md section 8). The key travels only in x-goog-api-key. */
export class DriveClient {
  private readonly key: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  private readonly random: () => number;
  private readonly retry: DriveRetryPolicy;
  private readonly controlTimeoutMs: number;
  private readonly stallMs: number;

  constructor(o: DriveClientOptions) {
    if (!o.apiKey) throw new Error("GOOGLE_DRIVE_API_KEY is not set");
    this.key = o.apiKey;
    this.base = (o.baseUrl ?? "https://www.googleapis.com/drive/v3").replace(/\/$/, "");
    this.fetchImpl = o.fetch ?? fetch;
    this.sleep = o.sleep ?? ((ms, signal) => new Promise((r, j) => {
      const t = setTimeout(r, ms);
      signal.addEventListener("abort", () => { clearTimeout(t); j(signal.reason); }, { once: true });
    }));
    this.random = o.random ?? Math.random;
    this.retry = o.retry ?? DRIVE_RETRY;
    this.controlTimeoutMs = o.controlTimeoutMs ?? 30_000;
    this.stallMs = o.stallMs ?? 60_000;
  }

  private async withRetry<T>(what: string, fn: () => Promise<T>, signal: AbortSignal, onRetry?: RetryNotice): Promise<T> {
    for (let attempt = 1; ; attempt++) {
      try {
        return await fn();
      } catch (e) {
        if (signal.aborted) throw e;
        const err = e instanceof DriveError || e instanceof FileTooLargeError ? e : new DriveError("retryable", null, `${what}: network error`);
        if (!(err instanceof DriveError) || err.kind !== "retryable" || attempt >= this.retry.attempts) throw err;
        await onRetry?.(attempt + 1, this.retry.attempts);
        const wait = err.retryAfterMs !== undefined
          ? Math.min(err.retryAfterMs, this.retry.maxRetryAfterMs)
          : this.retry.baseMs * 2 ** (attempt - 1) + Math.floor(this.random() * this.retry.jitterMs);
        await this.sleep(wait, signal);
      }
    }
  }

  private async getJson<T>(what: string, path: string, params: Record<string, string>, signal: AbortSignal): Promise<T> {
    const url = `${this.base}${path}?${new URLSearchParams(params)}`;
    const res = await this.fetchImpl(url, {
      headers: { "x-goog-api-key": this.key },
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.controlTimeoutMs)]),
    });
    if (!res.ok) throw await classifyDriveResponse(res, what);
    return (await res.json()) as T;
  }

  async getFolder(id: string, signal: AbortSignal, onRetry?: RetryNotice): Promise<{ id: string; name: string; mimeType: string }> {
    return this.withRetry("folder", () => this.getJson("folder", `/files/${encodeURIComponent(id)}`, { fields: "id,name,mimeType", supportsAllDrives: "true" }, signal), signal, onRetry);
  }

  private async listAll(what: string, query: string, signal: AbortSignal, onRetry?: RetryNotice): Promise<DriveFile[]> {
    const out: DriveFile[] = [];
    let pageToken: string | undefined;
    do {
      const page = await this.withRetry(
        what,
        () =>
          this.getJson<{ files?: DriveFile[]; nextPageToken?: string }>(what, "/files", {
            q: query,
            fields: `nextPageToken,files(${FILE_FIELDS})`,
            pageSize: "1000",
            supportsAllDrives: "true",
            includeItemsFromAllDrives: "true",
            ...(pageToken ? { pageToken } : {}),
          }, signal),
        signal,
        onRetry,
      );
      out.push(...(page.files ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);
    return out;
  }

  /** BAT-02: every team subfolder of the parent, across all pages. */
  listSubfolders(parentId: string, signal: AbortSignal, onRetry?: RetryNotice): Promise<DriveFile[]> {
    return this.listAll("list folders", `'${q(parentId)}' in parents and trashed=false and mimeType='${FOLDER}'`, signal, onRetry);
  }

  /** BAT-03: videos in a team folder; shortcuts to videos resolve to their target. */
  async listVideos(folderId: string, signal: AbortSignal, onRetry?: RetryNotice): Promise<DriveFile[]> {
    const files = await this.listAll("list videos", `'${q(folderId)}' in parents and trashed=false and (mimeType contains 'video/' or mimeType='${SHORTCUT}')`, signal, onRetry);
    const videos: DriveFile[] = [];
    for (const f of files) {
      if (f.mimeType === SHORTCUT) {
        const target = f.shortcutDetails;
        if (!target?.targetId || !target.targetMimeType?.startsWith("video/")) continue;
        try {
          videos.push(await this.withRetry("shortcut", () => this.getJson<DriveFile>("shortcut", `/files/${encodeURIComponent(target.targetId)}`, { fields: FILE_FIELDS, supportsAllDrives: "true" }, signal), signal, onRetry));
        } catch (e) {
          if (e instanceof DriveError && e.kind === "denied") continue; // unreadable shortcut target: treat as no video
          throw e;
        }
      } else if (f.mimeType.startsWith("video/")) {
        videos.push(f);
      }
    }
    return videos;
  }

  /** BAT-04: stream a file to disk. Aborts after `stallMs` without data; never buffers the whole video. */
  async download(fileId: string, dest: string, o: { signal: AbortSignal; maxBytes: number; expectedSize?: number; onRetry?: RetryNotice }): Promise<number> {
    return this.withRetry("download", async () => {
      const stall = new AbortController();
      let timer = setTimeout(() => stall.abort(new Error("stalled")), this.stallMs);
      const kick = () => {
        clearTimeout(timer);
        timer = setTimeout(() => stall.abort(new Error("stalled")), this.stallMs);
      };
      const signal = AbortSignal.any([o.signal, stall.signal]);
      try {
        const res = await this.fetchImpl(`${this.base}/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`, {
          headers: { "x-goog-api-key": this.key },
          signal,
        });
        if (!res.ok) throw await classifyDriveResponse(res, "download");
        if (!res.body) throw new DriveError("retryable", res.status, "download: empty body");
        let bytes = 0;
        const counter = new Transform({
          transform(chunk: Buffer, _e, cb) {
            kick();
            bytes += chunk.length;
            if (bytes > o.maxBytes) cb(new FileTooLargeError(`More than ${o.maxBytes} bytes`));
            else cb(null, chunk);
          },
        });
        await pipeline(Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>), counter, createWriteStream(dest), { signal });
        if (o.expectedSize !== undefined && bytes !== o.expectedSize) {
          throw new DriveError("retryable", null, `download: received ${bytes} of ${o.expectedSize} bytes`);
        }
        return bytes;
      } catch (e) {
        await rm(dest, { force: true });
        if (o.signal.aborted) throw e;
        if (stall.signal.aborted) throw new DriveError("retryable", null, "download: no data received for too long");
        throw e;
      } finally {
        clearTimeout(timer);
      }
    }, o.signal, o.onRetry);
  }
}
