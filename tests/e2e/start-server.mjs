// Starts the app for E2E: next dev with the Gemini protocol fake and an empty temp data dir.
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const port = process.argv[2] ?? "4310";
const dataDir = await mkdtemp(path.join(tmpdir(), "dd-e2e-"));
const child = spawn("npx", ["next", "dev", "-H", "127.0.0.1", "-p", port], {
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "development", JUDGE_UPSTREAM: "fixture", DATA_DIR: dataDir, NEXT_TELEMETRY_DISABLED: "1", NEXT_DIST_DIR: ".next-e2e" },
});
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", (code) => process.exit(code ?? 0));
