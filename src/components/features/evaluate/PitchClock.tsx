import { t } from "@/i18n/t";
import { formatDuration } from "@/shared/format";

/** Shows the 3:00 limit, then the chosen video's length against it (ui-guideline.md section 2.2). */
export function PitchClock({ maxSeconds, durationSeconds }: { maxSeconds: number; durationSeconds: number | null | undefined }) {
  const limit = formatDuration(maxSeconds);
  if (durationSeconds == null) {
    return (
      <div className="clock" data-state="limit" data-testid="pitch-clock">
        <div className="clock-label">{t("clock.limit")}</div>
        <div className="clock-value"><span className="clock-num mono">{limit}</span></div>
        <div className="clock-note">{t("clock.limitNote")}</div>
      </div>
    );
  }
  const over = Math.round(durationSeconds) > maxSeconds;
  return (
    <div className="clock" data-state={over ? "over" : "ok"} data-testid="pitch-clock">
      <div className="clock-label">{t("clock.thisVideo")}</div>
      <div className="clock-value">
        <span className="clock-num mono">{formatDuration(durationSeconds)}</span>
        <span className="clock-limit">/ {limit}</span>
      </div>
      <div className="clock-note">{over ? t("clock.over", { limit }) : t("clock.ok", { limit })}</div>
    </div>
  );
}
