"use client";

import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicBatch } from "@/shared/schemas/batch";
import { t } from "@/i18n/t";
import type { PublicTeamRow, TeamDetail } from "@/shared/schemas/batch";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Scorecard } from "@/components/features/scorecard/Scorecard";

/** TBL-02: the selected team's full scorecard beside its Drive video. */
export function ReviewPanel(props: { batchId: string; row: PublicTeamRow; onClose: () => void; onPrev?: () => void; onNext?: () => void }) {
  const { row } = props;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const done = row.status === "Completed";
  const qc = useQueryClient();
  const teamKey = ["team", props.batchId, row.subfolderId, row.summary?.completedAt];
  const override = async (categoryId: string, change: { score: number; note: string } | { remove: true }) => {
    const res = await fetch(`/api/batches/${props.batchId}/teams/${row.subfolderId}/override`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ categoryId, ...change }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) return (body?.error?.message as string) ?? String(res.status);
    qc.setQueryData<TeamDetail>(teamKey, (cur) => (cur ? { ...cur, overrides: body.overrides } : cur));
    qc.setQueryData<PublicBatch>(["batch", props.batchId], (cur) =>
      cur ? { ...cur, teams: cur.teams.map((t) => (t.subfolderId === row.subfolderId ? body.row : t)) } : cur,
    );
    return null;
  };
  const detail = useQuery({
    queryKey: teamKey,
    queryFn: async () => (await (await fetch(`/api/batches/${props.batchId}/teams/${row.subfolderId}`, { cache: "no-store" })).json()) as TeamDetail,
    enabled: done,
    staleTime: Infinity,
  });

  useEffect(() => {
    headingRef.current?.focus();
  }, [row.subfolderId]);

  return (
    <aside className="review-panel" role="region" aria-label={t("panel.label", { team: row.teamName })}>
      <div className="review-head">
        <h2 className="panel-title" ref={headingRef} tabIndex={-1} style={{ margin: 0 }}>{row.teamName}</h2>
        <div className="btn-row">
          <button type="button" className="btn" onClick={props.onPrev} disabled={!props.onPrev} aria-keyshortcuts="K">{t("panel.prev")}</button>
          <button type="button" className="btn" onClick={props.onNext} disabled={!props.onNext} aria-keyshortcuts="J">{t("panel.next")}</button>
          <button type="button" className="btn" onClick={props.onClose} aria-keyshortcuts="Escape">{t("panel.close")}</button>
        </div>
      </div>
      {!done && (
        <div className="panel">
          <StatusBadge status={row.status} />
          <p className="panel-sub" style={{ marginTop: 8 }}>{row.error ? row.error.message : t("panel.notReady")}</p>
        </div>
      )}
      {done && row.video && (
        <div className="video-frame">
          <iframe
            title={t("panel.video")}
            src={`https://drive.google.com/file/d/${encodeURIComponent(row.video.fileId)}/preview`}
            loading="lazy"
            allow="autoplay; fullscreen"
            referrerPolicy="no-referrer"
          />
          <a href={`https://drive.google.com/file/d/${encodeURIComponent(row.video.fileId)}/view`} target="_blank" rel="noreferrer noopener">{t("panel.openInDrive")}</a>
        </div>
      )}
      {done && (detail.data?.result ? (
        <Scorecard
          title={detail.data.video.name}
          sizeBytes={detail.data.video.sizeBytes}
          result={detail.data.result}
          overrides={detail.data.overrides}
          final={row.summary?.final}
          onOverride={override}
        />
      ) : (
        <p className="panel-sub" role="status">{t("panel.loading")}</p>
      ))}
    </aside>
  );
}
