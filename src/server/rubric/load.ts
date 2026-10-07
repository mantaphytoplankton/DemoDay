import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { RubricMetaSchema, type RubricMeta } from "./meta-schema.ts";

/** Thrown when the rubric file cannot be used. `message` names the problem for the Rubric page and logs. */
export class RubricError extends Error {
  override name = "RubricError";
}

export interface RubricLocation {
  dataDir: string;
  defaultPath: string;
}

export interface RubricInspection {
  source: "active" | "default";
  path: string;
  hash: string;
  version: string;
  text: string;
  meta: RubricMeta | null;
  promptText: string;
  error: string | null;
}

export interface LoadedRubric extends RubricInspection {
  meta: RubricMeta;
  error: null;
}

const META_BLOCK = /```json rubric-meta[^\S\n]*\n([\s\S]*?)\n```[^\S\n]*\n?/g;

export function defaultRubricLocation(dataDir: string): RubricLocation {
  return { dataDir, defaultPath: path.join(process.cwd(), "config", "rubric.default.md") };
}

/** Split a rubric Markdown file into validated metadata and the prose the model reads. */
export function parseRubric(text: string): { meta: RubricMeta; promptText: string } {
  const blocks = [...text.matchAll(META_BLOCK)];
  if (blocks.length === 0) throw new RubricError("No rubric-meta block found");
  if (blocks.length > 1) throw new RubricError("More than one rubric-meta block found");

  let raw: unknown;
  try {
    raw = JSON.parse(blocks[0]![1]!);
  } catch {
    throw new RubricError("The rubric-meta block is not valid JSON");
  }
  const parsed = RubricMetaSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const where = issue.path.length ? ` (${issue.path.join(".")})` : "";
    throw new RubricError(`${issue.message}${where}`);
  }
  const promptText = text.replace(META_BLOCK, "").replace(/\n{3,}/g, "\n\n").trim();
  return { meta: parsed.data, promptText };
}

async function readIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
}

/** Resolve and read the rubric without throwing on content errors (for the Rubric page). */
export async function inspectRubric(loc: RubricLocation): Promise<RubricInspection> {
  const activePath = path.join(loc.dataDir, "rubric.md");
  const active = await readIfExists(activePath);
  const source = active === null ? "default" : "active";
  const file = active === null ? loc.defaultPath : activePath;
  const text = active ?? (await readFile(loc.defaultPath, "utf8"));
  const hash = createHash("sha256").update(text, "utf8").digest("hex");
  const base = { source, path: file, hash, version: hash.slice(0, 8), text } as const;
  try {
    const { meta, promptText } = parseRubric(text);
    return { ...base, meta, promptText, error: null };
  } catch (e) {
    if (e instanceof RubricError) return { ...base, meta: null, promptText: "", error: e.message };
    throw e;
  }
}

/** Resolve, read and validate the rubric. Called at the start of every evaluation (JDG-01). */
export async function loadRubric(loc: RubricLocation): Promise<LoadedRubric> {
  const r = await inspectRubric(loc);
  if (r.error !== null || r.meta === null) throw new RubricError(r.error ?? "Rubric invalid");
  return r as LoadedRubric;
}
