import { describe, it, expect } from "vitest";
import { csvCell, csvRow } from "../../src/server/csv/escape.ts";
import { buildScoresCsv } from "../../src/server/csv/scores-csv.ts";
import type { BatchManifest, TeamRow } from "../../src/shared/schemas/batch.ts";

/** Independent RFC 4180 parser (not the code under test). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\r" && text[i + 1] === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; i++; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

describe("csvCell (TBL-04)", () => {
  it("should_quote_every_cell_and_double_inner_quotes", () => {
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell(3.92)).toBe('"3.92"');
    expect(csvCell(null)).toBe('""');
  });
  it.each(["=SUM(A1)", "+1", "-2", "@cmd", "\tx", "\rx"])("should_neutralize_formula_like_text_%j", (v) => {
    expect(csvCell(v)).toBe(`"'${v.replace(/"/g, '""')}"`);
  });
  it("should_keep_line_breaks_inside_the_cell", () => {
    expect(parseCsv(csvRow(["a\nb\r\nc", "d"]))).toEqual([["a\nb\r\nc", "d"]]);
  });
});

const at = "2026-10-07T10:00:00.000Z";
const row = (name: string, order: number, extra: Partial<TeamRow> = {}): TeamRow => ({
  subfolderId: `teamFolder${String(order).padStart(8, "0")}`, teamName: name, order, status: "Pending", warnings: [], attempts: 0, ...extra,
});
const summary = (ws: number, remarks: string) => ({
  categories: { working_solution: { score: ws, remarks }, meaningful_ai: { score: 3, remarks: "AI ok" } },
  overallScore: 3.56, overallComments: 'Line one, "quoted"\nline two', durationSeconds: 204, exceedsMaxDuration: true,
  rubricVersion: "a7ba7139", model: "gemini-3.8-flash", completedAt: at,
});
const batch: BatchManifest = {
  schemaVersion: 1, id: "0123456789abcdef", rootFolderId: "fixtureHackathonRoot01", folderName: "F", folderUrl: "u",
  status: "Running", createdAt: at, updatedAt: at, lastScanAt: at,
  teams: [
    row("Team 10 Delta", 2, { status: "Scoring" }),
    row("=HYPERLINK(\"x\")", 1, { status: "Failed", error: { code: "NO_VIDEO_IN_FOLDER", message: "No video found in folder", step: "Downloading", at } }),
    row("团队 Ünïcode", 0, { status: "Completed", summary: summary(4, "Remark, with comma"), warnings: [{ code: "multipleVideos", count: 2, chosen: "v2.webm" }] }),
  ],
};
const columns = [
  { id: "working_solution", name: "Working Solution" },
  { id: "meaningful_ai", name: "Meaningful Use of AI" },
];

describe("buildScoresCsv transcript flag (JDG-08)", () => {
  it("should_list_an_early_transcript_end_in_the_flags_column", () => {
    const b: BatchManifest = { ...batch, teams: [row("Team A", 0, { status: "Completed", summary: { ...summary(4, "r"), transcriptEarlyEnd: 90 } })] };
    const rows = parseCsv(buildScoresCsv(b, columns).slice(1));
    const flags = rows[1]![rows[0]!.indexOf("Flags")]!;
    expect(flags).toBe("Exceeds 3-minute maximum (3:24); Transcript ends early (01:30 of 03:24)");
  });
});

describe("buildScoresCsv (TBL-04)", () => {
  const csv = buildScoresCsv(batch, columns);
  const rows = parseCsv(csv.slice(1));

  it("should_start_with_a_utf8_bom_and_use_crlf", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("\r\n");
  });

  it("should_have_a_header_and_one_row_per_team_in_queue_order", () => {
    expect(rows[0]).toEqual([
      "Team", "Status", "Status reason", "Video summary",
      "Working Solution AI score", "Working Solution final score", "Working Solution remarks",
      "Meaningful Use of AI AI score", "Meaningful Use of AI final score", "Meaningful Use of AI remarks",
      "Overall AI score", "Overall final score", "Overall comments",
      "Flags", "Warnings", "Overridden", "Rubric version", "Model", "Evaluated at",
    ]);
    expect(rows).toHaveLength(4);
    expect(rows.slice(1).map((r) => r[1])).toEqual(["Completed", "Failed", "Scoring"]);
  });

  it("should_keep_unicode_names_commas_quotes_and_multiline_comments_intact", () => {
    const done = rows[1]!;
    expect(done[0]).toBe("团队 Ünïcode");
    expect(done[3]).toBe(""); // no video summary (judged before JDG-09)
    expect(done[4]).toBe("4");
    expect(done[5]).toBe("4");
    expect(done[6]).toBe("Remark, with comma");
    expect(done[10]).toBe("3.56");
    expect(done[12]).toBe('Line one, "quoted"\nline two');
    expect(done[13]).toBe("Exceeds 3-minute maximum (3:24)");
    expect(done[14]).toBe("2 videos found; used the most recent (v2.webm)");
    expect(done[15]).toBe(""); // not overridden
    expect(done[18]).toBe(at);
  });

  it("should_neutralize_formula_like_team_names_and_leave_unscored_cells_empty", () => {
    expect(rows[2]![0]).toBe('\'=HYPERLINK("x")');
    expect(rows[2]![2]).toBe("No video found in folder");
    expect(rows[3]!.slice(3, 13).every((c) => c === "")).toBe(true);
  });
});
