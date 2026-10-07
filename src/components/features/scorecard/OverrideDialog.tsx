"use client";

import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { t } from "@/i18n/t";
import { StateIcon } from "@/components/ui/StateIcon";

const Schema = z.object({
  score: z.coerce.number({ message: t("error.OVERRIDE_SCORE_INVALID") }).int(t("error.OVERRIDE_SCORE_INVALID")).min(1, t("error.OVERRIDE_SCORE_INVALID")).max(5, t("error.OVERRIDE_SCORE_INVALID")),
  note: z.string().trim().min(1, t("error.OVERRIDE_NOTE_REQUIRED")).max(1000),
});
type Values = z.input<typeof Schema>;

/** TBL-03: modal override form. Esc or Cancel closes without saving; the browser returns focus to the trigger. */
export function OverrideDialog(props: {
  category: { id: string; name: string };
  aiScore: number;
  initial?: { score: number; note: string };
  onSubmit: (score: number, note: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(Schema),
    defaultValues: { score: props.initial?.score ?? props.aiScore, note: props.initial?.note ?? "" },
  });

  useEffect(() => {
    const d = ref.current;
    d?.showModal();
    const onClose = () => props.onClose();
    d?.addEventListener("close", onClose);
    return () => d?.removeEventListener("close", onClose);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const onValid = async (v: Values) => {
    setServerError(null);
    const parsed = Schema.parse(v);
    const err = await props.onSubmit(parsed.score, parsed.note);
    if (err) setServerError(err);
    else ref.current?.close();
  };
  const scoreError = formState.errors.score?.message;
  const noteError = formState.errors.note?.message;

  return (
    <dialog ref={ref} aria-labelledby="ovr-title" className="override-dialog">
      <form onSubmit={(e) => void handleSubmit(onValid)(e)} noValidate>
        <div className="dialog-head">
          <h2 id="ovr-title" className="panel-title" style={{ margin: 0 }}>{t("override.title", { name: props.category.name })}</h2>
        </div>
        <div className="dialog-body">
          <p className="panel-sub">{t("override.aiWas", { score: props.aiScore })}</p>
          <label className="field-label" htmlFor="ovr-score" style={{ marginTop: 12 }}>{t("override.scoreLabel")}</label>
          <input id="ovr-score" className="input input-narrow" type="number" inputMode="numeric" step={1} aria-invalid={scoreError ? true : undefined} aria-describedby="ovr-score-err" {...register("score")} />
          <div id="ovr-score-err" className="field-error" role="alert" hidden={!scoreError}>{scoreError && (<><StateIcon kind="failed" /><span>{scoreError}</span></>)}</div>
          <label className="field-label" htmlFor="ovr-note" style={{ marginTop: 12 }}>{t("override.noteLabel")}</label>
          <textarea id="ovr-note" className="input textarea" rows={3} aria-invalid={noteError ? true : undefined} aria-describedby="ovr-note-err" {...register("note")} />
          <div id="ovr-note-err" className="field-error" role="alert" hidden={!noteError}>{noteError && (<><StateIcon kind="failed" /><span>{noteError}</span></>)}</div>
          {serverError && <div className="field-error" role="alert"><StateIcon kind="failed" /><span>{t("override.failed", { message: serverError })}</span></div>}
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>{t("override.save")}</button>
            <button type="button" className="btn" onClick={() => ref.current?.close()}>{t("override.cancel")}</button>
          </div>
        </div>
      </form>
    </dialog>
  );
}
