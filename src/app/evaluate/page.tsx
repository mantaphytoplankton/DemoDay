import type { Metadata } from "next";
import { getApp } from "@/server/app-context";
import { inspectRubric, defaultRubricLocation } from "@/server/rubric/load";
import { maxUploadLabel } from "@/server/http/respond";
import { toSummary } from "@/shared/schemas/evaluation";
import { t } from "@/i18n/t";
import { EvaluateView } from "@/components/features/evaluate/EvaluateView";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${t("evaluate.metaTitle")} · ${t("app.name")}` };

export default async function EvaluatePage() {
  const app = getApp();
  await app.ready;
  const [rubric, recent] = await Promise.all([inspectRubric(defaultRubricLocation(app.env.dataDir)), app.evaluations.list(8)]);
  return (
    <EvaluateView
      categories={(rubric.meta?.categories ?? []).map((c) => ({ id: c.id, name: c.name, weight: c.weight }))}
      maxSeconds={rubric.meta?.maxDurationSeconds ?? 180}
      maxBytes={app.env.maxUploadBytes}
      maxLabel={maxUploadLabel(app.env.maxUploadBytes)}
      recent={recent.map(toSummary)}
    />
  );
}
