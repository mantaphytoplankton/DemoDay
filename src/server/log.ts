import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SECRET_KEYS = /^(key|apikey|api_key|token|authorization|password|secret|x-goog-api-key)$/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1)]));
}

let logDir: string | null = null;

/** Optionally mirror log lines to data/logs/YYYY-MM-DD.jsonl. */
export function setLogDir(dir: string | null): void {
  logDir = dir;
}

function write(level: "info" | "warn" | "error", event: string, data: Record<string, unknown> = {}) {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...(redact(data) as object) });
  (level === "error" ? console.error : console.log)(line);
  if (logDir) {
    const dir = logDir;
    const file = path.join(dir, `${new Date().toISOString().slice(0, 10)}.jsonl`);
    void mkdir(dir, { recursive: true }).then(() => appendFile(file, line + "\n")).catch(() => {});
  }
}

export const log = {
  info: (event: string, data?: Record<string, unknown>) => write("info", event, data),
  warn: (event: string, data?: Record<string, unknown>) => write("warn", event, data),
  error: (event: string, data?: Record<string, unknown>) => write("error", event, data),
};
