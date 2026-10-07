import { describe, it, expect } from "vitest";
import { withRetry, generatePolicyFor, GENERATE_POLICY, OVERLOAD_POLICY, NO_RESPONSE_POLICY } from "../../src/server/agent/retry.ts";
import { UpstreamError } from "../../src/server/agent/errors.ts";

async function run(errors: UpstreamError[]) {
  const sleeps: number[] = [];
  const notes: [number, number][] = [];
  let calls = 0;
  const result = await withRetry(
    async () => {
      const e = errors[calls++];
      if (e) throw e;
      return "ok";
    },
    generatePolicyFor,
    { sleep: async (ms) => void sleeps.push(ms), random: () => 0, signal: new AbortController().signal, onRetry: (n, max) => void notes.push([n, max]) },
  ).catch((e) => e);
  return { result, sleeps, notes, calls };
}
const busy = () => new UpstreamError("retryable", 503, "UNAVAILABLE");
const boom = () => new UpstreamError("retryable", 500, "INTERNAL");

describe("generate retry policy (RSM-05)", () => {
  it("should_wait_about_3_minutes_over_6_attempts_when_the_model_is_overloaded", async () => {
    const { result, sleeps, notes, calls } = await run(Array.from({ length: 6 }, busy));
    expect(result).toBeInstanceOf(UpstreamError);
    expect(calls).toBe(6);
    expect(sleeps).toEqual([5000, 10000, 20000, 40000, 80000]);
    expect(notes.at(-1)).toEqual([6, 6]);
    expect(OVERLOAD_POLICY.attempts).toBe(6);
  });

  it("should_succeed_when_the_overload_clears_before_the_last_attempt", async () => {
    const { result, calls } = await run([busy(), busy(), busy()]);
    expect(result).toBe("ok");
    expect(calls).toBe(4);
  });

  it("should_keep_4_attempts_for_other_server_errors", async () => {
    const { result, sleeps, calls } = await run(Array.from({ length: 6 }, boom));
    expect(result).toBeInstanceOf(UpstreamError);
    expect(calls).toBe(GENERATE_POLICY.attempts);
    expect(sleeps).toEqual([2000, 4000, 8000]);
  });

  it("should_stop_after_3_attempts_when_google_does_not_answer_at_all", async () => {
    const silent = () => new UpstreamError("retryable", null, "generateContent: no response in time");
    const { result, sleeps, calls, notes } = await run(Array.from({ length: 6 }, silent));
    expect(result).toBeInstanceOf(UpstreamError);
    expect(calls).toBe(NO_RESPONSE_POLICY.attempts);
    expect(calls).toBe(3);
    expect(sleeps).toEqual([5000, 10000]);
    expect(notes.at(-1)).toEqual([3, 3]);
  });

  it("should_not_retry_rejected_requests", async () => {
    const { calls } = await run([new UpstreamError("rejected", 400, "bad")]);
    expect(calls).toBe(1);
  });
});
