import { t } from "@/i18n/t";

export function scoreClass(x: number): string {
  return `s${Math.min(5, Math.max(1, Math.floor(x + 0.5)))}`;
}

/** Numeral + five pips + colour; the accessible name carries the value (ui-guideline.md section 6.2). */
export function ScoreChip({ score, label }: { score: number; label: string }) {
  return (
    <span className={`score ${scoreClass(score)}`} role="img" aria-label={t("scorecard.scoreLabel", { name: label, score })}>
      <span className="score-num" aria-hidden="true">{score}</span>
      <span className="pips" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <i key={i} className={i <= score ? "on" : undefined} />
        ))}
      </span>
    </span>
  );
}
