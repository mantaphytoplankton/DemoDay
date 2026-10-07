import type { Env } from "../env.ts";
import { DriveClient } from "./client.ts";

/** Live client when GOOGLE_DRIVE_API_KEY is set; the protocol fake in fixture mode; otherwise null. */
export async function createDriveClient(env: Env): Promise<DriveClient | null> {
  if (env.JUDGE_UPSTREAM === "fixture") {
    const { getSharedFakeDrive } = await import("../testing/drive-fake-shared.ts");
    const fake = getSharedFakeDrive();
    return new DriveClient({ apiKey: "fixture-key", baseUrl: fake.base, fetch: fake.fetch, ...(env.JUDGE_POLL_MS ? { retry: { attempts: 3, baseMs: 1, jitterMs: 0, maxRetryAfterMs: 1 } } : {}) });
  }
  return env.GOOGLE_DRIVE_API_KEY ? new DriveClient({ apiKey: env.GOOGLE_DRIVE_API_KEY }) : null;
}
