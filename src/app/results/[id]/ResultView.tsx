"use client";

import Link from "next/link";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { t } from "@/i18n/t";
import { errorHelp } from "@/shared/errors";
import type { PublicEvaluation } from "@/shared/schemas/evaluation";
import { useEvaluation } from "@/hooks/useEvaluation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StateIcon } from "@/components/ui/StateIcon";
import { LocalTime } from "@/components/ui/LocalTime";
import { ConfirmDelete, deleteRequest } from "@/components/ui/ConfirmDelete";
import { useRouter } from "next/navigation";
import { isInProgress } from "@/shared/status";
import { ReviewLayout } from "@/components/features/scorecard/ReviewLayout";

export function ResultView({ initial }: { initial: PublicEvaluation }) {
  const qc = useQueryClient();
  const router = useRouter();
  const [epoch, setEpoch] = useState(0);
  const ev = useEvaluation(initial.id, initial, epoch) ?? initial;
  const retry = async () => {
    const res = await fetch(`/api/evaluations/${initial.id}/retry`, { method: "POST" });
    if (res.status !== 202) return;
    qc.setQueryData(["evaluation", initial.id], { ...ev, status: "Pending", error: undefined });
    setEpoch((e) => e + 1);
  };
  const deletable = !(ev.status === "Pending" || isInProgress(ev.status));
  const deleteControl = deletable ? (
    <ConfirmDelete
      label={t("delete.evaluation")}
      title={t("delete.titleEvaluation", { name: ev.source.fileName })}
      body={t("delete.bodyEvaluation")}
      onConfirm={async () => {
        const err = await deleteRequest(`/api/evaluations/${ev.id}`);
        if (!err) {
          qc.removeQueries({ queryKey: ["evaluation", ev.id] });
          void qc.invalidateQueries({ queryKey: ["evaluations"] });
          router.push("/evaluate");
        }
        return err;
      }}
    />
  ) : null;
  if (ev.status === "Completed" && ev.result) {
    return (
      <>
        <div className="page-head"><h1 className="page-title">{t("result.title")}</h1><StatusBadge status="Completed" /><span className="page-head-end">{deleteControl}</span></div>
        <ReviewLayout evaluation={ev} />
      </>
    );
  }
  if (ev.status === "Failed" && ev.error) {
    return (
      <>
        <div className="page-head"><h1 className="page-title">{ev.source.fileName}</h1><StatusBadge status="Failed" /><span className="page-head-end">{deleteControl}</span></div>
        <div className="banner banner-failed">
          <span className="state state-failed"><StateIcon kind="failed" /></span>
          <div>
            <p className="banner-title">{ev.error.message}</p>
            <p className="banner-body">
              {t("result.failedAtStep", { step: t(`status.${ev.error.step}`) })} <LocalTime iso={ev.error.at} />. {errorHelp(ev.error.code)}
            </p>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={retry}>{t("evaluate.retry")}</button>
              <Link className="btn" href="/evaluate">{t("evaluate.again")}</Link>
            </div>
          </div>
        </div>
      </>
    );
  }
  return (
    <>
      <div className="page-head"><h1 className="page-title">{ev.source.fileName}</h1><StatusBadge status={ev.status} /></div>
      <div className="banner banner-info"><div><p className="banner-body">{t("result.inProgress")}</p></div></div>
    </>
  );
}
