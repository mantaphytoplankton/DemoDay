"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { t } from "@/i18n/t";
import type { EvaluationSummary } from "@/shared/schemas/evaluation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { scoreClass } from "@/components/ui/ScoreChip";
import { LocalTime } from "@/components/ui/LocalTime";

export function RecentEvaluations({ initial }: { initial: EvaluationSummary[] }) {
  const { data } = useQuery({
    queryKey: ["evaluations"],
    queryFn: async () => ((await (await fetch("/api/evaluations?limit=8", { cache: "no-store" })).json()) as { items: EvaluationSummary[] }).items,
    initialData: initial,
  });
  const items = data ?? [];
  return (
    <section className="panel" aria-labelledby="recent-title">
      <h2 className="panel-title" id="recent-title">{t("evaluate.recent")}</h2>
      {items.length === 0 ? (
        <p className="panel-sub">{t("evaluate.recentEmpty")}</p>
      ) : (
        <ul className="recent">
          {items.map((e) => (
            <li key={e.id}>
              <div className="recent-row">
                <Link href={`/results/${e.id}`}>{e.fileName}</Link>
                {e.overallScore !== undefined && (
                  <span className={`mono ${scoreClass(e.overallScore)}`} style={{ color: "var(--sc)", fontWeight: 600 }}>{e.overallScore.toFixed(2)}</span>
                )}
              </div>
              <div className="recent-meta">
                <StatusBadge status={e.status} />
                <LocalTime iso={e.updatedAt} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
