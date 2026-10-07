import { describe, it, expect } from "vitest";
import { parseFolderUrl } from "../../src/server/drive/url.ts";
import { selectVideo, type DriveFile } from "../../src/server/drive/select-video.ts";
import { classifyDriveResponse } from "../../src/server/drive/errors.ts";
import { naturalCompare } from "../../src/shared/sort.ts";

describe("parseFolderUrl (BAT-01)", () => {
  it.each([
    ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp", "1AbCdEfGhIjKlMnOp"],
    ["https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp?usp=sharing", "1AbCdEfGhIjKlMnOp"],
    ["https://drive.google.com/drive/u/1/folders/1AbCdEfGhIjKlMnOp", "1AbCdEfGhIjKlMnOp"],
    ["https://drive.google.com/drive/mobile/folders/1AbCdEfGhIjKlMnOp", "1AbCdEfGhIjKlMnOp"],
    ["https://drive.google.com/open?id=1AbCdEfGhIjKlMnOp", "1AbCdEfGhIjKlMnOp"],
    ["  drive.google.com/drive/folders/1AbCdEfGhIjKlMnOp  ", "1AbCdEfGhIjKlMnOp"],
  ])("should_extract_the_folder_id_from_%s", (url, id) => {
    expect(parseFolderUrl(url)).toBe(id);
  });
  it.each([
    "https://example.com/videos",
    "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view",
    "https://drive.google.com/drive/folders/",
    "https://drive.google.com.evil.com/drive/folders/1AbCdEfGhIjKlMnOp",
    "https://drive.google.com/drive/folders/abc",
    "not a url",
    "",
  ])("should_reject_%s", (url) => {
    expect(parseFolderUrl(url)).toBeNull();
  });
});

describe("selectVideo (BAT-03)", () => {
  const v = (id: string, modifiedTime: string, extra: Partial<DriveFile> = {}): DriveFile => ({ id, name: `${id}.webm`, mimeType: "video/webm", modifiedTime, size: "100", ...extra });
  it("should_fail_when_no_video_exists", () => {
    expect(selectVideo([])).toEqual({ kind: "none" });
  });
  it("should_pick_the_only_video_without_warning", () => {
    expect(selectVideo([v("a", "2026-10-01T00:00:00Z")])).toMatchObject({ kind: "one", file: { id: "a" }, others: 0 });
  });
  it("should_pick_the_most_recent_of_several_and_report_how_many", () => {
    const r = selectVideo([v("v1", "2026-10-01T00:00:00Z"), v("v2", "2026-10-03T00:00:00Z"), v("v0", "2026-09-01T00:00:00Z")]);
    expect(r).toMatchObject({ kind: "one", file: { id: "v2" }, others: 2 });
  });
});

describe("classifyDriveResponse (RSM-06)", () => {
  const res = (status: number, reason?: string) =>
    new Response(JSON.stringify({ error: { code: status, message: "m", errors: reason ? [{ reason }] : [] } }), { status, headers: { "retry-after": "3" } });
  it.each([
    [429, undefined, "retryable"],
    [403, "rateLimitExceeded", "retryable"],
    [403, "userRateLimitExceeded", "retryable"],
    [500, undefined, "retryable"],
    [503, undefined, "retryable"],
    [403, "insufficientFilePermissions", "denied"],
    [403, "cannotDownloadAbusiveFile", "denied"],
    [404, "notFound", "denied"],
    [400, "badRequest", "denied"],
  ] as const)("should_classify_%s_%s_as_%s", async (status, reason, kind) => {
    const e = await classifyDriveResponse(res(status, reason), "list");
    expect(e.kind).toBe(kind);
  });
  it("should_honour_retry_after", async () => {
    expect((await classifyDriveResponse(res(429), "list")).retryAfterMs).toBe(3000);
  });
});

describe("naturalCompare (BAT-02 stable team order)", () => {
  it("should_sort_numbers_inside_names_numerically", () => {
    expect(["Team 10", "team 2", "Team 1", "Alpha"].sort(naturalCompare)).toEqual(["Alpha", "Team 1", "team 2", "Team 10"]);
  });
});

describe("isDriveError", () => {
  it("should_recognise_drive_errors_from_another_module_instance", async () => {
    const { isDriveError, DriveError } = await import("../../src/server/drive/errors.ts");
    const foreign = Object.assign(new Error("x"), { name: "DriveError", kind: "denied" });
    expect(isDriveError(foreign)).toBe(true);
    expect(isDriveError(new DriveError("denied", 404, "m"))).toBe(true);
    expect(isDriveError(new Error("x"))).toBe(false);
    expect(isDriveError(null)).toBe(false);
  });
});
