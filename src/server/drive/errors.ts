export type DriveErrorKind = "retryable" | "denied";

/** A failed Drive call, classified for retry decisions (app-design.md section 8.5). Never carries the key. */
export class DriveError extends Error {
  override name = "DriveError";
  readonly kind: DriveErrorKind;
  readonly status: number | null;
  readonly reason?: string;
  readonly retryAfterMs?: number;
  constructor(kind: DriveErrorKind, status: number | null, message: string, reason?: string, retryAfterMs?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
    this.reason = reason;
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Duck-typed check. Objects created by the shared app context (globalThis singletons) can come from a
 * different module instance than the caller's import under next dev, so `instanceof` is unreliable there.
 */
export function isDriveError(e: unknown): e is DriveError {
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "DriveError" && "kind" in e;
}

const RATE_REASONS = new Set(["rateLimitExceeded", "userRateLimitExceeded", "sharingRateLimitExceeded", "backendError"]);

/** Drive reports rate limits as 403 with a reason, so the reason decides, not the status alone. */
export async function classifyDriveResponse(res: Response, what: string): Promise<DriveError> {
  let reason: string | undefined;
  let message = "";
  try {
    const body = (await res.json()) as { error?: { message?: string; errors?: { reason?: string }[]; status?: string } };
    reason = body.error?.errors?.find((e) => e.reason)?.reason ?? body.error?.status;
    message = (body.error?.message ?? "").replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]").slice(0, 200);
  } catch {
    /* non-JSON body */
  }
  const ra = Number(res.headers.get("retry-after"));
  const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1000 : undefined;
  const summary = `${what}: HTTP ${res.status}${reason ? ` (${reason})` : ""}${message ? ` - ${message}` : ""}`;
  const retryable = res.status === 429 || res.status >= 500 || (res.status === 403 && reason !== undefined && RATE_REASONS.has(reason));
  return new DriveError(retryable ? "retryable" : "denied", res.status, summary, reason, retryAfterMs);
}
