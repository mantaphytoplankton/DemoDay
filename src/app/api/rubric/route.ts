import { getApp } from "@/server/app-context.ts";
import { inspectRubric, defaultRubricLocation } from "@/server/rubric/load.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** JDG-01: the active rubric as the agent will read it at the next evaluation. */
export async function GET(): Promise<Response> {
  const app = getApp();
  const r = await inspectRubric(defaultRubricLocation(app.env.dataDir));
  return Response.json({ source: r.source, version: r.version, hash: r.hash, meta: r.meta, text: r.text, error: r.error });
}
