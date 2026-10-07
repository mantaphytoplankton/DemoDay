import type { Metadata } from "next";
import Link from "next/link";
import { getApp } from "@/server/app-context";
import { isEvaluationId } from "@/server/store/paths";
import { toPublic } from "@/shared/schemas/evaluation";
import { t } from "@/i18n/t";
import { ResultView } from "./ResultView";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const rec = isEvaluationId(id) ? await getApp().evaluations.get(id).catch(() => null) : null;
  return { title: `${rec ? rec.source.fileName : t("result.notFound")} · ${t("app.name")}` };
}

export default async function ResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const app = getApp();
  await app.ready;
  const rec = isEvaluationId(id) ? await app.evaluations.get(id).catch(() => null) : null;
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <p style={{ marginBottom: 12 }}><Link href="/evaluate">{t("result.back")}</Link></p>
      {rec ? (
        <ResultView initial={toPublic(rec)} />
      ) : (
        <>
          <div className="page-head"><h1 className="page-title">{t("result.notFound")}</h1></div>
          <div className="banner banner-info">
            <div>
              <p className="banner-body">{t("result.notFoundBody")}</p>
              <div className="btn-row"><Link className="btn btn-primary" href="/evaluate">{t("evaluate.again")}</Link></div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
