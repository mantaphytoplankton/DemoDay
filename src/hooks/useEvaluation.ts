"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PublicEvaluation } from "@/shared/schemas/evaluation";

const isFinal = (e?: PublicEvaluation | null) => e?.status === "Completed" || e?.status === "Failed";

async function fetchEvaluation(id: string): Promise<PublicEvaluation> {
  const res = await fetch(`/api/evaluations/${id}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Live evaluation state: server-sent events into the React Query cache, polling every 3s if they drop. */
export function useEvaluation(id: string | null, initial?: PublicEvaluation, epoch = 0) {
  const qc = useQueryClient();
  const [polling, setPolling] = useState(false);
  const query = useQuery({
    queryKey: ["evaluation", id],
    queryFn: () => fetchEvaluation(id!),
    // Server events deliver a snapshot on connect, so fetch only after falling back to polling.
    // (A parallel fetch could resolve after a newer event and overwrite it.)
    enabled: Boolean(id) && polling,
    initialData: initial,
    refetchInterval: (q) => (polling && !isFinal(q.state.data) ? 3000 : false),
  });

  useEffect(() => {
    if (!id || isFinal(qc.getQueryData<PublicEvaluation>(["evaluation", id]))) return;
    const es = new EventSource(`/api/evaluations/${id}/events`);
    const onData = (ev: MessageEvent<string>) => {
      const data = JSON.parse(ev.data) as PublicEvaluation;
      qc.setQueryData(["evaluation", id], data);
      if (isFinal(data)) {
        es.close();
        void qc.invalidateQueries({ queryKey: ["evaluations"] });
      }
    };
    es.addEventListener("snapshot", onData);
    es.addEventListener("update", onData);
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED || !isFinal(qc.getQueryData(["evaluation", id]))) {
        es.close();
        setPolling(true);
      }
    };
    return () => es.close();
  }, [id, qc, epoch]);

  return query.data ?? null;
}
