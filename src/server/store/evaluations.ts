import { readdir, rm } from "node:fs/promises";
import { FsStore } from "./fs-store.ts";
import { assertEvaluationId, isEvaluationId } from "./paths.ts";
import { EvaluationRecordSchema, type EvaluationRecord } from "../../shared/schemas/evaluation.ts";
import { canTransition, type TeamStatus } from "../../shared/status.ts";

export class EvaluationRepo {
  private readonly store: FsStore;
  constructor(store: FsStore) {
    this.store = store;
  }

  private rel(id: string) {
    return `evaluations/${assertEvaluationId(id)}.json`;
  }

  get(id: string): Promise<EvaluationRecord | null> {
    return this.store.readJson(this.rel(id), EvaluationRecordSchema);
  }

  create(rec: EvaluationRecord): Promise<void> {
    return this.store.writeJson(this.rel(rec.id), rec, EvaluationRecordSchema);
  }

  update(id: string, fn: (r: EvaluationRecord) => EvaluationRecord): Promise<EvaluationRecord> {
    return this.store.updateJson(this.rel(id), EvaluationRecordSchema, (cur) => {
      if (!cur) throw new Error(`Evaluation ${id} not found`);
      return { ...fn(cur), updatedAt: new Date().toISOString() };
    });
  }

  /** Status change guarded by the transition table. */
  transition(id: string, to: TeamStatus, extra: Partial<EvaluationRecord> = {}, note?: string): Promise<EvaluationRecord> {
    return this.update(id, (r) => {
      if (!canTransition(r.status, to)) throw new Error(`Illegal transition ${r.status} → ${to} for ${id}`);
      const step = to === r.status && r.step ? { ...r.step, note } : { name: to, startedAt: new Date().toISOString(), note };
      return { ...r, ...extra, status: to, step };
    });
  }

  /** RSM-07: remove the record and its stored upload. */
  async delete(rec: EvaluationRecord): Promise<void> {
    await rm(this.store.resolve(rec.source.storedFile), { force: true });
    await rm(this.store.resolve(this.rel(rec.id)), { force: true });
  }

  async list(limit = 20): Promise<EvaluationRecord[]> {
    let names: string[];
    try {
      names = await readdir(this.store.resolve("evaluations"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const ids = names.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)).filter(isEvaluationId);
    const recs = await Promise.all(ids.map((id) => this.get(id).catch(() => null)));
    return recs
      .filter((r): r is EvaluationRecord => r !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }
}
