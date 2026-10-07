"use client";

import { forwardRef, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { t } from "@/i18n/t";
import type { PublicEvaluation } from "@/shared/schemas/evaluation";
import { Scorecard } from "./Scorecard";

/**
 * SNG-04: the uploaded video beside its scorecard (stacked on narrow screens); timestamps seek the video.
 * TBL-03: overrides are saved through the API and the cached evaluation is replaced with the server's copy.
 */
export const ReviewLayout = forwardRef<HTMLHeadingElement, { evaluation: PublicEvaluation }>(function ReviewLayout({ evaluation: ev }, headingRef) {
  const qc = useQueryClient();
  const video = useRef<HTMLVideoElement>(null);
  const seek = useCallback((seconds: number) => {
    const v = video.current;
    if (!v) return;
    v.currentTime = seconds;
    void v.play().catch(() => {});
    v.focus();
  }, []);
  const override = useCallback(
    async (categoryId: string, change: { score: number; note: string } | { remove: true }) => {
      const res = await fetch(`/api/evaluations/${ev.id}/override`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ categoryId, ...change }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) return (body?.error?.message as string) ?? String(res.status);
      qc.setQueryData(["evaluation", ev.id], body);
      return null;
    },
    [qc, ev.id],
  );
  return (
    <div className="review-layout">
      <div className="review-video">
        <video ref={video} controls preload="metadata" src={`/api/evaluations/${ev.id}/video`} aria-label={t("video.label")} data-testid="review-video" />
      </div>
      <Scorecard
        ref={headingRef}
        title={ev.source.fileName}
        sizeBytes={ev.source.sizeBytes}
        result={ev.result!}
        onSeek={seek}
        overrides={ev.overrides}
        final={ev.final}
        onOverride={override}
      />
    </div>
  );
});
