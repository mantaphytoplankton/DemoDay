"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicBatch, PublicTeamRow, BatchStatus } from "@/shared/schemas/batch";

type BatchEvent =
  | { type: "snapshot"; batch: PublicBatch }
  | { type: "row"; batchId: string; row: PublicTeamRow }
  | { type: "status"; batchId: string; status: BatchStatus };

/** Live batch state (TBL-01): server events patch rows in the React Query cache; polling every 3s if they drop. */
export function useBatch(id: string, initial: PublicBatch, epoch = 0) {
  const qc = useQueryClient();
  const key = ["batch", id];
  const [polling, setPolling] = useState(false);
  const query = useQuery({
    queryKey: key,
    queryFn: async () => (await (await fetch(`/api/batches/${id}`, { cache: "no-store" })).json()) as PublicBatch,
    initialData: initial,
    enabled: polling,
    refetchInterval: (q) => (polling && q.state.data?.status === "Running" ? 3000 : false),
  });

  useEffect(() => {
    if (qc.getQueryData<PublicBatch>(["batch", id])?.status !== "Running") return;
    const es = new EventSource(`/api/batches/${id}/events`);
    const apply = (ev: MessageEvent<string>) => {
      const e = JSON.parse(ev.data) as BatchEvent;
      qc.setQueryData<PublicBatch>(["batch", id], (cur) => {
        if (e.type === "snapshot") return e.batch;
        if (!cur) return cur;
        if (e.type === "status") return { ...cur, status: e.status };
        return { ...cur, teams: cur.teams.map((t) => (t.subfolderId === e.row.subfolderId ? e.row : t)) };
      });
      const status = e.type === "snapshot" ? e.batch.status : e.type === "status" ? e.status : "Running";
      if (status !== "Running") es.close();
    };
    for (const type of ["snapshot", "row", "status"]) es.addEventListener(type, apply);
    es.onerror = () => {
      if (qc.getQueryData<PublicBatch>(["batch", id])?.status === "Running") {
        es.close();
        setPolling(true);
      }
    };
    return () => es.close();
  }, [id, qc, epoch]);

  return query.data ?? initial;
}
