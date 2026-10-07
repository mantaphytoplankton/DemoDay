import { UpstreamError } from "./errors.ts";

export interface RetryPolicy {
  attempts: number; // total attempts, including the first
  baseMs: number; // first backoff; doubles each time
  jitterMs: number;
  maxRetryAfterMs: number;
}

export const GENERATE_POLICY: RetryPolicy = { attempts: 4, baseMs: 2000, jitterMs: 1000, maxRetryAfterMs: 60_000 };
/**
 * 503 UNAVAILABLE ("model is currently experiencing high demand") can last minutes, so it gets a longer
 * budget: waits of 5, 10, 20, 40 and 80 s (about 2.6 min plus jitter) across 6 attempts.
 */
export const OVERLOAD_POLICY: RetryPolicy = { attempts: 6, baseMs: 5000, jitterMs: 1000, maxRetryAfterMs: 90_000 };

/**
 * No reply before the per-request scoring deadline (GEMINI_SCORING_TIMEOUT_S). Seen on 2026-10-07 during an
 * overload: Google held video requests open instead of answering 503. Three attempts bound the wait.
 */
export const NO_RESPONSE_POLICY: RetryPolicy = { attempts: 3, baseMs: 5000, jitterMs: 1000, maxRetryAfterMs: 30_000 };

/** Policy for generateContent, chosen from the latest error. */
export function generatePolicyFor(e: UpstreamError): RetryPolicy {
  if (e.status === 503) return OVERLOAD_POLICY;
  if (e.status === null && e.message.includes("no response in time")) return NO_RESPONSE_POLICY;
  return GENERATE_POLICY;
}
export const POLL_POLICY: RetryPolicy = { attempts: 4, baseMs: 2000, jitterMs: 1000, maxRetryAfterMs: 60_000 };

export interface RetryHooks {
  sleep: (ms: number, signal: AbortSignal) => Promise<void>;
  random: () => number;
  signal: AbortSignal;
  /** Called before waiting for attempt `next` (2-based). */
  onRetry?: (next: number, max: number, error: UpstreamError) => void | Promise<void>;
}

export function backoffMs(policy: RetryPolicy, failedAttempt: number, random: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, policy.maxRetryAfterMs);
  return policy.baseMs * 2 ** (failedAttempt - 1) + Math.floor(random * policy.jitterMs);
}

/**
 * Retry only UpstreamErrors of kind "retryable". Anything else is rethrown immediately.
 * `policy` may depend on the error (for example a longer budget for 503 overload).
 */
export async function withRetry<T>(fn: (attempt: number) => Promise<T>, policyOrFn: RetryPolicy | ((e: UpstreamError) => RetryPolicy), hooks: RetryHooks): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (e) {
      if (!(e instanceof UpstreamError) || e.kind !== "retryable") throw e;
      const policy = typeof policyOrFn === "function" ? policyOrFn(e) : policyOrFn;
      if (attempt >= policy.attempts) throw e;
      await hooks.onRetry?.(attempt + 1, policy.attempts, e);
      await hooks.sleep(backoffMs(policy, attempt, hooks.random(), e.retryAfterMs), hooks.signal);
    }
  }
}

export function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
