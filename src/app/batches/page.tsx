import type { Metadata } from "next";
import Link from "next/link";
import { getApp } from "@/server/app-context";
import { toBatchSummary } from "@/shared/schemas/batch";
import { t } from "@/i18n/t";
import { PageBanner } from "@/components/brand/PageBanner";
import { PhotoCredit } from "@/components/brand/PhotoCredit";
import { StartBatchForm } from "@/components/features/batch/StartBatchForm";
import { BatchStatusBadge } from "@/components/features/batch/BatchStatusBadge";
import { LocalTime } from "@/components/ui/LocalTime";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${t("batches.metaTitle")} · ${t("app.name")}` };

export default async function BatchesPage() {
  const app = getApp();
  await app.ready;
  const batches = (await app.batches.list()).map(toBatchSummary);
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <PageBanner photo="room" alt={t("batches.photoAlt")} labelledBy="batches-title" compact>
        <h1 className="hero-title" id="batches-title">{t("batches.title")}</h1>
        <p className="hero-sub">{t("batches.sub")}</p>
      </PageBanner>
      <StartBatchForm />
      <section className="panel" aria-labelledby="list-title">
        <h2 className="panel-title" id="list-title">{t("batches.list")}</h2>
        {batches.length === 0 ? (
          <p className="panel-sub">{t("batches.listEmpty")}</p>
        ) : (
          <ul className="recent">
            {batches.map((b) => (
              <li key={b.id}>
                <div className="recent-row">
                  <Link href={`/batches/${b.id}`}>{b.folderName}</Link>
                  <BatchStatusBadge status={b.status} />
                </div>
                <div className="recent-meta">
                  <span>{t("batches.teamsCount", { completed: b.completed, total: b.total, failed: b.failed })}</span>
                  <LocalTime iso={b.updatedAt} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <PhotoCredit photo="room" />
    </div>
  );
}
