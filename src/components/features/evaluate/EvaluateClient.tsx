"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { t, type MessageKey } from "@/i18n/t";
import { formatBytes, formatDuration } from "@/shared/format";
import { errorHelp, errorMessage } from "@/shared/errors";
import { SINGLE_STEPS, type TeamStatus } from "@/shared/status";
import { useEvaluation } from "@/hooks/useEvaluation";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { StateIcon } from "@/components/ui/StateIcon";
import { ReviewLayout } from "@/components/features/scorecard/ReviewLayout";
import { StepTracker, type StepState } from "./StepTracker";
import { checkFile, probeDuration, uploadVideo } from "./client-checks";

const SOFT_TIP_MS = 10_000;

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; file: File; duration: number | null; sent: number }
  | { kind: "tracking"; file: { name: string; size: number }; duration: number | null; id: string };

export function EvaluateClient({ maxBytes, maxLabel, onDuration }: { maxBytes: number; maxLabel: string; onDuration: (d: number | null) => void }) {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const scorecardRef = useRef<HTMLHeadingElement>(null);
  const failRef = useRef<HTMLParagraphElement>(null);

  const [epoch, setEpoch] = useState(0);
  const ev = useEvaluation(phase.kind === "tracking" ? phase.id : null, undefined, epoch);
  const retry = async () => {
    if (phase.kind !== "tracking") return;
    const res = await fetch(`/api/evaluations/${phase.id}/retry`, { method: "POST" });
    if (res.status !== 202) return;
    qc.setQueryData(["evaluation", phase.id], (cur: typeof ev) => (cur ? { ...cur, status: "Pending" as const, error: undefined } : cur));
    setEpoch((e) => e + 1);
  };
  const status: TeamStatus | "Sending" | null = phase.kind === "sending" ? "Sending" : phase.kind === "tracking" ? (ev?.status ?? "Pending") : null;

  // Soft tip: time since the step last changed (notes such as upload progress do not count).
  const stepKey = phase.kind === "idle" ? "" : status === "Sending" || status === "Pending" ? "Uploading" : String(status);
  const [stepSince, setStepSince] = useState(() => Date.now());
  const [prevStepKey, setPrevStepKey] = useState(stepKey);
  if (prevStepKey !== stepKey) {
    setPrevStepKey(stepKey);
    setStepSince(now);
  }
  const running = phase.kind !== "idle" && status !== "Completed" && status !== "Failed";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  // Final states: show the measured length on the clock and move focus to the outcome.
  useEffect(() => {
    if (ev?.status === "Completed") {
      if (ev.result) onDuration(ev.result.durationSeconds);
      scorecardRef.current?.focus();
    } else if (ev?.status === "Failed") {
      failRef.current?.focus();
    }
  }, [ev?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  const announce =
    phase.kind === "sending"
      ? t("evaluate.announceStart", { name: phase.file.name })
      : ev?.status === "Completed" && ev.result
        ? t("evaluate.announceDone", { score: ev.result.overallScore.toFixed(2) })
        : ev?.status === "Failed"
          ? (ev.error?.message ?? "")
          : "";

  const start = useCallback(
    async (file: File | undefined) => {
      setError(null);
      if (!file) return;
      const check = await checkFile(file, maxBytes);
      if (!check.ok) {
        setError(errorMessage(check.code, { maxMb: maxLabel }));
        return;
      }
      const duration = await probeDuration(file);
      onDuration(duration);
      setPhase({ kind: "sending", file, duration, sent: 0 });
      const out = await uploadVideo(file, check.mime, (sent) => setPhase((p) => (p.kind === "sending" ? { ...p, sent } : p)), t("evaluate.uploadNetwork"));
      if (!out.ok) {
        setPhase({ kind: "idle" });
        onDuration(null);
        setError(out.message);
        return;
      }
      setPhase({ kind: "tracking", file: { name: file.name, size: file.size }, duration, id: out.id });
      void qc.invalidateQueries({ queryKey: ["evaluations"] });
    },
    [maxBytes, maxLabel, onDuration, qc],
  );

  const reset = () => {
    setPhase({ kind: "idle" });
    setError(null);
    onDuration(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  // ----- step tracker model -----
  const states: StepState[] = ["todo", "todo", "todo", "todo"];
  const meta: (string | undefined)[] = [];
  const elapsed = Math.floor((now - stepSince) / 1000);
  let failedStep: TeamStatus | null = null;
  if (phase.kind === "sending") {
    states[0] = "active";
    const pct = Math.round((phase.sent / phase.file.size) * 100);
    meta[0] = `${t("evaluate.uploadNote", { percent: pct, sent: formatBytes(phase.sent), total: formatBytes(phase.file.size) })} · ${elapsed}s`;
  } else if (phase.kind === "tracking") {
    const s = ev?.status ?? "Pending";
    const idx = s === "Pending" ? 0 : s === "Failed" ? SINGLE_STEPS.indexOf((ev?.error?.step ?? "Uploading") as (typeof SINGLE_STEPS)[number]) : SINGLE_STEPS.indexOf(s as (typeof SINGLE_STEPS)[number]);
    for (let i = 0; i < 4; i++) states[i] = i < idx ? "done" : "todo";
    if (s === "Completed") states.fill("done");
    else if (s === "Failed") {
      failedStep = ev?.error?.step ?? "Uploading";
      states[Math.max(0, idx)] = "failed";
      meta[Math.max(0, idx)] = t("evaluate.stepStopped");
    } else {
      states[idx] = "active";
      const note = ev?.step?.note;
      meta[idx] = `${note ? `${note} · ` : ""}${elapsed}s`;
    }
    if (idx > 0 || s === "Completed") meta[0] = t("evaluate.uploadSent", { size: formatBytes(phase.file.size) });
    if (idx > 1 || s === "Completed") meta[1] = t("evaluate.stepReady");
    if (s === "Completed") meta[2] = t("evaluate.stepDone");
  }
  const activeIdx = states.indexOf("active");
  const showTip = running && activeIdx >= 0 && now - stepSince >= SOFT_TIP_MS;
  const fileInfo = phase.kind === "idle" ? null : phase.kind === "sending" ? { name: phase.file.name, size: phase.file.size } : phase.file;
  const duration = phase.kind === "idle" ? null : phase.duration;

  return (
    <div>
      <div className="sr-only" aria-live="polite">{announce}</div>

      {phase.kind === "idle" && (
        <section className="panel" aria-labelledby="up-title">
          <h2 className="sr-only" id="up-title">{t("evaluate.uploadLabel")}</h2>
          <label
            className={`dropzone${over ? " is-over" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); void start(e.dataTransfer.files[0]); }}
          >
            <input
              ref={inputRef}
              type="file"
              data-testid="video-input"
              accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
              aria-describedby="dz-hint file-error"
              aria-invalid={error ? true : undefined}
              onChange={(e) => { void start(e.target.files?.[0]); e.target.value = ""; }}
            />
            <span className="dropzone-title">{t("evaluate.dropzone.title")}<u>{t("evaluate.dropzone.choose")}</u></span>
            <span className="dropzone-hint" id="dz-hint" style={{ display: "block" }}>{t("evaluate.dropzone.hint", { maxMb: maxLabel })}</span>
          </label>
          <div id="file-error" className="field-error" role="alert" hidden={!error}>
            {error && (<><StateIcon kind="failed" /><span>{error}</span></>)}
          </div>
        </section>
      )}

      {fileInfo && (
        <section className="panel" aria-labelledby="run-title">
          <div className="file-row">
            <h2 className="file-name" id="run-title">{fileInfo.name}</h2>
            <span className="secondary mono" style={{ fontSize: 13 }}>
              {duration != null ? formatDuration(duration) : t("scorecard.lengthUnknown")} · {formatBytes(fileInfo.size)}
            </span>
          </div>
          <div style={{ marginTop: 6 }}>
            <StatusBadge status={status === "Sending" || status === "Pending" || !status ? "Uploading" : status} />
          </div>
          <StepTracker states={states} meta={meta} />
          {phase.kind === "sending" && (
            <div className="progress" role="progressbar" aria-label={t("evaluate.uploadProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round((phase.sent / phase.file.size) * 100)}>
              <span style={{ width: `${(phase.sent / phase.file.size) * 100}%` }} />
            </div>
          )}
          {showTip && (
            <p className="soft-tip" data-testid="soft-tip">
              {t("evaluate.softTip", { step: t(`status.${SINGLE_STEPS[activeIdx]!}` as MessageKey).toLowerCase() })}
            </p>
          )}
        </section>
      )}

      {phase.kind === "tracking" && ev?.status === "Completed" && ev.result && (
        <div style={{ marginTop: 12 }}>
          <div className="btn-row" style={{ marginBottom: 12 }}>
            <button type="button" className="btn btn-primary" onClick={reset}>{t("evaluate.again")}</button>
            <Link className="btn" href={`/results/${ev.id}`}>{t("evaluate.openResult")}</Link>
          </div>
          <ReviewLayout evaluation={ev} ref={scorecardRef} />
        </div>
      )}

      {phase.kind === "tracking" && ev?.status === "Failed" && ev.error && (
        <div className="banner banner-failed" role="alert" style={{ marginTop: 12 }} data-step={failedStep ?? undefined}>
          <span className="state state-failed"><StateIcon kind="failed" /></span>
          <div>
            <p className="banner-title" ref={failRef} tabIndex={-1}>{ev.error.message}</p>
            <p className="banner-body">{errorHelp(ev.error.code)}</p>
            <div className="btn-row">
              <button type="button" className="btn btn-primary" onClick={retry}>{t("evaluate.retry")}</button>
              <button type="button" className="btn" onClick={reset}>{t("evaluate.again")}</button>
              {ev.error.code === "RUBRIC_INVALID" && <Link className="btn" href="/rubric">{t("evaluate.viewRubric")}</Link>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
