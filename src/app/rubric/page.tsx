import type { Metadata } from "next";
import { getApp } from "@/server/app-context";
import { inspectRubric, defaultRubricLocation } from "@/server/rubric/load";
import { formatDuration } from "@/shared/format";
import { t } from "@/i18n/t";
import { PageBanner } from "@/components/brand/PageBanner";
import { PhotoCredit } from "@/components/brand/PhotoCredit";
import { StateIcon } from "@/components/ui/StateIcon";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `${t("rubric.title")} · ${t("app.name")}` };

/** JDG-01: the rubric the agent reads at the start of the next evaluation. */
export default async function RubricPage() {
  const app = getApp();
  const r = await inspectRubric(defaultRubricLocation(app.env.dataDir));
  const total = r.meta?.categories.reduce((s, c) => s + c.weight, 0) ?? 0;
  const relPath = r.source === "default" ? "config/rubric.default.md" : "data/rubric.md";
  return (
    <div className="page" style={{ maxWidth: 960 }}>
      <PageBanner photo="teams" alt={t("rubric.photoAlt")} labelledBy="rubric-title" compact>
        <h1 className="hero-title" id="rubric-title">{t("rubric.title")}</h1>
        <p className="hero-sub">{t("rubric.sub")}</p>
      </PageBanner>

      {r.error ? (
        <div className="banner banner-failed" role="alert">
          <span className="state state-failed"><StateIcon kind="failed" /></span>
          <div>
            <p className="banner-title">{t("rubric.invalidTitle")}</p>
            <p className="banner-body">{t("rubric.invalidBody", { detail: r.error })}</p>
          </div>
        </div>
      ) : (
        <div className="banner banner-info">
          <div>
            <p className="banner-title">{r.source === "default" ? t("rubric.defaultTitle") : t("rubric.activeTitle")}</p>
            <p className="banner-body">{r.source === "default" ? t("rubric.defaultBody") : t("rubric.activeBody")}</p>
          </div>
        </div>
      )}

      <section className="panel" style={{ marginTop: 12 }}>
        <h2 className="panel-title">{t("rubric.details")}</h2>
        <dl className="kv">
          <dt>{t("rubric.source")}</dt>
          <dd>{r.source === "default" ? t("scorecard.defaultRubric") : t("scorecard.activeRubric")} ({relPath})</dd>
          <dt>{t("rubric.version")}</dt>
          <dd className="mono" title={r.hash}>{r.version}</dd>
          <dt>{t("rubric.maxLength")}</dt>
          <dd className="mono">{r.meta ? formatDuration(r.meta.maxDurationSeconds) : "–"}</dd>
        </dl>
      </section>

      {r.meta && (
        <section className="panel">
          <h2 className="panel-title">{t("rubric.categories")}</h2>
          <div className="table-wrap">
            <table>
              <caption className="sr-only">{t("rubric.caption")}</caption>
              <thead>
                <tr>
                  <th scope="col">{t("rubric.colCategory")}</th>
                  <th scope="col" className="num">{t("rubric.colWeight")}</th>
                  <th scope="col">{t("rubric.colTier", { n: 1 })}</th>
                  <th scope="col">{t("rubric.colTier", { n: 3 })}</th>
                  <th scope="col">{t("rubric.colTier", { n: 5 })}</th>
                </tr>
              </thead>
              <tbody>
                {r.meta.categories.map((c) => (
                  <tr key={c.id}>
                    <th scope="row">{c.name}</th>
                    <td className="num">{c.weight}%</td>
                    <td>{c.tiers["1"]}</td>
                    <td>{c.tiers["3"]}</td>
                    <td>{c.tiers["5"]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="panel-sub" style={{ marginTop: 12 }}>{t("rubric.weightNote", { total })}</p>
        </section>
      )}

      <section className="panel">
        <h2 className="panel-title">{t("rubric.file")}</h2>
        <p className="panel-sub" style={{ marginBottom: 8 }}>{t("rubric.fileNote")}</p>
        <pre className="rubric-src" tabIndex={0} aria-label={t("rubric.fileLabel")}>{r.text}</pre>
      </section>
      <PhotoCredit photo="teams" />
    </div>
  );
}
