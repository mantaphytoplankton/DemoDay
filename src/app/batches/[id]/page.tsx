import type { Metadata } from "next";
import Link from "next/link";
import { getApp } from "@/server/app-context";
import { isBatchId } from "@/server/store/batches";
import { inspectRubric, defaultRubricLocation } from "@/server/rubric/load";
import { toPublicBatch } from "@/shared/schemas/batch";
import { t } from "@/i18n/t";
import { BatchView } from "@/components/features/batch/BatchView";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const b = isBatchId(id) ? await getApp().batches.get(id).catch(() => null) : null;
  return { title: `${b ? b.folderName : t("result.notFound")} · ${t("app.name")}` };
}

/** TBL-01: stored rows render on first paint from data/, then update live. */
export default async function BatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = getApp();
  await app.ready;
  const b = isBatchId(id) ? await app.batches.get(id).catch(() => null) : null;
  if (!b) {
    return (
      <div className="page" style={{ maxWidth: 960 }}>
        <div className="page-head"><h1 className="page-title">{t("result.notFound")}</h1></div>
        <p><Link href="/batches">{t("batch.back")}</Link></p>
      </div>
    );
  }
  const rubric = await inspectRubric(defaultRubricLocation(app.env.dataDir));
  const columns = (rubric.meta?.categories ?? []).map((c) => ({ id: c.id, name: c.name, short: c.short, weight: c.weight }));
  return <BatchView initial={toPublicBatch(b)} columns={columns} rubricVersion={rubric.meta ? rubric.version : undefined} />;
}
