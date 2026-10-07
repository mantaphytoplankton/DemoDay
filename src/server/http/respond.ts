import { errorMessage, httpStatus, type ErrorCode } from "../../shared/errors.ts";
import type { MessageVars } from "../../i18n/t.ts";

export function apiError(code: ErrorCode, vars?: MessageVars, details?: unknown): Response {
  return Response.json({ error: { code, message: errorMessage(code, vars), ...(details ? { details } : {}) } }, { status: httpStatus(code) });
}

/** CSRF defence for mutations: the Origin header must match the request's own origin. */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function maxUploadLabel(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return mb >= 1024 ? `${+(mb / 1024).toFixed(2)} GB` : `${mb} MB`;
}
