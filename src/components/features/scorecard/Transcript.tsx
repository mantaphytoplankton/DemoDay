"use client";

import { t } from "@/i18n/t";
import { formatTimestamp, parseTimestamp } from "@/shared/format";
import { transcriptCoverage, type TranscriptSegment } from "@/shared/transcript";

/**
 * JDG-08: the timestamped transcript, with its coverage of the video as evidence that the whole video was
 * processed. Text is rendered as plain text only. Timestamps jump the video when a seekable player is present.
 */
export function Transcript({ transcript, outputVersion, durationSeconds, onSeek }: {
  transcript: TranscriptSegment[] | null | undefined;
  outputVersion: number;
  durationSeconds: number;
  onSeek?: (seconds: number) => void;
}) {
  if (transcript === undefined || outputVersion < 3) return <p className="panel-sub">{t("transcript.none")}</p>;
  if (transcript === null) return <p className="panel-sub">{t("transcript.unavailable")}</p>;
  const c = transcriptCoverage(transcript, durationSeconds);
  if (!c.hasSpeech) return <p className="panel-sub">{t("transcript.noSpeech")}</p>;

  const start = formatTimestamp(c.startSeconds);
  const end = formatTimestamp(c.endSeconds);
  const duration = formatTimestamp(durationSeconds);
  return (
    <div className="transcript">
      <p className="transcript-coverage">
        {durationSeconds > 0 ? t("transcript.coverage", { start, end, duration }) : t("transcript.coverageNoLength", { start, end })}
      </p>
      {c.endsEarly && (
        <p className="transcript-warning" role="note">
          {t("transcript.earlyEnd", { end, duration })}
        </p>
      )}
      <ol className="transcript-list" tabIndex={0} aria-label={t("transcript.listLabel", { count: transcript.length })}>
        {transcript.map((s, i) => (
          <li key={`${s.from}-${i}`} className={s.speech ? "transcript-seg" : "transcript-seg transcript-silent"}>
            {onSeek ? (
              <button type="button" className="btn-text mono" aria-label={t("evidence.jump", { at: s.from })} onClick={() => onSeek(parseTimestamp(s.from))}>
                {s.from}
              </button>
            ) : (
              <span className="mono">{s.from}</span>
            )}
            <span className="transcript-text">{s.speech ? s.text : t("transcript.noSpeechSegment")}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}
