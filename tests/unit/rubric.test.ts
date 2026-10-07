import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseRubric, inspectRubric, loadRubric, RubricError } from "../../src/server/rubric/load.ts";

const DEFAULT_PATH = path.join(process.cwd(), "config/rubric.default.md");

const wrap = (json: string) => `# Rubric\n\nIntro text.\n\n\`\`\`json rubric-meta\n${json}\n\`\`\`\n\n## Category guidance\nText.\n`;
const validMeta = {
  schemaVersion: 1,
  maxDurationSeconds: 180,
  categories: [
    { id: "working_solution", name: "Working Solution", short: "WS", weight: 25, tiers: { "1": "a", "3": "b", "5": "c" } },
    { id: "meaningful_ai", name: "Meaningful Use of AI", short: "AI", weight: 20, tiers: { "1": "a", "3": "b", "5": "c" } },
  ],
};

describe("parseRubric", () => {
  it("should_parse_meta_and_strip_block_when_rubric_is_valid", () => {
    const { meta, promptText } = parseRubric(wrap(JSON.stringify(validMeta)));
    expect(meta.categories.map((c) => c.id)).toEqual(["working_solution", "meaningful_ai"]);
    expect(promptText).not.toContain("rubric-meta");
    expect(promptText).toContain("Intro text.");
    expect(promptText).toContain("## Category guidance");
  });

  it("should_reject_when_meta_block_is_missing", () => {
    expect(() => parseRubric("# Rubric\nNo block")).toThrow(/No rubric-meta block/);
  });

  it("should_reject_when_two_meta_blocks_exist", () => {
    const one = "```json rubric-meta\n" + JSON.stringify(validMeta) + "\n```";
    expect(() => parseRubric(`${one}\n${one}`)).toThrow(/More than one rubric-meta block/);
  });

  it("should_reject_when_meta_is_not_json", () => {
    expect(() => parseRubric(wrap("{ not json"))).toThrow(/not valid JSON/);
  });

  it("should_reject_when_a_weight_is_missing", () => {
    const bad = structuredClone(validMeta) as Record<string, unknown> & typeof validMeta;
    delete (bad.categories[1] as Partial<(typeof validMeta.categories)[number]>).weight;
    expect(() => parseRubric(wrap(JSON.stringify(bad)))).toThrow(RubricError);
  });

  it("should_reject_when_category_ids_are_duplicated", () => {
    const bad = structuredClone(validMeta);
    bad.categories[1]!.id = "working_solution";
    expect(() => parseRubric(wrap(JSON.stringify(bad)))).toThrow(/Duplicate category id/);
  });

  it("should_reject_when_weight_is_not_a_number", () => {
    const bad = JSON.stringify(validMeta).replace('"weight":20', '"weight":"twenty"');
    expect(() => parseRubric(wrap(bad))).toThrow(RubricError);
  });
});

describe("default rubric file", () => {
  it("should_define_the_three_brd_categories_with_25_20_15_weights", async () => {
    const r = await inspectRubric({ dataDir: "/nonexistent-dir", defaultPath: DEFAULT_PATH });
    expect(r.error).toBeNull();
    expect(r.source).toBe("default");
    expect(r.meta?.maxDurationSeconds).toBe(180);
    expect(r.meta?.categories.map((c) => [c.name, c.weight])).toEqual([
      ["Working Solution", 25],
      ["Meaningful Use of AI", 20],
      ["User Experience & Value", 15],
    ]);
    expect(r.meta?.categories[0]?.tiers).toEqual({ "1": "Mostly concept", "3": "Core flow works", "5": "Convincing across realistic cases" });
  });

  it("should_mention_common_pitfalls_and_audience_expectations", async () => {
    const r = await inspectRubric({ dataDir: "/nonexistent-dir", defaultPath: DEFAULT_PATH });
    expect(r.promptText).toMatch(/slideware/i);
    expect(r.promptText).toMatch(/hardcoded mockups/i);
    expect(r.promptText).toMatch(/target audience/i);
  });
});

describe("inspectRubric / loadRubric", () => {
  it("should_prefer_active_rubric_in_data_dir", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dd-rubric-"));
    await writeFile(path.join(dir, "rubric.md"), wrap(JSON.stringify(validMeta)));
    const r = await loadRubric({ dataDir: dir, defaultPath: DEFAULT_PATH });
    expect(r.source).toBe("active");
    expect(r.meta.categories).toHaveLength(2);
    expect(r.version).toHaveLength(8);
    expect(r.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("should_pick_up_edits_on_next_load_without_restart", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dd-rubric-"));
    await writeFile(path.join(dir, "rubric.md"), wrap(JSON.stringify(validMeta)));
    const first = await loadRubric({ dataDir: dir, defaultPath: DEFAULT_PATH });
    const edited = structuredClone(validMeta);
    edited.categories[0]!.weight = 30;
    await writeFile(path.join(dir, "rubric.md"), wrap(JSON.stringify(edited)));
    const second = await loadRubric({ dataDir: dir, defaultPath: DEFAULT_PATH });
    expect(second.meta.categories[0]!.weight).toBe(30);
    expect(second.version).not.toBe(first.version);
  });

  it("should_report_error_without_throwing_when_inspecting_invalid_rubric", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "dd-rubric-"));
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "rubric.md"), wrap("{ broken"));
    const r = await inspectRubric({ dataDir: dir, defaultPath: DEFAULT_PATH });
    expect(r.meta).toBeNull();
    expect(r.error).toMatch(/not valid JSON/);
    await expect(loadRubric({ dataDir: dir, defaultPath: DEFAULT_PATH })).rejects.toBeInstanceOf(RubricError);
  });
});
