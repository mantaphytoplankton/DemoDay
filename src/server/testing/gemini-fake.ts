/**
 * Protocol-level fake of the Gemini Files API and generateContent, for automated tests only.
 * Selected with JUDGE_UPSTREAM=fixture, which env.ts refuses when NODE_ENV=production.
 * Every scorecard it produces says "Fixture output" so it can never pass for a real evaluation.
 *
 * Scenario per upload: an ASCII marker in the uploaded bytes, e.g. "DD-SCENARIO:unprocessable",
 * and an optional "DD-DURATION:204" (seconds). Unit tests can force a scenario in the constructor.
 */
export type FakeScenario =
  | "normal" | "unprocessable" | "slow" | "unavailable" | "server-error" | "busy-once" | "incomplete" | "repair" | "blocked"
  // JDG-08 transcript cases
  | "transcript-early" | "transcript-missing" | "no-speech"
  // JDG-09 summary case
  | "summary-missing";

interface FakeFile {
  name: string;
  uri: string;
  mimeType: string;
  scenario: FakeScenario;
  durationSeconds: number;
  pollsLeft: number;
  generateCalls: number;
}

interface Session {
  id: string;
  size: number;
  mimeType: string;
  received: number;
  bytes: Uint8Array[];
}

export interface FakeGeminiOptions {
  scenario?: FakeScenario;
  processingPolls?: number;
  durationSeconds?: number;
  /** Drop the connection after this many bytes on the first upload attempt (tests resume). */
  failUploadAfterBytes?: number;
  base?: string;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const apiError = (status: number, statusText: string, message: string, reason?: string) =>
  json({ error: { code: status, status: statusText, message, details: reason ? [{ reason }] : [] } }, status);

export class FakeGemini {
  readonly base: string;
  readonly files = new Map<string, FakeFile>();
  readonly sessions = new Map<string, Session>();
  readonly deleted: string[] = [];
  readonly requests: { method: string; path: string; hasKey: boolean; body?: unknown }[] = [];
  private seq = 0;
  private uploadFailuresLeft: number;

  private readonly opts: FakeGeminiOptions;

  constructor(opts: FakeGeminiOptions = {}) {
    this.opts = opts;
    this.base = opts.base ?? "https://fake-gemini.test";
    this.uploadFailuresLeft = opts.failUploadAfterBytes !== undefined ? 1 : 0;
  }

  readonly fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    const hasKey = Boolean(headers.get("x-goog-api-key"));
    this.requests.push({ method, path: url.pathname, hasKey });
    if (init.signal?.aborted) throw init.signal.reason;
    if (!hasKey) return apiError(403, "PERMISSION_DENIED", "Method doesn't allow unregistered callers", "API_KEY_INVALID");
    if (headers.get("x-goog-api-key") === "invalid") return apiError(400, "INVALID_ARGUMENT", "API key not valid.", "API_KEY_INVALID");

    if (method === "POST" && url.pathname === "/upload/v1beta/files") return this.startUpload(headers);
    const session = url.pathname.match(/^\/upload-session\/(\w+)$/);
    if (method === "POST" && session) return this.uploadChunk(session[1]!, headers, init);
    const file = url.pathname.match(/^\/v1beta\/(files\/\w+)$/);
    if (method === "GET" && file) return this.getFile(file[1]!);
    if (method === "DELETE" && file) return this.deleteFile(file[1]!);
    const gen = url.pathname.match(/^\/v1beta\/models\/([^:]+):generateContent$/);
    if (method === "POST" && gen) return this.generate(JSON.parse(String(init.body)));
    return apiError(404, "NOT_FOUND", `No fake route for ${method} ${url.pathname}`);
  };

  private startUpload(h: Headers): Response {
    const id = `s${++this.seq}`;
    this.sessions.set(id, { id, size: Number(h.get("x-goog-upload-header-content-length")), mimeType: h.get("x-goog-upload-header-content-type") ?? "", received: 0, bytes: [] });
    return new Response(null, { status: 200, headers: { "x-goog-upload-url": `${this.base}/upload-session/${id}`, "x-goog-upload-status": "active" } });
  }

  private async uploadChunk(id: string, h: Headers, init: RequestInit): Promise<Response> {
    const s = this.sessions.get(id);
    if (!s) return apiError(404, "NOT_FOUND", "Upload session not found");
    const command = h.get("x-goog-upload-command") ?? "";
    if (command === "query") {
      return new Response(null, { status: 200, headers: { "x-goog-upload-size-received": String(s.received), "x-goog-upload-status": "active" } });
    }
    const offset = Number(h.get("x-goog-upload-offset") ?? "0");
    if (offset !== s.received) return apiError(400, "INVALID_ARGUMENT", "Offset mismatch");
    const reader = (init.body as ReadableStream<Uint8Array>).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (this.uploadFailuresLeft > 0 && s.received + value.length > (this.opts.failUploadAfterBytes ?? 0)) {
        const keep = Math.max(0, (this.opts.failUploadAfterBytes ?? 0) - s.received);
        s.bytes.push(value.slice(0, keep));
        s.received += keep;
        this.uploadFailuresLeft--;
        await reader.cancel();
        throw new TypeError("fetch failed");
      }
      s.bytes.push(value);
      s.received += value.length;
    }
    if (!command.includes("finalize")) return new Response(null, { status: 200 });
    if (s.received !== s.size) return apiError(400, "INVALID_ARGUMENT", `Size mismatch ${s.received}/${s.size}`);

    const text = Buffer.concat(s.bytes).toString("latin1");
    const scenario = (this.opts.scenario ?? (text.match(/DD-SCENARIO:([a-z-]+)/)?.[1] as FakeScenario | undefined)) ?? "normal";
    const duration = this.opts.durationSeconds ?? Number(text.match(/DD-DURATION:(\d+(?:\.\d+)?)/)?.[1] ?? 120.4);
    const name = `files/f${++this.seq}`;
    const polls = this.opts.processingPolls ?? (scenario === "slow" ? 7 : 2);
    this.files.set(name, { name, uri: `${this.base}/v1beta/${name}`, mimeType: s.mimeType, scenario, durationSeconds: duration, pollsLeft: polls, generateCalls: 0 });
    return json({ file: { name, uri: `${this.base}/v1beta/${name}`, mimeType: s.mimeType, sizeBytes: String(s.size), state: "PROCESSING" } });
  }

  private getFile(name: string): Response {
    const f = this.files.get(name);
    if (!f) return apiError(404, "NOT_FOUND", "File not found");
    const base = { name: f.name, uri: f.uri, mimeType: f.mimeType };
    if (f.pollsLeft > 0) {
      f.pollsLeft--;
      return json({ ...base, state: "PROCESSING" });
    }
    if (f.scenario === "unprocessable") return json({ ...base, state: "FAILED", error: { message: "Video could not be decoded" } });
    return json({ ...base, state: "ACTIVE", videoMetadata: { videoDuration: `${f.durationSeconds}s` } });
  }

  private deleteFile(name: string): Response {
    if (!this.files.has(name)) return apiError(404, "NOT_FOUND", "File not found");
    this.files.delete(name);
    this.deleted.push(name);
    return json({});
  }

  private generate(body: {
    contents: { parts: { fileData?: { fileUri: string } }[] }[];
    generationConfig: { responseJsonSchema?: { properties?: { categories?: { required?: string[] } } }; responseSchema?: unknown };
  }): Response {
    const uri = body.contents[0]?.parts.find((p) => p.fileData)?.fileData?.fileUri ?? "";
    const f = [...this.files.values()].find((x) => x.uri === uri);
    if (!f) return apiError(400, "INVALID_ARGUMENT", "File is not ACTIVE or does not exist");
    f.generateCalls++;
    const usage = { promptTokenCount: 52000, candidatesTokenCount: 900, thoughtsTokenCount: 1200, totalTokenCount: 54100 };
    const reply = (text: string, finishReason = "STOP") =>
      json({ candidates: [{ content: { role: "model", parts: [{ text: "thinking…", thought: true }, { text }] }, finishReason }], usageMetadata: usage, modelVersion: "fake-gemini-001" });

    if (f.scenario === "unavailable") return apiError(503, "UNAVAILABLE", "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.");
    if (f.scenario === "server-error") return apiError(500, "INTERNAL", "An internal error has occurred.");
    if (f.scenario === "busy-once" && f.generateCalls === 1) return apiError(429, "RESOURCE_EXHAUSTED", "Resource has been exhausted");
    if (f.scenario === "blocked") return json({ promptFeedback: { blockReason: "SAFETY" }, usageMetadata: usage });
    if (f.scenario === "incomplete" || (f.scenario === "repair" && f.generateCalls === 1)) return reply('{"categories": {}, "overallComments": "cut');

    const ids = body.generationConfig.responseJsonSchema?.properties?.categories?.required ?? ["working_solution", "meaningful_ai", "ux_value"];
    const scores = [4, 3, 5, 3, 4, 2, 5, 3];
    const mmss = (sec: number) => `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
    const d = f.durationSeconds;
    // Speech in five even segments with a stretch without speech in the middle; "transcript-early" stops halfway.
    const end = f.scenario === "transcript-early" ? d * 0.5 : d;
    const cuts = [0, 0.2, 0.4, 0.5, 0.7, 1].map((x) => x * end);
    const transcript =
      f.scenario === "no-speech"
        ? [{ from: "00:00", to: mmss(d), speech: false, text: "" }]
        : cuts.slice(0, -1).map((from, i) =>
            i === 2
              ? { from: mmss(from), to: mmss(cuts[i + 1]!), speech: false, text: "" }
              : { from: mmss(from), to: mmss(cuts[i + 1]!), speech: true, text: `Fixture output: spoken words, part ${i + 1}.` },
          );
    const out = {
      ...(f.scenario === "transcript-missing" ? {} : { transcript }),
      ...(f.scenario === "summary-missing"
        ? {}
        : {
            summary:
              "Fixture output for automated tests, not a description of the uploaded video. The team names a problem and the people who have it. " +
              "The demo then puts an input into the product and shows the result on screen. At the end the team claims a benefit for its users without showing it.",
          }),
      observations: [
        { at: mmss(d * 0.08), segment: "context", kind: "demonstrated", note: "Fixture output: the team names the user and the problem." },
        { at: mmss(d * 0.5), segment: "demo", kind: "demonstrated", note: "Fixture output: input goes in and a result is shown." },
        { at: mmss(d * 0.9), segment: "value", kind: "claimed", note: "Fixture output: a benefit is claimed but not shown." },
      ],
      categories: Object.fromEntries(
        ids.map((id, i) => [id, { remarks: `Fixture output for automated tests. Category ${id} remarks cite 00:3${i} as demonstrated evidence.`, score: scores[i % scores.length] }]),
      ),
      overallComments: "Fixture output for automated tests. This is not an AI evaluation of the uploaded video.",
      flags: { noWorkingDemo: false, audio: f.scenario === "no-speech" ? "missing" : "ok", narratedNotShown: false, impactClaimedWithoutHow: true },
    };
    return reply(JSON.stringify(out));
  }
}
