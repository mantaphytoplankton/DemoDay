import { z } from "zod";
import path from "node:path";
import { readFileSync } from "node:fs";
import { parseServiceAccount, type ServiceAccount } from "./agent/providers/google-auth.ts";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  /** Which API scores videos: "gemini" (Google AI Studio, API key) or "vertex" (Google Cloud, service account). */
  AI_PROVIDER: z.enum(["gemini", "vertex"]).default("gemini"),
  GEMINI_API_KEY: z.string().trim().optional(),
  /** Path to the service-account key file (JSON) for AI_PROVIDER=vertex. Keep the file outside the project. */
  VERTEX_SERVICE_ACCOUNT_FILE: z.string().trim().optional(),
  /** Defaults to the key file's project_id. */
  VERTEX_PROJECT: z.string().trim().optional(),
  VERTEX_LOCATION: z.string().trim().default("global"),
  VERTEX_INLINE_MAX_MB: z.coerce.number().int().min(1).max(500).default(80),
  /** Needed only for batch (Drive) evaluation; single uploads work without it. */
  GOOGLE_DRIVE_API_KEY: z.string().trim().optional(),
  GEMINI_MODEL: z.string().trim().min(1).default("gemini-3.8-flash"),
  GEMINI_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.2),
  GEMINI_THINKING_BUDGET: z.coerce.number().int().min(-1).max(32768).default(4096),
  GEMINI_VIDEO_FPS: z.coerce.number().positive().max(24).default(1),
  /** Deadline for one scoring request. Measured scoring took 14–44 s; 120 s leaves margin without long hangs. */
  GEMINI_SCORING_TIMEOUT_S: z.coerce.number().int().min(10).max(600).default(120),
  DATA_DIR: z.string().default("./data"),
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(2048).default(1024),
  JUDGE_UPSTREAM: z.enum(["live", "fixture"]).default("live"),
  /** Fixture mode only: processing poll interval in ms (tests use a short one). */
  JUDGE_POLL_MS: z.coerce.number().int().min(1).optional(),
});

export type Env = z.infer<typeof EnvSchema> & { dataDir: string; maxUploadBytes: number; vertexAccount?: ServiceAccount };

export class ConfigError extends Error {
  override name = "ConfigError";
}

let cached: Env | null = null;

/** Parse configuration once. Names the problem variable, never its value. */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached && source === process.env) return cached;
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const vars = [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(", ");
    throw new ConfigError(`Invalid configuration: ${vars}`);
  }
  const e = parsed.data;
  if (e.JUDGE_UPSTREAM === "fixture" && e.NODE_ENV === "production") {
    throw new ConfigError("JUDGE_UPSTREAM=fixture is not allowed when NODE_ENV=production");
  }
  let vertexAccount: ServiceAccount | undefined;
  if (e.JUDGE_UPSTREAM === "live" && e.AI_PROVIDER === "gemini" && !e.GEMINI_API_KEY) {
    throw new ConfigError("GEMINI_API_KEY is not set. Copy .env.local.example to .env.local and add the key.");
  }
  if (e.JUDGE_UPSTREAM === "live" && e.AI_PROVIDER === "vertex") {
    const file = e.VERTEX_SERVICE_ACCOUNT_FILE;
    if (!file) throw new ConfigError("VERTEX_SERVICE_ACCOUNT_FILE is not set. Point it to the service-account key file (JSON).");
    let text: string;
    try {
      text = readFileSync(path.resolve(file.replace(/^~(?=$|\/)/, process.env.HOME ?? "~")), "utf8");
    } catch {
      throw new ConfigError(`VERTEX_SERVICE_ACCOUNT_FILE: file not found or not readable (${file})`);
    }
    try {
      vertexAccount = parseServiceAccount(text);
    } catch (err) {
      throw new ConfigError(`VERTEX_SERVICE_ACCOUNT_FILE: ${(err as Error).message}`);
    }
  }
  const env: Env = { ...e, dataDir: path.resolve(e.DATA_DIR), maxUploadBytes: e.MAX_UPLOAD_MB * 1024 * 1024, vertexAccount };
  if (source === process.env) cached = env;
  return env;
}

export function resetEnvCache(): void {
  cached = null;
}
