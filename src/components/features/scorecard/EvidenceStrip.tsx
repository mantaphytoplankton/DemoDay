"use client";

import { useRef } from "react";
import { t, type MessageKey } from "@/i18n/t";
import { formatDuration } from "@/shared/format";

export interface EvidenceObservation {
  at: string;
  segment: "context" | "demo" | "value";
  kind: "demonstrated" | "claimed";
  note: string;
}

const toSeconds = (at: string) => {
  const [m, s] = at.split(":").map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
};

/** Expected pitch flow from the BRD: ~20 s context, ~2 min demo, ~40 s value. */
const SEGMENTS = [
  { id: "context", start: 0, end: 20 },
  { id: "demo", start: 20, end: 140 },
  { id: "value", start: 140, end: 180 },
] as const;

/**
 * Signature element (ui-guideline.md 6.5): the pitch timeline with evidence markers.
 * Filled = demonstrated, hollow ring = claimed (shape carries the meaning, not colour).
 */
export function EvidenceStrip({ observations, durationSeconds, maxSeconds, onSeek }: {
  observations: EvidenceObservation[];
  durationSeconds: number;
  maxSeconds: number;
  onSeek?: (seconds: number) => void;
}) {
  const span = Math.max(maxSeconds, durationSeconds, 1);
  const pct = (sec: number) => `${Math.min(100, (sec / span) * 100)}%`;
  const markers = useRef<(HTMLButtonElement | null)[]>([]);
  const label = (o: EvidenceObservation) =>
    t("evidence.marker", { at: o.at, kind: t(`evidence.kind.${o.kind}` as MessageKey), segment: t(`evidence.segment.${o.segment}` as MessageKey), note: o.note });

  const onKey = (i: number) => (e: React.KeyboardEvent) => {
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    markers.current[Math.max(0, Math.min(observations.length - 1, next))]?.focus();
  };

  return (
    <div className="evidence">
      <div className="evidence-track" role="group" aria-label={t("evidence.stripLabel", { count: observations.length })}>
        {SEGMENTS.map((s) => (
          <div key={s.id} className="evidence-seg" style={{ left: pct(s.start), width: `calc(${pct(Math.min(s.end, span))} - ${pct(s.start)})` }}>
            <span className="evidence-seg-label">{t(`evidence.segment.${s.id}` as MessageKey)}</span>
          </div>
        ))}
        {durationSeconds > maxSeconds && (
          <div className="evidence-over" style={{ left: pct(maxSeconds), width: `calc(100% - ${pct(maxSeconds)})` }} title={t("evidence.over")} />
        )}
        <div className="evidence-limit" style={{ left: pct(maxSeconds) }} aria-hidden="true" />
        {observations.map((o, i) => (
          <button
            key={`${o.at}-${i}`}
            ref={(el) => {
              markers.current[i] = el;
            }}
            type="button"
            className={`evidence-marker evidence-${o.kind}`}
            style={{ left: pct(toSeconds(o.at)) }}
            aria-label={label(o)}
            title={label(o)}
            onKeyDown={onKey(i)}
            onClick={() => onSeek?.(toSeconds(o.at))}
            tabIndex={i === 0 ? 0 : -1}
          />
        ))}
      </div>
      <div className="evidence-axis" aria-hidden="true">
        <span>{formatDuration(0)}</span>
        <span>{formatDuration(span)}</span>
      </div>
      <p className="evidence-legend">
        <span className="legend-dot evidence-demonstrated" aria-hidden="true" /> {t("evidence.legendDemonstrated")}
        <span className="legend-dot evidence-claimed" aria-hidden="true" /> {t("evidence.legendClaimed")}
      </p>
      <ul className="evidence-summary">
        {SEGMENTS.map((s) => {
          const inSeg = observations.filter((o) => o.segment === s.id);
          return (
            <li key={s.id}>
              {t("evidence.summary", {
                segment: t(`evidence.segment.${s.id}` as MessageKey),
                demonstrated: inSeg.filter((o) => o.kind === "demonstrated").length,
                claimed: inSeg.filter((o) => o.kind === "claimed").length,
              })}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Observation list with timestamps that jump the video (when a seekable player is present). */
export function ObservationList({ observations, onSeek }: { observations: EvidenceObservation[]; onSeek?: (seconds: number) => void }) {
  return (
    <ol className="observations">
      {observations.map((o, i) => (
        <li key={`${o.at}-${i}`} className={`obs obs-${o.kind}`}>
          {onSeek ? (
            <button type="button" className="btn-text mono" aria-label={t("evidence.jump", { at: o.at })} onClick={() => onSeek(toSeconds(o.at))}>{o.at}</button>
          ) : (
            <span className="mono">{o.at}</span>
          )}
          <span className={`obs-kind obs-kind-${o.kind}`}>{t(`evidence.kind.${o.kind}` as MessageKey)}</span>
          <span className="obs-seg">{t(`evidence.segment.${o.segment}` as MessageKey)}</span>
          <span className="obs-note">{o.note}</span>
        </li>
      ))}
    </ol>
  );
}

/** Remarks text with mm:ss timestamps turned into "play from" buttons. */
export function TimestampedText({ text, onSeek }: { text: string; onSeek?: (seconds: number) => void }) {
  if (!onSeek) return <>{text}</>;
  const parts = text.split(/\b(\d{1,2}:[0-5]\d)\b/);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <button key={i} type="button" className="btn-text mono ts-link" aria-label={t("evidence.jump", { at: p })} onClick={() => onSeek(toSeconds(p))}>{p}</button>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </>
  );
}
