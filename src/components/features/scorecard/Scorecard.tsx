"use client";

import { forwardRef, useEffect, useId, useRef, useState } from "react";
import { t } from "@/i18n/t";
import { formatBytes, formatDuration } from "@/shared/format";
import type { JudgeResult } from "@/shared/schemas/judge-result";
import { ScoreChip, scoreClass } from "@/components/ui/ScoreChip";
import { FlagIcon } from "@/components/ui/StateIcon";
import { LocalTime } from "@/components/ui/LocalTime";
import { flagLabels } from "@/shared/flags";
import { EvidenceStrip, ObservationList, TimestampedText } from "./EvidenceStrip";
import { OverrideDialog } from "./OverrideDialog";
import type { FinalScores, Overrides } from "@/shared/scoring";
import { useUiStore } from "@/hooks/useUiStore";

function tierText(score: number, tiers: { "1": string; "3": string; "5": string }): string {
  if (score === 1) return tiers["1"];
  if (score === 2) return t("scorecard.between", { a: tiers["1"], b: tiers["3"] });
  if (score === 3) return tiers["3"];
  if (score === 4) return t("scorecard.between", { a: tiers["3"], b: tiers["5"] });
  return tiers["5"];
}


/** SNG-03: category scores with weights and expandable remarks, weighted overall, comments, flags, provenance. */
export interface ScorecardProps {
  title: string;
  sizeBytes?: number;
  result: JudgeResult;
  /** When a seekable video is shown beside the scorecard, timestamps jump it (SNG-04). */
  onSeek?: (seconds: number) => void;
  /** Human overrides (TBL-03). `onOverride` returns an error message, or null when saved. */
  overrides?: Overrides;
  final?: FinalScores;
  onOverride?: (categoryId: string, change: { score: number; note: string } | { remove: true }) => Promise<string | null>;
}

export const Scorecard = forwardRef<HTMLHeadingElement, ScorecardProps>(function Scorecard({ title, sizeBytes, result, onSeek, overrides = {}, final, onOverride }, headingRef) {
  const r = result;
  const uid = useId();
  const cats = r.rubric.categories;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const allOpen = cats.every((c) => open[c.id]);
  const toggleAll = () => setOpen(Object.fromEntries(cats.map((c) => [c.id, !allOpen])));

  const signal = useUiStore((s) => s.toggleAllSignal);
  const first = useRef(signal);
  const toggleRef = useRef(toggleAll);
  toggleRef.current = toggleAll;
  useEffect(() => {
    if (signal !== first.current) toggleRef.current();
  }, [signal]);

  const flags = flagLabels({ ...r, maxDurationSeconds: r.rubric.maxDurationSeconds });
  const overridden = Boolean(final?.overridden);
  const shownOverall = overridden ? final!.overallScore : r.overallScore;
  const cls = scoreClass(shownOverall);
  const [editing, setEditing] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <article className="panel" aria-labelledby={`${uid}-title`}>
      <div className="scorecard-head">
        <div>
          <h2 className="panel-title" id={`${uid}-title`} ref={headingRef} tabIndex={-1} style={{ margin: 0 }}>
            {title}
          </h2>
          <div className="file-row secondary" style={{ fontSize: 13 }}>
            <span className="mono">{formatDuration(r.durationSeconds)}</span>
            {sizeBytes !== undefined && <span>{formatBytes(sizeBytes)}</span>}
            <span>{t("scorecard.evaluatedPrefix")} <LocalTime iso={r.provenance.finishedAt} /></span>
          </div>
          {flags.length > 0 && (
            <div className="flags" aria-label={t("scorecard.flags")}>
              {flags.map((f) => (
                <span className="flag" key={f}>
                  <FlagIcon />
                  {f}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={`overall ${cls}`}>
          <div className="overall-label">{overridden ? t("override.final") : t("scorecard.overall")}</div>
          <div className="overall-value">
            <span className="overall-num" data-testid="overall-score">{shownOverall.toFixed(2)}</span>
            <span className="overall-of">{t("scorecard.outOf")}</span>
          </div>
          {overridden && (
            <div className="overall-ai">
              <s>{t("override.ai", { score: r.overallScore.toFixed(2) })}</s> <span className="override-tag">{t("override.tag")}</span>
            </div>
          )}
          <div className="overall-weights">
            {t("scorecard.weighted")} · {cats.map((c) => `${c.short} ${c.weight}%`).join(" · ")}
          </div>
        </div>
      </div>

      <div className="btn-row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <h3 className="section-label" style={{ margin: "8px 0 0" }}>{t("scorecard.categories")}</h3>
        <button type="button" className="btn-text" aria-keyshortcuts="E" data-remarks-toggle onClick={toggleAll}>
          {allOpen ? t("scorecard.hideAll") : t("scorecard.showAll")}
        </button>
      </div>
      <ul className="cats">
        {cats.map((c) => {
          const v = r.categories[c.id]!;
          const isOpen = Boolean(open[c.id]);
          const rid = `${uid}-rem-${c.id}`;
          return (
            <li className="cat" key={c.id} data-open={isOpen}>
              <div className="cat-row">
                <div>
                  <span className="cat-name">{c.name}</span>
                  <span className="cat-weight">{c.weight}%</span>
                  <div className="cat-tier">{t("scorecard.tier", { tier: tierText(v.score, c.tiers) })}</div>
                </div>
                <div>
                  {overrides[c.id] ? (
                    <span className="score-overridden" role="img" aria-label={t("override.label", { name: c.name, final: overrides[c.id]!.score, ai: v.score })}>
                      <ScoreChip score={overrides[c.id]!.score} label={c.name} />
                      <s aria-hidden="true" className="mono muted">{v.score}</s>
                    </span>
                  ) : (
                    <ScoreChip score={v.score} label={c.name} />
                  )}
                </div>
                <div className="cat-preview" aria-hidden="true">{v.remarks}</div>
                <button
                  type="button"
                  className="btn-text"
                  aria-expanded={isOpen}
                  aria-controls={rid}
                  aria-label={`${isOpen ? t("scorecard.hide") : t("scorecard.show")} ${t("scorecard.forCategory", { name: c.name })}`}
                  onClick={() => setOpen((o) => ({ ...o, [c.id]: !isOpen }))}
                >
                  {isOpen ? t("scorecard.hide") : t("scorecard.show")}
                </button>
              </div>
              {overrides[c.id] && (
                <p className="override-note">
                  <span className="override-tag">{t("override.tag")}</span> {t("override.note", { note: overrides[c.id]!.note })}
                </p>
              )}
              {onOverride && (
                <div className="btn-row override-actions">
                  <button type="button" className="btn-text" aria-label={t("override.buttonFor", { name: c.name })} onClick={() => setEditing(c.id)}>
                    {t("override.button")}
                  </button>
                  {overrides[c.id] && (
                    <button
                      type="button"
                      className="btn-text"
                      aria-label={t("override.removeFor", { name: c.name })}
                      onClick={async () => {
                        const err = await onOverride(c.id, { remove: true });
                        setNotice(err ? t("override.failed", { message: err }) : t("override.removed"));
                      }}
                    >
                      {t("override.remove")}
                    </button>
                  )}
                </div>
              )}
              <div className="cat-remarks" id={rid} hidden={!isOpen}><TimestampedText text={v.remarks} onSeek={onSeek} /></div>
            </li>
          );
        })}
      </ul>

      <p className="sr-only" role="status">{notice}</p>
      {editing && onOverride && (
        <OverrideDialog
          category={cats.find((c) => c.id === editing)!}
          aiScore={r.categories[editing]!.score}
          initial={overrides[editing]}
          onClose={() => setEditing(null)}
          onSubmit={async (score, note) => {
            const err = await onOverride(editing, { score, note });
            if (!err) setNotice(t("override.saved"));
            return err;
          }}
        />
      )}

      <h3 className="section-label">{t("evidence.title")}</h3>
      {r.observations && r.observations.length > 0 ? (
        <>
          <EvidenceStrip observations={r.observations} durationSeconds={r.durationSeconds} maxSeconds={r.rubric.maxDurationSeconds} onSeek={onSeek} />
          <ObservationList observations={r.observations} onSeek={onSeek} />
        </>
      ) : (
        <p className="panel-sub">{t("evidence.none")}</p>
      )}

      <h3 className="section-label">{t("scorecard.comments")}</h3>
      <p className="comments">{r.overallComments}</p>
      <div className="prov" aria-label={t("scorecard.provenance")}>
        <span><b>{t("scorecard.model")}</b> {r.provenance.model}{r.provenance.provider === "vertex" ? ` ${t("scorecard.viaVertex")}` : ""}</span>
        <span>
          <b>{t("scorecard.rubric")}</b> {r.provenance.rubricSource === "default" ? t("scorecard.defaultRubric") : t("scorecard.activeRubric")} · <span className="mono">{r.provenance.rubricVersion}</span>
        </span>
        <span><b>{t("scorecard.prompt")}</b> <span className="mono">{r.provenance.promptVersion}</span></span>
      </div>
    </article>
  );
});
