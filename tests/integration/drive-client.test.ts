import { describe, it, expect } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DriveClient } from "../../src/server/drive/client.ts";
import { DriveError } from "../../src/server/drive/errors.ts";
import { FakeDrive, fixtureVideo, type FakeNode } from "../../src/server/testing/drive-fake.ts";
import { FileTooLargeError } from "../../src/server/upload/stream-to-disk.ts";

const signal = new AbortController().signal;
function client(fake: FakeDrive, sleeps: number[] = []) {
  return new DriveClient({ apiKey: "k", baseUrl: fake.base, fetch: fake.fetch, random: () => 0, sleep: async (ms) => void sleeps.push(ms) });
}

describe("DriveClient listing (BAT-02, BAT-03)", () => {
  it("should_list_team_subfolders_only_with_shared_drive_flags_and_key_header", async () => {
    const fake = new FakeDrive();
    const folders = await client(fake).listSubfolders("fixtureHackathonRoot01", signal);
    expect(folders.map((f) => f.name).sort()).toEqual(["Team 1 Alpha", "Team 10 Delta", "Team 2 Beta", "Team 3 Gamma", "Team 4 Echo", "Team 5 Foxtrot"]);
    expect(fake.requests.every((r) => r.hasKey && !r.path.includes("key="))).toBe(true);
  });

  it("should_read_all_pages_of_a_250_folder_parent", async () => {
    const nodes: FakeNode[] = [{ id: "bigRootFolder00001", name: "Big", mimeType: "application/vnd.google-apps.folder" }];
    for (let i = 0; i < 250; i++) nodes.push({ id: `teamFolder${String(i).padStart(8, "0")}`, name: `Team ${i}`, mimeType: "application/vnd.google-apps.folder", parent: "bigRootFolder00001" });
    const fake = new FakeDrive({ nodes, pageSize: 100 });
    expect(await client(fake).listSubfolders("bigRootFolder00001", signal)).toHaveLength(250);
    expect(fake.requests).toHaveLength(3);
  });

  it("should_return_videos_and_resolve_shortcuts_but_ignore_other_files", async () => {
    const c = client(new FakeDrive());
    expect((await c.listVideos("teamFolderAlpha001", signal)).map((v) => v.name)).toEqual(["demo.webm"]);
    expect(await c.listVideos("teamFolderBeta0001", signal)).toEqual([]);
    expect((await c.listVideos("teamFolderDelta001", signal)).map((v) => v.id)).toEqual(["videoDeltaReal001"]);
  });

  it("should_report_an_unshared_parent_as_denied", async () => {
    const e = await client(new FakeDrive()).getFolder("privateFolder00001", signal).catch((x) => x);
    expect(e).toBeInstanceOf(DriveError);
    expect((e as DriveError).kind).toBe("denied");
  });
});

describe("DriveClient retries (RSM-06)", () => {
  it("should_retry_a_rate_limit_and_report_the_attempt", async () => {
    const fake = new FakeDrive({ rateLimitOnce: { teamFolderAlpha001: 1 } });
    const notes: number[] = [];
    const sleeps: number[] = [];
    const videos = await client(fake, sleeps).listVideos("teamFolderAlpha001", signal, (n) => void notes.push(n));
    expect(videos).toHaveLength(1);
    expect(notes).toEqual([2]);
    expect(sleeps).toEqual([1000]);
  });

  it("should_give_up_after_3_attempts_on_server_errors", async () => {
    const fake = new FakeDrive({ brokenFolders: ["teamFolderAlpha001"] });
    const sleeps: number[] = [];
    const e = await client(fake, sleeps).listVideos("teamFolderAlpha001", signal).catch((x) => x);
    expect((e as DriveError).kind).toBe("retryable");
    expect(fake.requests).toHaveLength(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it("should_not_retry_a_permission_error", async () => {
    const fake = new FakeDrive();
    const dir = await mkdtemp(path.join(tmpdir(), "dd-drive-"));
    const e = await client(fake).download("videoEchoLocked01", path.join(dir, "x.webm"), { signal, maxBytes: 1e9 }).catch((x) => x);
    expect((e as DriveError).kind).toBe("denied");
    expect(fake.requests.filter((r) => r.path.includes("alt=media"))).toHaveLength(1);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("DriveClient download (BAT-04)", () => {
  it("should_stream_the_file_to_disk", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dd-drive-"));
    const dest = path.join(dir, "a.webm");
    const expected = fixtureVideo();
    expect(await client(new FakeDrive()).download("videoAlpha00000001", dest, { signal, maxBytes: 1e9, expectedSize: expected.length })).toBe(expected.length);
    expect((await readFile(dest)).equals(Buffer.from(expected))).toBe(true);
  });

  it("should_stop_and_delete_the_file_above_the_size_limit", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dd-drive-"));
    const e = await client(new FakeDrive()).download("videoAlpha00000001", path.join(dir, "a.webm"), { signal, maxBytes: 1000 }).catch((x) => x);
    expect(e).toBeInstanceOf(FileTooLargeError);
    expect(await readdir(dir)).toEqual([]);
  });
});
