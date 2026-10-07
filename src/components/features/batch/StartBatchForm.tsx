"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import { t } from "@/i18n/t";
import { parseFolderUrl } from "@/shared/drive-url";
import { StateIcon } from "@/components/ui/StateIcon";

const Schema = z.object({
  folderUrl: z.string().trim().refine((v) => parseFolderUrl(v) !== null, { message: t("error.INVALID_FOLDER_URL") }),
});
type Values = z.infer<typeof Schema>;

/** BAT-01: paste a Drive folder link; the server validates the folder and starts or reopens the batch. */
export function StartBatchForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(Schema), defaultValues: { folderUrl: "" } });
  const error = formState.errors.folderUrl?.message ?? serverError;

  const onSubmit = async (v: Values) => {
    setServerError(null);
    try {
      const res = await fetch("/api/batches", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ folderUrl: v.folderUrl }) });
      const body = await res.json();
      if (res.status === 202) router.push(`/batches/${body.batchId}`);
      else setServerError(body?.error?.message ?? t("error.INTERNAL"));
    } catch {
      setServerError(t("error.DRIVE_UNAVAILABLE"));
    }
  };

  return (
    <form className="panel" onSubmit={handleSubmit(onSubmit)} noValidate aria-labelledby="start-title">
      <h2 className="panel-title" id="start-title">{t("batches.start")}</h2>
      <label className="field-label" htmlFor="folder-url">{t("batches.formLabel")}</label>
      <div className="field-row">
        <input
          id="folder-url"
          className="input"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder={t("batches.placeholder")}
          aria-invalid={error ? true : undefined}
          aria-describedby="folder-hint folder-error"
          {...register("folderUrl")}
        />
        <button type="submit" className="btn btn-primary" disabled={formState.isSubmitting}>
          {formState.isSubmitting ? t("batches.starting") : t("batches.start")}
        </button>
      </div>
      <p className="panel-sub" id="folder-hint" style={{ marginTop: 6 }}>{t("batches.formHint")}</p>
      <div id="folder-error" className="field-error" role="alert" hidden={!error}>
        {error && (<><StateIcon kind="failed" /><span>{error}</span></>)}
      </div>
    </form>
  );
}
