"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "@/i18n/t";
import type { PublicBatch } from "@/shared/schemas/batch";
import { useBatch } from "@/hooks/useBatch";
import { useUiStore } from "@/hooks/useUiStore";
import { BatchStatusBadge } from "./BatchStatusBadge";
import { TeamTable, type Column } from "./TeamTable";
import { ReviewPanel } from "./ReviewPanel";
import { BatchActions } from "./BatchActions";
import { useQueryClient } from "@tanstack/react-query";
import type { PublicBatch as Batch } from "@/shared/schemas/batch";

/** TBL-01 + TBL-02: live team table with a review panel; J/K move between teams, Esc closes. */
export function BatchView({ initial, columns, rubricVersion }: { initial: PublicBatch; columns: Column[]; rubricVersion?: string }) {
  const qc = useQueryClient();
  const [epoch, setEpoch] = useState(0);
  const batch = useBatch(initial.id, initial, epoch);
  /** After an action: optionally patch the cached batch, then reconnect live updates. */
  const changed = useCallback(
    (patch?: Partial<Batch>) => {
      if (patch) qc.setQueryData<Batch>(["batch", initial.id], (cur) => (cur ? { ...cur, ...patch } : cur));
      setEpoch((e) => e + 1);
    },
    [qc, initial.id],
  );
  const retryTeam = useCallback(
    async (teamId: string, rejudge: boolean) => {
      const res = await fetch(`/api/batches/${initial.id}/teams/${teamId}/retry`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rejudge }) });
      if (res.status !== 202) return;
      qc.setQueryData<Batch>(["batch", initial.id], (cur) =>
        cur ? { ...cur, status: "Running", teams: cur.teams.map((r) => (r.subfolderId === teamId ? { ...r, status: "Pending", error: undefined } : r)) } : cur,
      );
      setEpoch((e) => e + 1);
    },
    [qc, initial.id],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const rowButtons = useRef(new Map<string, HTMLButtonElement>());
  const shortcutsOff = useUiStore((s) => s.shortcutsOff);
  const teams = [...batch.teams].sort((a, b) => a.order - b.order);
  const openIdx = teams.findIndex((r) => r.subfolderId === openId);

  const close = useCallback(() => {
    const id = openId;
    setOpenId(null);
    if (id) requestAnimationFrame(() => rowButtons.current.get(id)?.focus());
  }, [openId]);
  const move = useCallback(
    (delta: number) => {
      if (teams.length === 0) return;
      const next = teams[Math.min(teams.length - 1, Math.max(0, (openIdx < 0 ? -1 : openIdx) + delta))]!;
      setOpenId(next.subfolderId);
    },
    [teams, openIdx],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector("dialog[open]")) return;
      if (e.target instanceof Element && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "Escape" && openId) {
        e.preventDefault();
        close();
        return;
      }
      if (shortcutsOff) return;
      if (e.key === "j" || e.key === "J") { e.preventDefault(); move(1); }
      if (e.key === "k" || e.key === "K") { e.preventDefault(); move(-1); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId, close, move, shortcutsOff]);

  const count = (pred: (s: string) => boolean) => teams.filter((r) => pred(r.status)).length;
  const completed = count((s) => s === "Completed");
  const failed = count((s) => s === "Failed");
  const pending = count((s) => s === "Pending");
  const active = teams.length - completed - failed - pending;
  const pct = (n: number) => `${teams.length ? (n / teams.length) * 100 : 0}%`;
  const open = openIdx >= 0 ? teams[openIdx]! : null;

  return (
    <div className={open ? "batch-layout has-panel" : "batch-layout"}>
      <div className="batch-main">
        <p style={{ marginBottom: 8 }}><Link href="/batches">{t("batch.back")}</Link></p>
        <div className="page-head">
          <h1 className="page-title">{batch.folderName}</h1>
          <BatchStatusBadge status={batch.status} />
        </div>
        <BatchActions batch={batch} onChanged={changed} />
        {batch.status === "Paused" && (
          <div className="banner banner-hold" style={{ marginBottom: 12 }}>
            <div>
              <p className="banner-title">{t("batch.pausedTitle")}</p>
              <p className="banner-body">{t("batch.pausedBody")}</p>
            </div>
          </div>
        )}
        {batch.status === "Interrupted" && (
          <div className="banner banner-hold" style={{ marginBottom: 12 }}>
            <div>
              <p className="banner-title">{t("batch.interruptedTitle")}</p>
              <p className="banner-body">{t("batch.interruptedBody")}</p>
            </div>
          </div>
        )}
        <div className="batch-progress">
          <div className="segbar" role="progressbar" aria-label={t("batch.progress")} aria-valuemin={0} aria-valuemax={teams.length} aria-valuenow={completed + failed}>
            <span className="seg seg-done" style={{ width: pct(completed) }} />
            <span className="seg seg-active" style={{ width: pct(active) }} />
            <span className="seg seg-failed" style={{ width: pct(failed) }} />
          </div>
          <p className="segbar-text" data-testid="batch-counts">{t("batch.counts", { completed, active, failed, pending })}</p>
        </div>
        <TeamTable
          batchName={batch.folderName}
          teams={teams}
          columns={columns}
          selectedId={openId}
          onOpen={setOpenId}
          rubricVersion={rubricVersion}
          onRetry={retryTeam}
          registerButton={(id, el) => {
            if (el) rowButtons.current.set(id, el);
            else rowButtons.current.delete(id);
          }}
        />
      </div>
      {open && (
        <ReviewPanel
          batchId={batch.id}
          row={open}
          onClose={close}
          onPrev={openIdx > 0 ? () => move(-1) : undefined}
          onNext={openIdx < teams.length - 1 ? () => move(1) : undefined}
        />
      )}
    </div>
  );
}
