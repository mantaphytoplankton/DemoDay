import { createReadStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { classifyResponse, classifyThrown, UpstreamError } from "../errors.ts";
import type { GenerateRequest, GenerateResponse, RemoteFile, VideoJudgeProvider, VideoSource } from "./types.ts";

export interface GeminiProviderOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  /** Deadline for receiving response headers on generateContent (agent-design.md section 9). */
  generateTimeoutMs?: number;
  /** Deadline for the non-streaming control calls (start, query, get, delete). */
  controlTimeoutMs?: number;
  uploadAttempts?: number;
}

const DEFAULT_BASE = "https://generativelanguage.googleapis.com";

interface FileResource {
  name: string;
  uri: string;
  mimeType: string;
  state?: RemoteFile["state"];
  videoMetadata?: { videoDuration?: string };
  error?: { message?: string };
}

function toRemote(f: FileResource): RemoteFile {
  const d = f.videoMetadata?.videoDuration;
  const seconds = d ? Number.parseFloat(d) : undefined;
  return {
    name: f.name,
    uri: f.uri,
    mimeType: f.mimeType,
    state: f.state ?? "STATE_UNSPECIFIED",
    durationSeconds: Number.isFinite(seconds) ? seconds : undefined,
    error: f.error?.message,
  };
}

/** Gemini Files API + generateContent over REST with native fetch. The key travels only in x-goog-api-key. */
export class GeminiProvider implements VideoJudgeProvider {
  readonly model: string;
  readonly name = "gemini-api" as const;
  private readonly key: string;
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly generateTimeoutMs: number;
  private readonly controlTimeoutMs: number;
  private readonly uploadAttempts: number;

  constructor(o: GeminiProviderOptions) {
    if (!o.apiKey) throw new Error("GEMINI_API_KEY is not set");
    this.key = o.apiKey;
    this.model = o.model;
    this.base = (o.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
    this.fetchImpl = o.fetch ?? fetch;
    this.generateTimeoutMs = o.generateTimeoutMs ?? 120_000;
    this.controlTimeoutMs = o.controlTimeoutMs ?? 30_000;
    this.uploadAttempts = o.uploadAttempts ?? 3;
  }

  private async call(what: string, url: string, init: RequestInit, signal: AbortSignal, timeoutMs: number): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("x-goog-api-key", this.key);
    let res: Response;
    try {
      res = await this.fetchImpl(url, { ...init, headers, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
    } catch (e) {
      throw classifyThrown(e, what, signal);
    }
    if (!res.ok) throw await classifyResponse(res, what);
    return res;
  }

  async upload(src: VideoSource, signal: AbortSignal, onProgress: (sent: number) => void): Promise<RemoteFile> {
    const start = await this.call(
      "upload start",
      `${this.base}/upload/v1beta/files`,
      {
        method: "POST",
        headers: {
          "X-Goog-Upload-Protocol": "resumable",
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(src.sizeBytes),
          "X-Goog-Upload-Header-Content-Type": src.mimeType,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ file: { display_name: src.displayName } }),
      },
      signal,
      this.controlTimeoutMs,
    );
    const sessionUrl = start.headers.get("x-goog-upload-url");
    if (!sessionUrl) throw new UpstreamError("retryable", start.status, "upload start: no session URL returned");

    let offset = 0;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.uploadAttempts; attempt++) {
      try {
        if (attempt > 1) offset = await this.queryOffset(sessionUrl, signal);
        return await this.sendBytes(sessionUrl, src, offset, signal, onProgress);
      } catch (e) {
        if (!(e instanceof UpstreamError) || e.kind !== "retryable") throw e;
        lastError = e;
      }
    }
    throw lastError;
  }

  private async queryOffset(sessionUrl: string, signal: AbortSignal): Promise<number> {
    const res = await this.call("upload query", sessionUrl, { method: "POST", headers: { "X-Goog-Upload-Command": "query" } }, signal, this.controlTimeoutMs);
    const received = Number(res.headers.get("x-goog-upload-size-received") ?? "0");
    return Number.isFinite(received) ? received : 0;
  }

  private async sendBytes(
    sessionUrl: string,
    src: VideoSource,
    offset: number,
    signal: AbortSignal,
    onProgress: (sent: number) => void,
  ): Promise<RemoteFile> {
    let sent = offset;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        sent += chunk.length;
        onProgress(sent);
        cb(null, chunk);
      },
    });
    const file = createReadStream(src.path, { start: offset });
    const body = Readable.toWeb(file.pipe(counter)) as ReadableStream<Uint8Array>;
    const res = await this.call(
      "upload bytes",
      sessionUrl,
      {
        method: "POST",
        headers: {
          "Content-Length": String(src.sizeBytes - offset),
          "X-Goog-Upload-Offset": String(offset),
          "X-Goog-Upload-Command": "upload, finalize",
        },
        body,
        duplex: "half",
      } as RequestInit,
      signal,
      // The body stream has no total deadline; a stalled upload surfaces as a network error.
      24 * 60 * 60 * 1000,
    ).finally(() => file.destroy());
    const json = (await res.json()) as { file?: FileResource };
    if (!json.file?.name || !json.file.uri) throw new UpstreamError("retryable", res.status, "upload bytes: no file in response");
    return toRemote(json.file);
  }

  async videoPart(file: RemoteFile, fps: number): Promise<Record<string, unknown>> {
    const ref = { fileData: { mimeType: file.mimeType, fileUri: file.uri } };
    return fps === 1 ? ref : { ...ref, videoMetadata: { fps } };
  }

  async getFile(name: string, signal: AbortSignal): Promise<RemoteFile> {
    const res = await this.call("get file", `${this.base}/v1beta/${name}`, { method: "GET" }, signal, this.controlTimeoutMs);
    return toRemote((await res.json()) as FileResource);
  }

  async generate(req: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse> {
    const res = await this.call(
      "generateContent",
      `${this.base}/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req) },
      signal,
      this.generateTimeoutMs,
    );
    return (await res.json()) as GenerateResponse;
  }

  async deleteFile(name: string): Promise<void> {
    try {
      await this.call("delete file", `${this.base}/v1beta/${name}`, { method: "DELETE" }, new AbortController().signal, this.controlTimeoutMs);
    } catch (e) {
      if (e instanceof UpstreamError && e.kind === "not-found") return; // already gone
      throw e;
    }
  }
}
