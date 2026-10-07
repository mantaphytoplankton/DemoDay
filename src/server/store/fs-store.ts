import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import type { ZodType } from "zod";

export class StoreCorruptError extends Error {
  override name = "StoreCorruptError";
}

/**
 * JSON files under one root (app-design.md section 4.2).
 * Writes: validate → temp file → fsync → rename. Read-modify-write is serialized per path.
 */
export class FsStore {
  readonly root: string;
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  resolve(rel: string): string {
    const abs = path.resolve(this.root, rel);
    if (abs !== this.root && !abs.startsWith(this.root + path.sep)) throw new Error(`Path outside data dir: ${rel}`);
    return abs;
  }

  async readJson<T>(rel: string, schema: ZodType<T>): Promise<T | null> {
    const file = this.resolve(rel);
    let text: string;
    try {
      text = await readFile(file, "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = Symbol("invalid");
    }
    const v = schema.safeParse(parsed);
    if (!v.success) {
      await rename(file, `${file}.corrupt-${Date.now()}`).catch(() => {});
      throw new StoreCorruptError(`Stored file failed validation: ${rel}`);
    }
    return v.data;
  }

  async writeJson<T>(rel: string, value: T, schema: ZodType<T>): Promise<void> {
    const data = schema.parse(value);
    const file = this.resolve(rel);
    const dir = path.dirname(file);
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp-${randomBytes(6).toString("hex")}`;
    const fh = await open(tmp, "w");
    try {
      await fh.writeFile(JSON.stringify(data, null, 2));
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      await rename(tmp, file);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
    const dh = await open(dir, "r").catch(() => null);
    if (dh) await dh.sync().catch(() => {}).finally(() => dh.close());
  }

  /** Read-modify-write under a per-path lock so concurrent updates never interleave. */
  async updateJson<T>(rel: string, schema: ZodType<T>, fn: (current: T | null) => T | Promise<T>): Promise<T> {
    const key = this.resolve(rel);
    const prev = this.locks.get(key) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(async () => {
      const next = await fn(await this.readJson(rel, schema));
      await this.writeJson(rel, next, schema);
      return next;
    });
    this.locks.set(key, run);
    try {
      return await run;
    } finally {
      if (this.locks.get(key) === run) this.locks.delete(key);
    }
  }
}
