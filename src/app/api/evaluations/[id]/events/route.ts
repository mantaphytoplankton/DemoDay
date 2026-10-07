import { getApp } from "@/server/app-context.ts";
import { apiError } from "@/server/http/respond.ts";
import { isEvaluationId } from "@/server/store/paths.ts";
import { toPublic } from "@/shared/schemas/evaluation.ts";
import type { EvaluationEvent } from "@/server/jobs/events.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEEPALIVE_MS = 15_000;

/** SNG-02: server-sent events. First a snapshot, then every persisted update, until a final state. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isEvaluationId(id)) return apiError("NOT_FOUND");
  const app = getApp();
  await app.ready;
  const rec = await app.evaluations.get(id).catch(() => null);
  if (!rec) return apiError("NOT_FOUND");

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (e: EvaluationEvent) => {
        if (closed) return;
        controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e.evaluation)}\n\n`));
        if (e.evaluation.status === "Completed" || e.evaluation.status === "Failed") close();
      };
      const off = app.bus.onEvaluation(id, send);
      const timer = setInterval(() => !closed && controller.enqueue(enc.encode(": keep-alive\n\n")), KEEPALIVE_MS);
      const close = () => {
        if (closed) return;
        closed = true;
        off();
        clearInterval(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      cleanup = close;
      req.signal.addEventListener("abort", close, { once: true });
      // Re-read after subscribing so no update between the first read and subscription is lost.
      void app.evaluations.get(id).then((latest) => latest && send({ type: "snapshot", evaluation: toPublic(latest) }));
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" },
  });
}
