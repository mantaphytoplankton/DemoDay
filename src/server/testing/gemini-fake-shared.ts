import { FakeGemini } from "./gemini-fake.ts";

const g = globalThis as unknown as { __demodayFakeGemini?: FakeGemini };

/** One fake per process in fixture mode, so polls see the files that uploads created. */
export function getSharedFakeGemini(): FakeGemini {
  g.__demodayFakeGemini ??= new FakeGemini();
  return g.__demodayFakeGemini;
}
