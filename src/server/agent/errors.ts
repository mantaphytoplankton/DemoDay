import { errorMessage } from "../../shared/errors.ts";

export type AgentStep = "Uploading" | "Processing Video" | "Scoring";

export type JudgeErrorCode =
  | "RUBRIC_INVALID"
  | "VIDEO_UNPROCESSABLE"
  | "PROCESSING_TOO_LONG"
  | "AI_UNAVAILABLE"
  | "AI_REJECTED"
  | "AI_BLOCKED"
  | "INVALID_MODEL_OUTPUT"
  | "VIDEO_TOO_LARGE"
  | "ABORTED";

const RETRYABLE: Record<JudgeErrorCode, boolean> = {
  RUBRIC_INVALID: false,
  VIDEO_UNPROCESSABLE: false,
  PROCESSING_TOO_LONG: true,
  AI_UNAVAILABLE: true,
  AI_REJECTED: false,
  AI_BLOCKED: false,
  INVALID_MODEL_OUTPUT: true,
  VIDEO_TOO_LARGE: false,
  ABORTED: true,
};

/** The only error type judgeVideo throws. `message` is user-facing; `detail` is for logs only. */
export class JudgeError extends Error {
  override name = "JudgeError";
  readonly code: JudgeErrorCode;
  readonly retryable: boolean;
  readonly step: AgentStep;
  readonly detail?: string;

  constructor(code: JudgeErrorCode, step: AgentStep, detail?: string, vars?: Record<string, string>) {
    super(errorMessage(code, vars));
    this.code = code;
    this.step = step;
    this.retryable = RETRYABLE[code];
    this.detail = detail;
  }
}

export type UpstreamKind = "retryable" | "rejected" | "schema-unsupported" | "not-found";

/** A failed call to the provider, classified for retry decisions. Never carries the API key. */
export class UpstreamError extends Error {
  override name = "UpstreamError";
  readonly kind: UpstreamKind;
  readonly status: number | null;
  readonly reason?: string;
  readonly retryAfterMs?: number;

  constructor(kind: UpstreamKind, status: number | null, message: string, reason?: string, retryAfterMs?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const sec = Number(h);
  if (Number.isFinite(sec)) return sec * 1000;
  const date = Date.parse(h);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Map an HTTP error response from the Gemini API to an UpstreamError (agent-design.md section 9). */
export async function classifyResponse(res: Response, what: string): Promise<UpstreamError> {
  let status = "";
  let reason: string | undefined;
  let message = "";
  try {
    const body = (await res.json()) as { error?: { status?: string; message?: string; details?: { reason?: string }[] } };
    status = body.error?.status ?? "";
    message = body.error?.message ?? "";
    reason = body.error?.details?.find((d) => d.reason)?.reason ?? (status || undefined);
  } catch {
    /* non-JSON body */
  }
  // Google's error text helps debugging and never contains the API key; strip anything key-like anyway.
  const upstream = message.replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]").slice(0, 300);
  const summary = `${what}: HTTP ${res.status}${status ? ` ${status}` : ""}${reason && reason !== status ? ` (${reason})` : ""}${upstream ? ` - ${upstream}` : ""}`;
  const retryAfter = parseRetryAfter(res.headers.get("retry-after"));

  if ([429, 500, 502, 503, 504].includes(res.status)) return new UpstreamError("retryable", res.status, summary, reason, retryAfter);
  if (res.status === 404) return new UpstreamError("not-found", 404, summary, reason);
  if (res.status === 400 && /response_?json_?schema/i.test(message)) {
    return new UpstreamError("schema-unsupported", 400, summary, reason);
  }
  return new UpstreamError("rejected", res.status, summary, reason);
}

/** Network failures and our own per-request deadline count as retryable; a caller abort does not. */
export function classifyThrown(e: unknown, what: string, signal: AbortSignal): Error {
  if (signal.aborted) return new JudgeAbort();
  if (e instanceof UpstreamError || e instanceof JudgeError) return e;
  const name = (e as Error)?.name ?? "Error";
  return new UpstreamError("retryable", null, `${what}: ${name === "TimeoutError" ? "no response in time" : "network error"}`);
}

export class JudgeAbort extends Error {
  override name = "JudgeAbort";
}
