import { readFile } from "node:fs/promises";
import { classifyResponse, classifyThrown, JudgeError } from "../errors.ts";
import { readVideoDuration } from "../video-duration.ts";
import type { ServiceAccountTokenSource } from "./google-auth.ts";
import type { GenerateRequest, GenerateResponse, RemoteFile, VideoJudgeProvider, VideoSource } from "./types.ts";
import { formatBytes } from "../../../shared/format.ts";

export interface VertexProviderOptions {
  model: string;
  project: string;
  /** "global" serves the newest Gemini models (gemini-3.8-flash is not in us-central1). */
  location: string;
  tokens: ServiceAccountTokenSource;
  /** Largest video sent inline. Measured on 2026-10-07: 90 MB requests accepted; default cap 80 MB. */
  inlineMaxBytes: number;
  fetch?: typeof fetch;
  generateTimeoutMs?: number;
}

/**
 * Gemini on Vertex AI (Google Cloud), signed in with a service account (JDG-07, ADR-009).
 * There is no Files API on Vertex: the video is sent inline (base64). Its length is read from the file header.
 */
export class VertexProvider implements VideoJudgeProvider {
  readonly model: string;
  readonly name = "vertex" as const;
  private readonly o: VertexProviderOptions;
  private readonly fetchImpl: typeof fetch;
  private readonly sources = new Map<string, VideoSource>();

  constructor(o: VertexProviderOptions) {
    this.o = o;
    this.model = o.model;
    this.fetchImpl = o.fetch ?? fetch;
  }

  private get endpoint(): string {
    const { project, location, model } = this.o;
    const host = location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
    return `https://${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  }

  /** "Upload" = check size and read the length locally; the bytes travel inside the scoring request. */
  async upload(src: VideoSource, _signal: AbortSignal, onProgress: (sent: number) => void): Promise<RemoteFile> {
    if (src.sizeBytes > this.o.inlineMaxBytes) {
      throw new JudgeError("VIDEO_TOO_LARGE", "Uploading", `${src.sizeBytes} bytes > ${this.o.inlineMaxBytes}`, { limit: formatBytes(this.o.inlineMaxBytes) });
    }
    const name = `inline/${src.displayName}`;
    this.sources.set(name, src);
    onProgress(src.sizeBytes);
    const durationSeconds = (await readVideoDuration(src.path, src.mimeType)) ?? undefined;
    return { name, uri: "", mimeType: src.mimeType, state: "ACTIVE", durationSeconds };
  }

  async getFile(name: string): Promise<RemoteFile> {
    const src = this.sources.get(name);
    return { name, uri: "", mimeType: src?.mimeType ?? "", state: src ? "ACTIVE" : "FAILED" };
  }

  async videoPart(file: RemoteFile, fps: number): Promise<Record<string, unknown>> {
    const src = this.sources.get(file.name);
    if (!src) throw new JudgeError("VIDEO_UNPROCESSABLE", "Scoring", "inline source missing");
    const data = (await readFile(src.path)).toString("base64");
    return { inlineData: { mimeType: src.mimeType, data }, ...(fps === 1 ? {} : { videoMetadata: { fps } }) };
  }

  async generate(req: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse> {
    const token = await this.o.tokens.token(signal);
    let res: Response;
    try {
      res = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(req),
        signal: AbortSignal.any([signal, AbortSignal.timeout(this.o.generateTimeoutMs ?? 120_000)]),
      });
    } catch (e) {
      throw classifyThrown(e, "generateContent", signal);
    }
    if (!res.ok) throw await classifyResponse(res, "generateContent");
    return (await res.json()) as GenerateResponse;
  }

  async deleteFile(name: string): Promise<void> {
    this.sources.delete(name); // nothing is stored at Google
  }
}
