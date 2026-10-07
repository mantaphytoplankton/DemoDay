import path from "node:path";
import { judgeVideo, JudgeError, type JudgeDeps } from "../agent/index.ts";
import { loadRubric, defaultRubricLocation, RubricError } from "../rubric/load.ts";
import type { EvaluationRepo } from "../store/evaluations.ts";
import type { EventBus } from "./events.ts";
import { toPublic, type EvaluationRecord } from "../../shared/schemas/evaluation.ts";
import { errorMessage, type ErrorCode } from "../../shared/errors.ts";
import type { TeamStatus } from "../../shared/status.ts";
import { log } from "../log.ts";

export interface SingleJobContext {
  dataDir: string;
  repo: EvaluationRepo;
  bus: EventBus;
  judgeDeps: () => Promise<JudgeDeps>;
}

/** Run one single-upload evaluation to Completed or Failed (SNG-02, SNG-03). Never throws. */
export async function runSingleEvaluation(id: string, ctx: SingleJobContext, signal: AbortSignal): Promise<void> {
  const emit = (r: EvaluationRecord) => ctx.bus.emitEvaluation({ type: "update", evaluation: toPublic(r) });
  const rec = await ctx.repo.get(id);
  if (!rec) return;
  let current: TeamStatus = rec.status;
  const started = Date.now();

  const fail = async (code: ErrorCode, step: TeamStatus, detail?: string, vars?: Record<string, string>) => {
    log.warn("job.failed", { jobId: id, code, step, detail });
    const r = await ctx.repo.update(id, (x) => ({
      ...x,
      status: "Failed",
      step: { name: "Failed", startedAt: new Date().toISOString() },
      error: { code, message: errorMessage(code, vars), step, at: new Date().toISOString() },
    }));
    emit(r);
  };

  await ctx.repo.update(id, (x) => ({ ...x, attempts: x.attempts + 1 }));
  try {
    const rubric = await loadRubric(defaultRubricLocation(ctx.dataDir));
    const deps = await ctx.judgeDeps();
    const result = await judgeVideo(
      {
        source: { path: path.join(ctx.dataDir, rec.source.storedFile), mimeType: rec.source.mimeType, sizeBytes: rec.source.sizeBytes, displayName: id },
        rubric,
        signal,
        onStep: async (step, note) => {
          const r = await ctx.repo.transition(id, step, {}, note);
          if (step !== current) log.info("job.step", { jobId: id, step });
          current = step;
          emit(r);
        },
        onRemoteFile: async (name) => {
          await ctx.repo.update(id, (x) => ({ ...x, geminiFileName: name ?? undefined }));
        },
      },
      deps,
    );
    const done = await ctx.repo.update(id, (x) => ({
      ...x,
      status: "Completed",
      step: { name: "Completed", startedAt: new Date().toISOString() },
      result,
      overrides: undefined,
      final: undefined,
      error: undefined,
      completedAt: new Date().toISOString(),
    }));
    log.info("job.done", { jobId: id, durationMs: Date.now() - started, usage: result.provenance.usage, steps: result.provenance.stepDurationsMs });
    emit(done);
  } catch (e) {
    if (e instanceof RubricError) return fail("RUBRIC_INVALID", current === "Pending" ? "Uploading" : current, e.message);
    if (e instanceof JudgeError) {
      const reason = e.code === "AI_BLOCKED" ? (e.detail?.split(" ").pop() ?? "") : undefined;
      return fail(e.code, e.step, e.detail, reason !== undefined ? { reason } : undefined);
    }
    log.error("job.internal", { jobId: id, error: (e as Error)?.stack ?? String(e) });
    return fail("INTERNAL", current === "Pending" ? "Uploading" : current);
  }
}
