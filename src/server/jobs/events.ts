import { EventEmitter } from "node:events";
import type { PublicEvaluation } from "../../shared/schemas/evaluation.ts";
import type { BatchStatus, PublicBatch, PublicTeamRow } from "../../shared/schemas/batch.ts";

export type EvaluationEvent = { type: "snapshot" | "update"; evaluation: PublicEvaluation };
export type BatchEvent =
  | { type: "snapshot"; batch: PublicBatch }
  | { type: "row"; batchId: string; row: PublicTeamRow }
  | { type: "status"; batchId: string; status: BatchStatus };

/** In-process fan-out of job events to SSE subscribers. Emitted only after the checkpoint is written. */
export class EventBus {
  private readonly emitter = new EventEmitter();
  constructor() {
    this.emitter.setMaxListeners(0);
  }
  emitEvaluation(e: EvaluationEvent) {
    this.emitter.emit(`evaluation:${e.evaluation.id}`, e);
  }
  onEvaluation(id: string, fn: (e: EvaluationEvent) => void): () => void {
    this.emitter.on(`evaluation:${id}`, fn);
    return () => this.emitter.off(`evaluation:${id}`, fn);
  }
  emitBatch(batchId: string, e: BatchEvent) {
    this.emitter.emit(`batch:${batchId}`, e);
  }
  onBatch(batchId: string, fn: (e: BatchEvent) => void): () => void {
    this.emitter.on(`batch:${batchId}`, fn);
    return () => this.emitter.off(`batch:${batchId}`, fn);
  }
}
