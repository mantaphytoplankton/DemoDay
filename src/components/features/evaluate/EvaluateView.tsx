"use client";

import Link from "next/link";
import { useState } from "react";
import { t } from "@/i18n/t";
import type { EvaluationSummary } from "@/shared/schemas/evaluation";
import { LogoMark } from "@/components/brand/LogoMark";
import { PageBanner } from "@/components/brand/PageBanner";
import { PhotoCredit } from "@/components/brand/PhotoCredit";
import { EvaluateClient } from "./EvaluateClient";
import { PitchClock } from "./PitchClock";
import { RecentEvaluations } from "./RecentEvaluations";

export interface StickerCategory {
  id: string;
  name: string;
  weight: number;
}

export function EvaluateView(props: { categories: StickerCategory[]; maxSeconds: number; maxBytes: number; maxLabel: string; recent: EvaluationSummary[] }) {
  const [duration, setDuration] = useState<number | null>(null);
  return (
    <div className="page">
      <PageBanner photo="pitch" alt={t("evaluate.photoAlt")} labelledBy="hero-title" priority aside={<PitchClock maxSeconds={props.maxSeconds} durationSeconds={duration} />}>
        <div className="lockup">
          <LogoMark size={40} />
          <span className="lockup-name">{t("app.name")}</span>
          <span className="lockup-tag"><b>{t("evaluate.lockupTitle")}</b>{t("evaluate.lockupTag")}</span>
        </div>
        <h1 className="hero-title" id="hero-title">
          {t("evaluate.title")}<span className="hl">{t("evaluate.titleHighlight")}</span>
        </h1>
        <p className="hero-sub">{t("evaluate.sub")}</p>
        <ul className="stickers" aria-label={t("evaluate.stickersLabel")}>
          {props.categories.map((c) => (
            <li className="sticker" key={c.id}>{c.name} <b>{c.weight}%</b></li>
          ))}
        </ul>
      </PageBanner>

      <div className="grid-eval">
        <EvaluateClient maxBytes={props.maxBytes} maxLabel={props.maxLabel} onDuration={setDuration} />
        <aside>
          <RecentEvaluations initial={props.recent} />
          <section className="panel" aria-labelledby="how-title">
            <h2 className="panel-title" id="how-title">{t("evaluate.howTitle")}</h2>
            <p className="panel-sub">{t("evaluate.howBody")}</p>
            <p className="panel-sub" style={{ marginTop: 8 }}><Link href="/rubric">{t("evaluate.howLink")}</Link></p>
          </section>
        </aside>
      </div>
      <PhotoCredit photo="pitch" />
    </div>
  );
}
