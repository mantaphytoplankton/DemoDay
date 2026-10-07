import { readdir, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { FsStore } from "./fs-store.ts";
import { BatchManifestSchema, TeamDetailSchema, type BatchManifest, type TeamDetail, type TeamRow } from "../../shared/schemas/batch.ts";
import { canTransition, type TeamStatus } from "../../shared/status.ts";
import { isDriveId } from "../drive/url.ts";

const BATCH_ID_RE = /^[a-f0-9]{16}$/;

export function batchIdFor(rootFolderId: string): string {
  return createHash("sha256").update(rootFolderId).digest("hex").slice(0, 16);
}
export function isBatchId(id: string): boolean {
  return BATCH_ID_RE.test(id);
}

export class BatchRepo {
  private readonly store: FsStore;
  constructor(store: FsStore) {
    this.store = store;
  }

  private rel(id: string) {
    if (!isBatchId(id)) throw new Error("Invalid batch id");
    return `batches/${id}/batch.json`;
  }
  private teamRel(id: string, subfolderId: string) {
    if (!isBatchId(id) || !isDriveId(subfolderId)) throw new Error("Invalid id");
    return `batches/${id}/teams/${subfolderId}.json`;
  }

  get(id: string): Promise<BatchManifest | null> {
    return this.store.readJson(this.rel(id), BatchManifestSchema);
  }

  create(b: BatchManifest): Promise<void> {
    return this.store.writeJson(this.rel(b.id), b, BatchManifestSchema);
  }

  update(id: string, fn: (b: BatchManifest) => BatchManifest): Promise<BatchManifest> {
    return this.store.updateJson(this.rel(id), BatchManifestSchema, (cur) => {
      if (!cur) throw new Error(`Batch ${id} not found`);
      return { ...fn(cur), updatedAt: new Date().toISOString() };
    });
  }

  /** Update one team row; status changes are guarded by the transition table. */
  async updateRow(id: string, subfolderId: string, fn: (r: TeamRow) => TeamRow): Promise<{ batch: BatchManifest; row: TeamRow }> {
    let row: TeamRow | undefined;
    const batch = await this.update(id, (b) => ({
      ...b,
      teams: b.teams.map((t) => {
        if (t.subfolderId !== subfolderId) return t;
        const next = fn(t);
        if (!canTransition(t.status, next.status)) throw new Error(`Illegal transition ${t.status} → ${next.status}`);
        row = next;
        return next;
      }),
    }));
    if (!row) throw new Error(`Team ${subfolderId} not in batch ${id}`);
    return { batch, row };
  }

  stepRow(id: string, subfolderId: string, to: TeamStatus, note?: string) {
    return this.updateRow(id, subfolderId, (r) => ({
      ...r,
      status: to,
      step: r.status === to && r.step ? { ...r.step, note } : { name: to, startedAt: new Date().toISOString(), note },
    }));
  }

  getTeam(id: string, subfolderId: string): Promise<TeamDetail | null> {
    return this.store.readJson(this.teamRel(id, subfolderId), TeamDetailSchema);
  }

  writeTeam(d: TeamDetail): Promise<void> {
    return this.store.writeJson(this.teamRel(d.batchId, d.subfolderId), d, TeamDetailSchema);
  }

  /** RSM-07: remove the batch folder (manifest and every team result). */
  async delete(id: string): Promise<void> {
    if (!isBatchId(id)) throw new Error("Invalid batch id");
    await rm(this.store.resolve(`batches/${id}`), { recursive: true, force: true });
  }

  async list(): Promise<BatchManifest[]> {
    let names: string[];
    try {
      names = await readdir(this.store.resolve("batches"));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const all = await Promise.all(names.filter(isBatchId).map((n) => this.get(n).catch(() => null)));
    return all.filter((b): b is BatchManifest => b !== null).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
