import { FakeDrive } from "./drive-fake.ts";

const g = globalThis as unknown as { __demodayFakeDrive?: FakeDrive };

export function getSharedFakeDrive(): FakeDrive {
  g.__demodayFakeDrive ??= new FakeDrive({ rateLimitOnce: { teamFolderAlpha001: 1 } });
  return g.__demodayFakeDrive;
}
