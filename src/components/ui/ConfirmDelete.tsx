"use client";

import { useRef, useState } from "react";
import { t } from "@/i18n/t";
import { StateIcon } from "./StateIcon";

/**
 * RSM-07: destructive action with the confirmation built into the page (ui-guideline.md 6.9; no window.confirm).
 * Cancel or Escape closes it and the browser returns focus to the trigger button.
 */
export function ConfirmDelete(props: { label: string; title: string; body: string; onConfirm: () => Promise<string | null> }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = async () => {
    setBusy(true);
    setError(null);
    const err = await props.onConfirm();
    setBusy(false);
    if (err) setError(t("delete.failed", { message: err }));
    else ref.current?.close();
  };
  return (
    <>
      <button type="button" className="btn btn-danger" onClick={() => { setError(null); ref.current?.showModal(); }}>
        {props.label}
      </button>
      <dialog ref={ref} aria-labelledby="del-title" aria-describedby="del-body">
        <div className="dialog-head">
          <h2 id="del-title" className="panel-title" style={{ margin: 0 }}>{props.title}</h2>
        </div>
        <div className="dialog-body">
          <p id="del-body">{props.body}</p>
          {error && <div className="field-error" role="alert"><StateIcon kind="failed" /><span>{error}</span></div>}
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button type="button" className="btn btn-danger" disabled={busy} onClick={confirm}>{t("delete.confirm")}</button>
            <button type="button" className="btn" autoFocus onClick={() => ref.current?.close()}>{t("delete.cancel")}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}

export async function deleteRequest(url: string): Promise<string | null> {
  const res = await fetch(url, { method: "DELETE" });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => null);
  return (body?.error?.message as string) ?? String(res.status);
}
