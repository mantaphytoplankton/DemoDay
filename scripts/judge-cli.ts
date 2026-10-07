/**
 * Developer harness: judge one local video with the real agent (agent-design.md section 14).
 *   npm run judge -- <video> [--json]
 * Reads .env.local. Uses the live Gemini API unless JUDGE_UPSTREAM=fixture.
 */
import { stat } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { getEnv, ConfigError } from "../src/server/env.ts";
import { loadRubric, defaultRubricLocation, RubricError } from "../src/server/rubric/load.ts";
import { judgeVideo, JudgeError } from "../src/server/agent/index.ts";
import { createJudgeDeps } from "../src/server/agent/factory.ts";
import { formatDuration } from "../src/shared/format.ts";

const MIME: Record<string, "video/mp4" | "video/quicktime" | "video/webm"> = { ".mp4": "video/mp4", ".mov": "video/quicktime", ".webm": "video/webm" };

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const asJson = args.includes("--json");
  if (!file) {
    console.error("Usage: npm run judge -- <video.mp4|.mov|.webm> [--json]");
    process.exit(2);
  }
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const env = getEnv();
  const mimeType = MIME[path.extname(file).toLowerCase()];
  if (!mimeType) throw new Error("Unsupported file type. Use MP4, MOV or WebM.");
  const { size } = await stat(file);
  const rubric = await loadRubric(defaultRubricLocation(env.dataDir));
  const deps = await createJudgeDeps(env);
  deps.log = () => {};

  const started = Date.now();
  const result = await judgeVideo(
    {
      source: { path: file, mimeType, sizeBytes: size, displayName: `cli-${started}` },
      rubric,
      signal: AbortSignal.timeout(30 * 60_000),
      onStep: (s, note) => console.error(`[${((Date.now() - started) / 1000).toFixed(1)}s] ${s}${note ? ` · ${note}` : ""}`),
      onRemoteFile: () => {},
    },
    deps,
  );

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`\n${path.basename(file)} · ${formatDuration(result.durationSeconds)}${result.exceedsMaxDuration ? " · OVER LIMIT" : ""}`);
  console.log(`Overall AI score: ${result.overallScore.toFixed(2)} / 5\n`);
  for (const c of result.rubric.categories) {
    const v = result.categories[c.id]!;
    console.log(`${c.name} (${c.weight}%): ${v.score}/5\n  ${v.remarks}\n`);
  }
  console.log(`Overall comments: ${result.overallComments}\n`);
  const p = result.provenance;
  console.log(`Model ${p.model}${p.modelVersion ? ` (${p.modelVersion})` : ""} · rubric ${p.rubricVersion} (${p.rubricSource}) · prompt ${p.promptVersion} · tokens ${p.usage.totalTokens} · repair ${p.repairUsed}`);
}

main().catch((e) => {
  if (e instanceof JudgeError) console.error(`Failed at ${e.step}: ${e.message}${e.detail ? ` [${e.detail}]` : ""}`);
  else if (e instanceof RubricError || e instanceof ConfigError) console.error(e.message);
  else console.error(e);
  process.exit(1);
});
