import { buildModelOutputSchema, toRequestSchema, type ModelOutput } from "./output-schema.ts";
import { finalizeResult } from "./postprocess.ts";
import { loadPrompts, renderUserPrompt, type Prompts } from "./prompt.ts";
import { generatePolicyFor, POLL_POLICY, abortableSleep, withRetry, type RetryHooks } from "./retry.ts";
import { JudgeAbort, JudgeError, UpstreamError, type AgentStep } from "./errors.ts";
import type { GenerateRequest, GenerateResponse, RemoteFile, VideoJudgeProvider, VideoSource } from "./providers/types.ts";
import type { LoadedRubric } from "../rubric/load.ts";
import type { JudgeResult } from "../../shared/schemas/judge-result.ts";
import { formatBytes } from "../../shared/format.ts";
import { t } from "../../i18n/t.ts";

export { JudgeError } from "./errors.ts";
export type { AgentStep } from "./errors.ts";

export interface JudgeSettings {
  temperature: number;
  thinkingBudget: number;
  videoFps: number;
  seed?: number;
}

export interface JudgeInput {
  source: VideoSource;
  rubric: LoadedRubric;
  signal: AbortSignal;
  onStep: (step: AgentStep, note?: string) => void | Promise<void>;
  onRemoteFile: (name: string | null) => void | Promise<void>;
}

export interface JudgeDeps {
  provider: VideoJudgeProvider;
  settings: JudgeSettings;
  prompts?: Prompts;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: () => number;
  /** Processing poll schedule: interval for the first 30s, then the slower interval, up to maxProcessingMs. */
  poll?: { fastMs: number; slowMs: number; fastWindowMs: number; maxProcessingMs: number };
  log?: (event: string, data: Record<string, unknown>) => void;
}

const DEFAULT_POLL = { fastMs: 2000, slowMs: 5000, fastWindowMs: 30_000, maxProcessingMs: 10 * 60_000 };
const PROGRESS_THROTTLE_MS = 500;
const MAX_REPAIR_ECHO = 8000;

/**
 * Judge one video against the rubric (agent-design.md section 6).
 * One structured model call plus at most one repair turn. Throws JudgeError only.
 */
export async function judgeVideo(input: JudgeInput, deps: JudgeDeps): Promise<JudgeResult> {
  const { provider, settings } = deps;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? abortableSleep;
  const random = deps.random ?? Math.random;
  const poll = deps.poll ?? DEFAULT_POLL;
  const log = deps.log ?? (() => {});
  const { signal } = input;

  const startedAt = now();
  let step: AgentStep = "Uploading";
  const durations = { upload: 0, processing: 0, scoring: 0 };
  const hooks = (s: AgentStep): RetryHooks => ({
    sleep,
    random,
    signal,
    onRetry: async (next, max, e) => {
      log("agent.retry", { step: s, attempt: next, max, reason: e.message });
      await input.onStep(s, t("note.aiBusy", { attempt: next, max }));
    },
  });

  const fail = (e: unknown): never => {
    if (e instanceof JudgeError) throw e;
    if (e instanceof JudgeAbort || signal.aborted) throw new JudgeError("ABORTED", step, "aborted");
    if (e instanceof UpstreamError) {
      const code = e.kind === "retryable" ? "AI_UNAVAILABLE" : "AI_REJECTED";
      throw new JudgeError(code, step, e.message);
    }
    throw new JudgeError("AI_UNAVAILABLE", step, (e as Error)?.message ?? String(e));
  };

  const prompts = deps.prompts ?? (await loadPrompts());
  const schema = buildModelOutputSchema(input.rubric.meta);
  const requestSchema = toRequestSchema(schema);

  // 1. Upload (JDG-03)
  await input.onStep("Uploading");
  let lastNote = 0;
  let remote: RemoteFile;
  try {
    remote = await provider.upload(input.source, signal, (sent) => {
      const ts = now();
      if (ts - lastNote < PROGRESS_THROTTLE_MS && sent < input.source.sizeBytes) return;
      lastNote = ts;
      void input.onStep("Uploading", `${formatBytes(sent)} / ${formatBytes(input.source.sizeBytes)}`);
    });
  } catch (e) {
    return fail(e);
  }
  durations.upload = now() - startedAt;

  try {
    await input.onRemoteFile(remote.name);

    // 2. Wait for processing
    step = "Processing Video";
    await input.onStep(step);
    const processingStart = now();
    let active: RemoteFile = remote;
    try {
      while (active.state !== "ACTIVE") {
        if (active.state === "FAILED") throw new JudgeError("VIDEO_UNPROCESSABLE", step, active.error ?? "file state FAILED");
        const elapsed = now() - processingStart;
        if (elapsed >= poll.maxProcessingMs) throw new JudgeError("PROCESSING_TOO_LONG", step, `still processing after ${elapsed}ms`);
        await sleep(elapsed < poll.fastWindowMs ? poll.fastMs : poll.slowMs, signal);
        active = await withRetry(() => provider.getFile(remote.name, signal), POLL_POLICY, hooks(step));
      }
    } catch (e) {
      return fail(e);
    }
    durations.processing = now() - processingStart;
    const durationSeconds = active.durationSeconds ?? 0;
    if (active.durationSeconds === undefined) log("agent.duration_unknown", { file: active.name });

    // 3. Score (JDG-04)
    step = "Scoring";
    await input.onStep(step);
    const scoringStart = now();
    const userText = renderUserPrompt(prompts.user, { rubric: input.rubric, displayName: input.source.displayName, durationSeconds });
    let videoPart: Record<string, unknown>;
    try {
      videoPart = await provider.videoPart(active, settings.videoFps);
    } catch (e) {
      return fail(e);
    }
    const userTurn = { role: "user" as const, parts: [videoPart, { text: userText }] };
    const usage = { promptTokens: 0, outputTokens: 0, thoughtsTokens: 0, totalTokens: 0 };
    let modelVersion: string | undefined;
    let useOpenApiSchema = false;

    const request = (contents: GenerateRequest["contents"]): GenerateRequest => ({
      systemInstruction: { parts: [{ text: prompts.system }] },
      contents,
      generationConfig: {
        responseMimeType: "application/json",
        ...(useOpenApiSchema ? { responseSchema: toOpenApiSchema(requestSchema) } : { responseJsonSchema: requestSchema }),
        temperature: settings.temperature,
        seed: settings.seed ?? 7,
        maxOutputTokens: 16384,
        thinkingConfig: { thinkingBudget: settings.thinkingBudget },
      },
    });

    const generate = async (contents: GenerateRequest["contents"]): Promise<GenerateResponse> => {
      try {
        return await withRetry(() => provider.generate(request(contents), signal), generatePolicyFor, hooks(step));
      } catch (e) {
        if (e instanceof UpstreamError && e.kind === "schema-unsupported" && !useOpenApiSchema) {
          log("agent.schema_fallback", { reason: e.message });
          useOpenApiSchema = true;
          return withRetry(() => provider.generate(request(contents), signal), generatePolicyFor, hooks(step));
        }
        throw e;
      }
    };

    const interpret = (res: GenerateResponse): { ok: true; value: ModelOutput } | { ok: false; raw: string; issues: string } => {
      usage.promptTokens += res.usageMetadata?.promptTokenCount ?? 0;
      usage.outputTokens += res.usageMetadata?.candidatesTokenCount ?? 0;
      usage.thoughtsTokens += res.usageMetadata?.thoughtsTokenCount ?? 0;
      usage.totalTokens += res.usageMetadata?.totalTokenCount ?? 0;
      modelVersion = res.modelVersion ?? modelVersion;
      const block = res.promptFeedback?.blockReason;
      if (block) throw new JudgeError("AI_BLOCKED", step, `blockReason ${block}`, { reason: block });
      const cand = res.candidates?.[0];
      const finish = cand?.finishReason ?? "";
      if (["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII"].includes(finish)) {
        throw new JudgeError("AI_BLOCKED", step, `finishReason ${finish}`, { reason: finish });
      }
      const raw = (cand?.content?.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("");
      if (!cand || finish === "MAX_TOKENS" || finish === "RECITATION") {
        return { ok: false, raw, issues: `Response ended early (${finish || "no candidate"}); return the complete object.` };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, raw, issues: "The response was not valid JSON." };
      }
      const v = schema.safeParse(parsed);
      if (v.success) return { ok: true, value: v.data as ModelOutput };
      const issues = v.error.issues.slice(0, 20).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
      return { ok: false, raw, issues };
    };

    let output: ModelOutput;
    let repairUsed = false;
    try {
      const first = interpret(await generate([userTurn]));
      if (first.ok) {
        output = first.value;
      } else {
        repairUsed = true;
        log("agent.repair", { issues: first.issues });
        await input.onStep(step, t("note.repair"));
        const second = interpret(
          await generate([
            userTurn,
            { role: "model", parts: [{ text: first.raw.slice(0, MAX_REPAIR_ECHO) || "{}" }] },
            { role: "user", parts: [{ text: `Your response did not match the schema: ${first.issues} Return the complete corrected JSON object only.` }] },
          ]),
        );
        if (!second.ok) throw new JudgeError("INVALID_MODEL_OUTPUT", step, second.issues);
        output = second.value;
      }
    } catch (e) {
      return fail(e);
    }
    durations.scoring = now() - scoringStart;

    const { droppedObservations, ...scored } = finalizeResult(output, input.rubric, durationSeconds);
    if (droppedObservations) log("agent.observations_dropped", { count: droppedObservations });
    return {
      outputVersion: 2,
      ...scored,
      rubric: { maxDurationSeconds: input.rubric.meta.maxDurationSeconds, categories: input.rubric.meta.categories },
      provenance: {
        model: provider.model,
        provider: provider.name,
        modelVersion,
        promptVersion: prompts.version,
        rubricVersion: input.rubric.version,
        rubricSource: input.rubric.source,
        temperature: settings.temperature,
        videoFps: settings.videoFps,
        thinkingBudget: settings.thinkingBudget,
        usage,
        stepDurationsMs: durations,
        repairUsed,
        droppedObservations,
        startedAt: new Date(startedAt).toISOString(),
        finishedAt: new Date(now()).toISOString(),
      },
    };
  } finally {
    // Always remove the remote copy (JDG-03). A failed delete is left to startup recovery and the 48h expiry.
    try {
      await withRetry(() => provider.deleteFile(remote.name), { attempts: 2, baseMs: 1000, jitterMs: 0, maxRetryAfterMs: 5000 }, {
        sleep: (ms) => abortableSleep(ms, new AbortController().signal),
        random,
        signal: new AbortController().signal,
      });
      await input.onRemoteFile(null);
    } catch (e) {
      log("agent.delete_failed", { file: remote.name, reason: (e as Error).message });
    }
  }
}

/** Convert the JSON Schema subset we send into Gemini's OpenAPI-style responseSchema (fallback path). */
export function toOpenApiSchema(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(toOpenApiSchema);
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "additionalProperties") continue;
    if (k === "type" && typeof v === "string") out[k] = v.toUpperCase();
    else if (k === "properties" && v && typeof v === "object") {
      out[k] = Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, toOpenApiSchema(pv)]));
      out.propertyOrdering = Object.keys(v);
    } else out[k] = toOpenApiSchema(v);
  }
  return out;
}
