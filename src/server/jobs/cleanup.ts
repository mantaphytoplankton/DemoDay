import type { Env } from "../env.ts";
import { createJudgeDeps } from "../agent/factory.ts";
import { log } from "../log.ts";

/** Best-effort removal of uploaded copies at the AI provider (RSM-07); failures are logged, never thrown. */
export async function deleteRemoteCopies(env: Env, names: string[]): Promise<void> {
  if (names.length === 0) return;
  try {
    const { provider } = await createJudgeDeps(env);
    for (const name of names) {
      await provider.deleteFile(name).catch((e: Error) => log.warn("delete.remote_failed", { file: name, reason: e.message }));
    }
  } catch (e) {
    log.warn("delete.remote_failed", { reason: (e as Error).message });
  }
}
