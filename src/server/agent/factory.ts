import type { Env } from "../env.ts";
import { GeminiProvider } from "./providers/gemini.ts";
import { VertexProvider } from "./providers/vertex.ts";
import { ServiceAccountTokenSource } from "./providers/google-auth.ts";
import type { VideoJudgeProvider } from "./providers/types.ts";
import type { JudgeDeps } from "./index.ts";
import { abortableSleep } from "./retry.ts";
import { log } from "../log.ts";

/** Build the agent dependencies from configuration. Fixture mode uses the protocol fake (tests only). */
export async function createJudgeDeps(env: Env): Promise<JudgeDeps> {
  let provider: VideoJudgeProvider;
  if (env.JUDGE_UPSTREAM === "fixture") {
    const { getSharedFakeGemini } = await import("../testing/gemini-fake-shared.ts");
    const fake = getSharedFakeGemini();
    provider = new GeminiProvider({ apiKey: "fixture-key", model: env.GEMINI_MODEL, baseUrl: fake.base, fetch: fake.fetch });
  } else if (env.AI_PROVIDER === "vertex") {
    const account = env.vertexAccount!;
    provider = new VertexProvider({
      model: env.GEMINI_MODEL,
      project: env.VERTEX_PROJECT || account.project_id,
      location: env.VERTEX_LOCATION,
      tokens: getTokenSource(account),
      inlineMaxBytes: env.VERTEX_INLINE_MAX_MB * 1024 * 1024,
      generateTimeoutMs: env.GEMINI_SCORING_TIMEOUT_S * 1000,
    });
  } else {
    provider = new GeminiProvider({ apiKey: env.GEMINI_API_KEY!, model: env.GEMINI_MODEL, generateTimeoutMs: env.GEMINI_SCORING_TIMEOUT_S * 1000 });
  }
  return {
    provider,
    settings: { temperature: env.GEMINI_TEMPERATURE, thinkingBudget: env.GEMINI_THINKING_BUDGET, videoFps: env.GEMINI_VIDEO_FPS },
    log: (event, data) => log.info(event, data),
    ...(env.JUDGE_UPSTREAM === "fixture" && env.JUDGE_POLL_MS
      ? {
          poll: { fastMs: env.JUDGE_POLL_MS, slowMs: env.JUDGE_POLL_MS, fastWindowMs: 30_000, maxProcessingMs: 10 * 60_000 },
          // Tests only: cap every wait (polls and retry backoff) so long retry budgets run in milliseconds.
          sleep: (ms: number, signal: AbortSignal) => abortableSleep(Math.min(ms, env.JUDGE_POLL_MS!), signal),
        }
      : {}),
  };
}

/** One token source per process, so the cached access token is shared across evaluations. */
const g = globalThis as unknown as { __demodayTokens?: Map<string, ServiceAccountTokenSource> };
function getTokenSource(account: ServiceAccountTokenSource["account"]): ServiceAccountTokenSource {
  g.__demodayTokens ??= new Map();
  const key = `${account.client_email}#${account.private_key_id ?? ""}`;
  let src = g.__demodayTokens.get(key);
  if (!src) {
    src = new ServiceAccountTokenSource(account);
    g.__demodayTokens.set(key, src);
  }
  return src;
}
