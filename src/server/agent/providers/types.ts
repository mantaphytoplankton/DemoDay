export interface VideoSource {
  path: string;
  mimeType: "video/mp4" | "video/quicktime" | "video/webm";
  sizeBytes: number;
  displayName: string;
}

export interface RemoteFile {
  name: string; // "files/abc123"
  uri: string;
  mimeType: string;
  state: "PROCESSING" | "ACTIVE" | "FAILED" | "STATE_UNSPECIFIED";
  durationSeconds?: number;
  error?: string;
}

export interface GenerateRequest {
  systemInstruction: { parts: { text: string }[] };
  contents: { role: "user" | "model"; parts: Record<string, unknown>[] }[];
  generationConfig: Record<string, unknown>;
}

export interface GenerateResponse {
  candidates?: {
    content?: { parts?: { text?: string; thought?: boolean }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };
  modelVersion?: string;
}

/** Provider boundary (agent-design.md section 12). Methods throw UpstreamError or JudgeAbort. */
export interface VideoJudgeProvider {
  readonly model: string;
  /** Recorded in provenance: which API scored the video. */
  readonly name: "gemini-api" | "vertex";
  /** The request part that carries the video (Files API reference, or inline bytes). */
  videoPart(file: RemoteFile, fps: number): Promise<Record<string, unknown>>;
  upload(src: VideoSource, signal: AbortSignal, onProgress: (sentBytes: number) => void): Promise<RemoteFile>;
  getFile(name: string, signal: AbortSignal): Promise<RemoteFile>;
  generate(req: GenerateRequest, signal: AbortSignal): Promise<GenerateResponse>;
  deleteFile(name: string): Promise<void>;
}
