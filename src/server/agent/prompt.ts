import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { LoadedRubric } from "../rubric/load.ts";
import { formatDuration } from "../../shared/format.ts";

export interface Prompts {
  system: string;
  user: string;
  version: string;
}

/** Read the externalized prompts (JDG-02). Read per evaluation so edits apply to the next run. */
export async function loadPrompts(dir = path.join(process.cwd(), "prompts")): Promise<Prompts> {
  const [system, user] = await Promise.all([
    readFile(path.join(dir, "judge-system.md"), "utf8"),
    readFile(path.join(dir, "judge-user.md"), "utf8"),
  ]);
  const version = createHash("sha256").update(system).update("\n---\n").update(user).digest("hex").slice(0, 8);
  return { system: system.trim(), user, version };
}

export function renderUserPrompt(
  template: string,
  input: { rubric: LoadedRubric; displayName: string; durationSeconds: number },
): string {
  const { meta } = input.rubric;
  const categoryLines = meta.categories
    .map((c) => `- ${c.id}: ${c.name} (weight ${c.weight}%). 1 = ${c.tiers["1"]}; 3 = ${c.tiers["3"]}; 5 = ${c.tiers["5"]}.`)
    .join("\n");
  const vars: Record<string, string> = {
    rubricVersion: input.rubric.version,
    rubricPromptText: input.rubric.promptText,
    categoryLines,
    displayName: input.displayName,
    duration: formatDuration(input.durationSeconds),
    maxDuration: formatDuration(meta.maxDurationSeconds),
  };
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => vars[k] ?? m).trim();
}
