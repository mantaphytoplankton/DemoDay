// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkFile } from "../../src/components/features/evaluate/client-checks";
import { getEnv, ConfigError } from "../../src/server/env";
import { formatBytes, formatDuration } from "../../src/shared/format";
import { errorHelp, errorMessage, httpStatus } from "../../src/shared/errors";
import { t } from "../../src/i18n/t";

const webm = readFileSync(path.join(process.cwd(), "tests/fixtures/videos/team-alpha.webm"));
const fileOf = (bytes: Uint8Array, name: string, type: string) => new File([new Uint8Array(bytes)], name, { type });

describe("checkFile in the browser (SNG-01)", () => {
  it("should_accept_a_real_webm", async () => {
    expect(await checkFile(fileOf(webm, "team.webm", "video/webm"), 10_000_000)).toEqual({ ok: true, mime: "video/webm" });
  });
  it.each([
    ["slides.pdf", "application/pdf", "UNSUPPORTED_TYPE"],
    ["team.webm", "video/mp4", "UNSUPPORTED_TYPE"],
    ["clip.mp4", "video/mp4", "NOT_A_VIDEO"],
  ])("should_reject_%s_declared_%s_as_%s", async (name, type, code) => {
    expect(await checkFile(fileOf(webm, name, type), 10_000_000)).toEqual({ ok: false, code });
  });
  it("should_reject_text_named_mp4_and_oversized_and_empty_files", async () => {
    expect(await checkFile(fileOf(new TextEncoder().encode("hello"), "fake.mp4", "video/mp4"), 1000)).toEqual({ ok: false, code: "NOT_A_VIDEO" });
    expect(await checkFile(fileOf(webm, "big.webm", "video/webm"), 100)).toEqual({ ok: false, code: "FILE_TOO_LARGE" });
    expect(await checkFile(fileOf(new Uint8Array(), "e.webm", "video/webm"), 100)).toEqual({ ok: false, code: "EMPTY_FILE" });
  });
});

describe("getEnv", () => {
  it("should_require_the_gemini_key_in_live_mode_without_echoing_values", () => {
    expect(() => getEnv({ NODE_ENV: "development" })).toThrow(ConfigError);
    expect(() => getEnv({ NODE_ENV: "development" })).toThrow(/GEMINI_API_KEY is not set/);
  });
  it("should_refuse_fixture_mode_in_production", () => {
    expect(() => getEnv({ NODE_ENV: "production", JUDGE_UPSTREAM: "fixture" })).toThrow(/not allowed/);
  });
  it("should_apply_defaults", () => {
    const e = getEnv({ NODE_ENV: "development", GEMINI_API_KEY: "k" });
    expect(e).toMatchObject({ GEMINI_MODEL: "gemini-3.8-flash", GEMINI_TEMPERATURE: 0.2, GEMINI_VIDEO_FPS: 1, MAX_UPLOAD_MB: 1024, GEMINI_SCORING_TIMEOUT_S: 120 });
    expect(e.maxUploadBytes).toBe(1024 * 1024 * 1024);
  });
  it("should_name_an_invalid_variable_but_not_its_value", () => {
    let msg = "";
    try {
      getEnv({ NODE_ENV: "development", GEMINI_API_KEY: "secret-value", GEMINI_TEMPERATURE: "hot" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("GEMINI_TEMPERATURE");
    expect(msg).not.toContain("secret-value");
  });
});

describe("format, errors and i18n", () => {
  it("should_format_durations_and_sizes", () => {
    expect(formatDuration(204)).toBe("3:24");
    expect(formatDuration(180.4)).toBe("3:00");
    expect([formatBytes(512), formatBytes(2048), formatBytes(5 * 1024 ** 2), formatBytes(1.5 * 1024 ** 3)]).toEqual(["512 B", "2 KB", "5.0 MB", "1.50 GB"]);
  });
  it("should_map_codes_to_story_wording_status_and_help", () => {
    expect(errorMessage("FILE_TOO_LARGE", { maxMb: "1 GB" })).toBe("File is larger than 1 GB");
    expect(httpStatus("FILE_TOO_LARGE")).toBe(413);
    expect(errorHelp("AI_UNAVAILABLE")).toBe("No score was saved. Evaluate the video again in a few minutes.");
    expect(errorHelp("INVALID_MODEL_OUTPUT")).toBe("No score was saved. Evaluate the video again.");
  });
  it("should_keep_unknown_placeholders_visible", () => {
    expect(t("evaluate.softTip")).toBe("More time is needed. Still {step}…");
  });
  it("should_never_use_the_word_timeout_in_any_message", async () => {
    const en = (await import("../../src/i18n/messages/en.json")).default as Record<string, string>;
    expect(Object.values(en).filter((v) => /timeout/i.test(v))).toEqual([]);
  });
});
