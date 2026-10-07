"use client";

import { Fragment, useEffect, useState } from "react";
import { t } from "@/i18n/t";
import type { PublicTeamRow } from "@/shared/schemas/batch";
import { flagLabels } from "@/shared/flags";
import { isInProgress } from "@/shared/status";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { ScoreChip, scoreClass } from "@/components/ui/ScoreChip";
import { FlagIcon } from "@/components/ui/StateIcon";

export interface Column {
  id: string;
  name: string;
  short: string;
  weight: number;
}

const SOFT_TIP_MS = 10_000;

/** TBL-01: one row per team; scores per rubric category, remarks on demand, failure reasons inline. */
export function TeamTable(props: {
  batchName: string;
  teams: PublicTeamRow[];
  columns: Column[];
  selectedId: string | null;
  onOpen: (id: string) => void;
  registerButton: (id: string, el: HTMLButtonElement | null) => void;
  /** Current rubric version; completed rows judged with another version are marked (RSM-03). */
  rubricVersion?: string;
  onRetry?: (teamId: string, rejudge: boolean) => void;
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  // null until mounted: the clock is never read during server rendering or hydration.
  const [now, setNow] = useState<number | null>(null);
  const anyActive = props.teams.some((r) => isInProgress(r.status));
  useEffect(() => {
    if (!anyActive) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [anyActive]);

  const span = 5 + props.columns.length;
  return (
    <div className="table-wrap team-table-wrap">
      <table className="team-table">
        <caption className="sr-only">{t("batch.tableCaption", { name: props.batchName })}</caption>
        <thead>
          <tr>
            <th scope="col" className="num">{t("batch.col.order")}</th>
            <th scope="col">{t("batch.col.team")}</th>
            <th scope="col">{t("batch.col.status")}</th>
            {props.columns.map((c) => (
              <th scope="col" key={c.id} title={c.name} className="col-cat">
                <abbr title={c.name}>{t("batch.col.weight", { short: c.short, weight: c.weight })}</abbr>
              </th>
            ))}
            <th scope="col">{t("batch.col.overall")}</th>
            <th scope="col" className="col-flags">{t("batch.col.flags")}</th>
          </tr>
        </thead>
        <tbody>
          {props.teams.map((r, i) => {
            const s = r.summary;
            const open = Boolean(expanded[r.subfolderId]);
            const slow = now !== null && isInProgress(r.status) && r.step && now - Date.parse(r.step.startedAt) >= SOFT_TIP_MS;
            const stale = Boolean(s && props.rubricVersion && s.rubricVersion !== props.rubricVersion);
            const flags = [
              ...(stale ? [t("flag.previousRubric")] : []),
              ...(s ? flagLabels(s) : []),
              ...r.warnings.map((w) => t("warn.multipleVideos", { count: w.count, chosen: w.chosen })),
            ];
            return (
              <Fragment key={r.subfolderId}>
                <tr className={props.selectedId === r.subfolderId ? "is-selected" : undefined} data-testid={`row-${r.subfolderId}`} data-status={r.status}>
                  <td className="num">{i + 1}</td>
                  <th scope="row">
                    <button
                      type="button"
                      className="row-open"
                      ref={(el) => props.registerButton(r.subfolderId, el)}
                      aria-label={t("batch.openTeam", { team: r.teamName })}
                      onClick={() => props.onOpen(r.subfolderId)}
                    >
                      {r.teamName}
                    </button>
                    {s && (
                      <button
                        type="button"
                        className="btn-text row-remarks"
                        aria-expanded={open}
                        aria-controls={`rm-${r.subfolderId}`}
                        aria-label={`${open ? t("batch.hideRemarks") : t("batch.showRemarks")} ${t("batch.remarksFor", { team: r.teamName })}`}
                        onClick={() => setExpanded((x) => ({ ...x, [r.subfolderId]: !open }))}
                      >
                        {open ? t("batch.hideRemarks") : t("batch.showRemarks")}
                      </button>
                    )}
                  </th>
                  <td>
                    <StatusBadge status={r.status} />
                    {r.step?.note && isInProgress(r.status) && <div className="cell-note">{r.step.note}</div>}
                    {slow && <div className="cell-note">{t("batch.moreTime")}</div>}
                    {r.error && <div className="cell-note cell-error">{r.error.message}</div>}
                    {props.onRetry && (r.status === "Failed" || stale) && (
                      <button
                        type="button"
                        className="btn-text"
                        aria-label={`${r.status === "Failed" ? t("batch.retryTeam") : t("batch.rejudge")} ${t("batch.actionFor", { team: r.teamName })}`}
                        onClick={() => props.onRetry!(r.subfolderId, r.status !== "Failed")}
                      >
                        {r.status === "Failed" ? t("batch.retryTeam") : t("batch.rejudge")}
                      </button>
                    )}
                  </td>
                  {props.columns.map((c) => {
                    const v = s?.categories[c.id];
                    const finalScore = s?.final?.categories[c.id];
                    const changed = v && finalScore !== undefined && finalScore !== v.score;
                    return (
                      <td key={c.id} className="col-cat">
                        {v ? (
                          changed ? (
                            <span className="score-overridden" role="img" aria-label={t("override.label", { name: c.name, final: finalScore, ai: v.score })}>
                              <ScoreChip score={finalScore} label={c.name} />
                              <s aria-hidden="true" className="mono muted">{v.score}</s>
                            </span>
                          ) : (
                            <ScoreChip score={v.score} label={c.name} />
                          )
                        ) : (
                          <span className="muted" aria-label={t("batch.noScore")}>–</span>
                        )}
                      </td>
                    );
                  })}
                  <td>
                    {s ? (
                      <>
                        <span className={`mono overall-cell ${scoreClass(s.final?.overallScore ?? s.overallScore)}`}>{(s.final?.overallScore ?? s.overallScore).toFixed(2)}</span>
                        {s.final?.overridden && (
                          <div className="cell-note">
                            <s>{t("override.ai", { score: s.overallScore.toFixed(2) })}</s> <span className="override-tag">{t("override.tag")}</span>
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="muted" aria-label={t("batch.noScore")}>–</span>
                    )}
                  </td>
                  <td className="col-flags">
                    <div className="flags flags-tight">
                      {flags.map((f) => (
                        <span className="flag" key={f}><FlagIcon />{f}</span>
                      ))}
                    </div>
                  </td>
                </tr>
                {s && open && (
                  <tr className="remarks-row" id={`rm-${r.subfolderId}`}>
                    <td colSpan={span}>
                      <dl className="remarks-grid">
                        {props.columns.map((c) => (
                          <Fragment key={c.id}>
                            <dt>{c.name}</dt>
                            <dd>{s.categories[c.id]?.remarks ?? "–"}</dd>
                          </Fragment>
                        ))}
                        <dt>{t("scorecard.comments")}</dt>
                        <dd>{s.overallComments}</dd>
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
