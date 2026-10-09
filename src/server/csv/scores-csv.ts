import { csvRow } from "./escape.ts";
import type { BatchManifest } from "../../shared/schemas/batch.ts";
import { flagLabels } from "../../shared/flags.ts";
import { t } from "../../i18n/t.ts";

export interface CsvColumn {
  id: string;
  name: string;
}

/**
 * TBL-04: scores.csv for every team in queue order, built from batch.json only so it also works while the
 * batch runs. "Final" applies the judges' overrides (TBL-03); without overrides it equals the AI score.
 */
export function buildScoresCsv(batch: BatchManifest, columns: CsvColumn[]): string {
  const header = [
    "Team", "Status", "Status reason", "Video summary",
    ...columns.flatMap((c) => [`${c.name} AI score`, `${c.name} final score`, `${c.name} remarks`]),
    "Overall AI score", "Overall final score", "Overall comments",
    "Flags", "Warnings", "Overridden", "Rubric version", "Model", "Evaluated at",
  ];
  let out = "﻿" + csvRow(header);
  for (const r of [...batch.teams].sort((a, b) => a.order - b.order)) {
    const s = r.summary;
    const flags = s ? flagLabels(s) : [];
    const warnings = r.warnings.map((w) => t("warn.multipleVideos", { count: w.count, chosen: w.chosen }));
    out += csvRow([
      r.teamName,
      t(`status.${r.status}`),
      r.error?.message ?? "",
      s?.videoSummary ?? "",
      ...columns.flatMap((c) => {
        const v = s?.categories[c.id];
        return [v?.score ?? "", s?.final?.categories[c.id] ?? v?.score ?? "", v?.remarks ?? ""];
      }),
      s ? s.overallScore.toFixed(2) : "",
      s ? (s.final?.overallScore ?? s.overallScore).toFixed(2) : "",
      s?.overallComments ?? "",
      flags.join("; "),
      warnings.join("; "),
      s?.final?.overridden ? "yes" : "",
      s?.rubricVersion ?? "",
      s?.model ?? "",
      s?.completedAt ?? "",
    ]);
  }
  return out;
}
