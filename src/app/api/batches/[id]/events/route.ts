import { getApp } from "@/server/app-context.ts";
import { apiError } from "@/server/http/respond.ts";
import { isBatchId } from "@/server/store/batches.ts";
import { toPublicBatch } from "@/shared/schemas/batch.ts";
import type { BatchEvent } from "@/server/jobs/events.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TBL-01: snapshot on connect, then one event per persisted row change. Closes when the batch stops running. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const { id } = await ctx.params;
  if (!isBatchId(id)) return apiError("NOT_FOUND");
  const app = getApp();
  await app.ready;
  if (!(await app.batches.get(id).catch(() => null))) return apiError("NOT_FOUND");

  const enc = new TextEncoder();
  let cleanup = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
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
      const send = (e: BatchEvent) => {
        if (closed) return;
        controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`));
        const status = e.type === "snapshot" ? e.batch.status : e.type === "status" ? e.status : "Running";
        if (status !== "Running") close();
      };
      const off = app.bus.onBatch(id, send);
      const timer = setInterval(() => !closed && controller.enqueue(enc.encode(": keep-alive\n\n")), 15_000);
      cleanup = close;
      req.signal.addEventListener("abort", close, { once: true });
      void app.batches.get(id).then((b) => b && send({ type: "snapshot", batch: toPublicBatch(b) }));
    },
    cancel() {
      cleanup();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } });
}
