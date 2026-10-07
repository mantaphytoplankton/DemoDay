import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { sniffVideo } from "../../src/server/upload/sniff.ts";
import { streamToFile, FileTooLargeError } from "../../src/server/upload/stream-to-disk.ts";
import { canTransition, TEAM_STATUSES } from "../../src/shared/status.ts";
import { FsStore, StoreCorruptError } from "../../src/server/store/fs-store.ts";
import { assertEvaluationId } from "../../src/server/store/paths.ts";

const tmp = () => mkdtemp(path.join(tmpdir(), "dd-core-"));

describe("sniffVideo (SNG-01)", () => {
  it("should_accept_mp4_ftyp_and_webm_ebml_headers", () => {
    expect(sniffVideo(Buffer.from("\x00\x00\x00\x18ftypmp42", "latin1"))).toBe("mp4-family");
    expect(sniffVideo(Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x00]))).toBe("webm");
  });
  it("should_reject_text_and_short_input", () => {
    expect(sniffVideo(Buffer.from("hello this is not a video"))).toBeNull();
    expect(sniffVideo(Buffer.from([0x1a]))).toBeNull();
  });
});

describe("streamToFile", () => {
  const streamOf = (n: number) =>
    new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < n; i += 1000) c.enqueue(new Uint8Array(Math.min(1000, n - i)));
        c.close();
      },
    });
  it("should_write_all_bytes_when_under_limit", async () => {
    const f = path.join(await tmp(), "a.part");
    expect(await streamToFile(streamOf(5500), f, 10_000)).toBe(5500);
    expect((await readFile(f)).length).toBe(5500);
  });
  it("should_abort_and_delete_file_when_over_limit", async () => {
    const dir = await tmp();
    await expect(streamToFile(streamOf(20_000), path.join(dir, "b.part"), 10_000)).rejects.toBeInstanceOf(FileTooLargeError);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("status transitions", () => {
  it.each([
    ["Pending", "Uploading", true],
    ["Uploading", "Processing Video", true],
    ["Processing Video", "Scoring", true],
    ["Scoring", "Completed", true],
    ["Scoring", "Failed", true],
    ["Failed", "Pending", true],
    ["Completed", "Scoring", false],
    ["Pending", "Completed", false],
    ["Downloading", "Completed", true],
    ["Uploading", "Scoring", false],
  ] as const)("should_allow_%s_to_%s_is_%s", (from, to, ok) => {
    expect(canTransition(from, to)).toBe(ok);
  });
  it("should_define_a_rule_for_every_status", () => {
    for (const s of TEAM_STATUSES) expect(() => canTransition(s, "Pending")).not.toThrow();
  });
});

describe("FsStore", () => {
  const Doc = z.object({ n: z.number() });
  it("should_write_atomically_and_read_back", async () => {
    const store = new FsStore(await tmp());
    await store.writeJson("x/a.json", { n: 1 }, Doc);
    expect(await store.readJson("x/a.json", Doc)).toEqual({ n: 1 });
    expect((await readdir(path.join(store.root, "x"))).filter((f) => f.includes(".tmp"))).toEqual([]);
  });
  it("should_serialize_concurrent_updates_on_one_file", async () => {
    const store = new FsStore(await tmp());
    await store.writeJson("c.json", { n: 0 }, Doc);
    await Promise.all(Array.from({ length: 50 }, () => store.updateJson("c.json", Doc, (cur) => ({ n: (cur?.n ?? 0) + 1 }))));
    expect(await store.readJson("c.json", Doc)).toEqual({ n: 50 });
  });
  it("should_return_null_for_missing_and_quarantine_corrupt_files", async () => {
    const store = new FsStore(await tmp());
    expect(await store.readJson("missing.json", Doc)).toBeNull();
    await writeFile(path.join(store.root, "bad.json"), "{nope");
    await expect(store.readJson("bad.json", Doc)).rejects.toBeInstanceOf(StoreCorruptError);
    expect((await readdir(store.root)).some((f) => f.startsWith("bad.json.corrupt-"))).toBe(true);
  });
  it("should_refuse_paths_outside_the_root", async () => {
    const store = new FsStore(await tmp());
    await expect(store.readJson("../escape.json", Doc)).rejects.toThrow(/outside/);
  });
  it("should_validate_evaluation_ids", () => {
    expect(() => assertEvaluationId("../../etc/passwd")).toThrow();
    expect(assertEvaluationId("3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60")).toBe("3f1c2a9e-8b7d-4c6e-9f0a-1b2c3d4e5f60");
  });
});
