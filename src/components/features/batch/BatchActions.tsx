"use client";

import { useState } from "react";
import { t } from "@/i18n/t";
import { useRouter } from "next/navigation";
import { ConfirmDelete, deleteRequest } from "@/components/ui/ConfirmDelete";
import type { PublicBatch } from "@/shared/schemas/batch";

/** RSM-02/03 + TBL-04: batch-level controls. `onChanged` reconnects live updates after a state change. */
export function BatchActions({ batch, onChanged }: { batch: PublicBatch; onChanged: (patch?: Partial<PublicBatch>) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pending = batch.teams.some((t) => t.status === "Pending");
  const running = batch.status === "Running";

  const call = async (action: "pause" | "resume" | "rescan") => {
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(`/api/batches/${batch.id}/${action}`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.status !== 202) {
        setMessage(t("batch.actionFailed", { message: body?.error?.message ?? res.status }));
        return;
      }
      if (action === "pause") setMessage(t("batch.pausing"));
      if (action === "rescan") setMessage(t("batch.rescanned", { added: body.added ?? 0 }));
      onChanged(action === "pause" ? undefined : { status: "Running" });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="batch-actions">
      <div className="btn-row">
        {running && <button type="button" className="btn" disabled={busy !== null} onClick={() => call("pause")}>{t("batch.pause")}</button>}
        {!running && pending && <button type="button" className="btn btn-primary" disabled={busy !== null} onClick={() => call("resume")}>{t("batch.resume")}</button>}
        <button type="button" className="btn" disabled={busy !== null} onClick={() => call("rescan")}>{t("batch.rescan")}</button>
        <a className="btn" href={`/api/batches/${batch.id}/export.csv`} download="scores.csv">{t("batch.export")}</a>
        {!running && (
          <ConfirmDelete
            label={t("delete.batch")}
            title={t("delete.titleBatch", { name: batch.folderName })}
            body={t("delete.bodyBatch", { count: batch.teams.length })}
            onConfirm={async () => {
              const err = await deleteRequest(`/api/batches/${batch.id}`);
              if (!err) router.push("/batches");
              return err;
            }}
          />
        )}
      </div>
      <p className="segbar-text" role="status">{message}</p>
    </div>
  );
}
