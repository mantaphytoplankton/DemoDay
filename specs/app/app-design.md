# DemoDay Web App --- Technical Design

Status: Draft v1 · 2026-10-05
Scope: the Next.js application, covering the UI, the backend-for-frontend (BFF), the job runner, the Google Drive client, the `data/` store and CSV export. The judging agent is specified separately in [../agent/agent-design.md](../agent/agent-design.md).

Inputs:

| Document | Governs |
| --- | --- |
| [brd.md](../brd.md) | Product behavior |
| [stories.md](../stories.md) | Acceptance criteria, user-facing copy, sprint assignments |
| [tech-spec.md](../tech-spec.md) | Versions, API hosts, environment, pitfalls (wins on conflict) |
| [architecture-design.md](../architecture-design.md) | Component boundaries, ADR candidates |
| [ui-guideline.md](../ui-guideline.md) | Tokens, components, keyboard and accessibility contract |
| [prototype/](../prototype/) | S-1 reference interaction |

---

## 1. Runtime model

| Concern | Decision |
| --- | --- |
| Framework | Next.js 16.2.11, App Router, React 19.2.4, TypeScript 5.9.3 (strict) |
| Process | One long-lived Node.js process (`next start`, or `next dev` locally). No serverless (ADR-01) |
| Route Handlers | `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"` on every `/api/*` route |
| Long work | Runs in the in-process **Job Runner**, never inside a request. Requests start jobs and read state |
| Singletons | Runner, event bus and store mutexes are stored on `globalThis.__demoday`, so dev hot reload never creates a second runner |
| Startup | `src/instrumentation.ts` `register()` runs recovery (section 7.6) when `process.env.NEXT_RUNTIME === "nodejs"` |
| Page gate | `src/proxy.ts` (Next 16 replacement for `middleware.ts`) redirects unauthenticated page requests to `/login`. API routes still check the session themselves |
| Server-only code | Every module under `src/server/**` starts with `import "server-only"` |

## 2. Source layout

```
config/
  rubric.default.md                 # default rubric (agent-design.md section 4)
prompts/
  judge-system.md                   # agent system prompt
src/
  proxy.ts
  instrumentation.ts
  app/
    layout.tsx                      # shell: top bar, decision-support notice, fonts, QueryClientProvider
    globals.css                     # Tailwind 4 @theme tokens (ui-guideline.md section 3.5)
    (auth)/login/page.tsx
    (judge)/evaluate/page.tsx                        # S-1
    (judge)/results/[evaluationId]/page.tsx          # S-1
    (judge)/rubric/page.tsx                          # S-1
    (judge)/batches/page.tsx                         # S-2
    (judge)/batches/[batchId]/page.tsx               # S-2
    api/
      auth/login/route.ts · auth/logout/route.ts
      evaluations/route.ts                           # POST upload
      evaluations/[id]/route.ts                      # GET snapshot, DELETE
      evaluations/[id]/events/route.ts               # SSE
      evaluations/[id]/video/route.ts                # Range playback (S-4)
      evaluations/[id]/retry/route.ts                # S-3
      evaluations/[id]/override/route.ts             # S-4
      batches/route.ts                               # POST create, GET list
      batches/[id]/route.ts                          # GET snapshot
      batches/[id]/events/route.ts                   # SSE
      batches/[id]/{pause,resume,rescan}/route.ts
      batches/[id]/teams/[teamId]/retry/route.ts
      batches/[id]/teams/[teamId]/override/route.ts  # S-4
      batches/[id]/export.csv/route.ts               # S-3
      rubric/route.ts
  components/
    ui/                             # Button, StatusBadge, ScoreChip, FlagChip, Banner, Toast, Dialog
    features/
      evaluate/                     # UploadDropzone, StepTracker, PitchClock
      scorecard/                    # Scorecard, CategoryRow, OverallScore, EvidenceStrip (S-4)
      batch/                        # BatchHeader, BatchProgressBar, TeamTable, ReviewPanel
      brand/                        # LogoMark, PageBanner, PhotoCredit
  hooks/
    useJobEvents.ts                 # SSE + polling fallback → React Query cache
    useShortcuts.ts
  i18n/
    messages/en.json
    t.ts                            # t(key, vars) for client and server
  shared/
    schemas/                        # Zod schemas shared by client and server
    status.ts                       # status enums and transition table
    errors.ts                       # error code catalog (section 5.3)
  server/
    env.ts
    auth/                           # session.ts, password.ts, require-session.ts
    store/                          # fs-store.ts, mutex.ts, paths.ts, repositories
    rubric/                         # loader (owned by agent, imported here)
    agent/                          # judgeVideo (agent-design.md)
    drive/                          # url.ts, client.ts, select-video.ts, errors.ts
    jobs/                           # runner.ts, queue.ts, events.ts, single-job.ts, batch-job.ts, recovery.ts
    upload/                         # stream-to-disk.ts, sniff.ts
    csv/                            # escape.ts, scores-csv.ts
    log.ts
scripts/
  user-add.ts                       # create a judge account
  judge-cli.ts                      # run the agent on a local file (agent-design.md section 14)
tests/
  unit/ · integration/ · e2e/ · fixtures/
```

## 3. Configuration

`src/server/env.ts` parses `process.env` once with Zod at import time. A missing required value fails startup with a message naming the variable, never its value.

| Variable | Required | Default | Used by |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | yes | --- | Agent |
| `GEMINI_MODEL` | no | `gemini-3.8-flash` | Agent |
| `AI_PROVIDER` | no | `gemini` | Agent: `gemini` (AI Studio) or `vertex` (Vertex AI) |
| `VERTEX_SERVICE_ACCOUNT_FILE` | when `AI_PROVIDER=vertex` | --- | Agent (validated at startup: file readable, service-account key) |
| `VERTEX_PROJECT`, `VERTEX_LOCATION`, `VERTEX_INLINE_MAX_MB` | no | key's project, `global`, `80` | Agent |
| `GOOGLE_DRIVE_API_KEY` | from S-2 | --- | Drive client |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | no | --- | Drive client (restricted folders; deferred) |
| `SESSION_SECRET` | yes | --- | Auth (≥ 32 bytes) |
| `DATA_DIR` | no | `./data` | Store |
| `MAX_UPLOAD_MB` | no | `1024` | Upload |
| `DASHSCOPE_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL` | no | --- | Reserved, deferred provider |
| `JUDGE_UPSTREAM` | no | `live` | `fixture` allowed only when `NODE_ENV=test` (section 12) |
| `AUTH_MODE` | no | `session` | `off` allowed only while the server binds to `127.0.0.1` (section 10) |

Nothing is exposed as `NEXT_PUBLIC_*`.

## 4. Data store (`data/`)

### 4.1 Layout

```
data/
  rubric.md                                   # optional active rubric
  users.json                                  # judge accounts
  evaluations/{evaluationId}.json             # single-upload records
  uploads/{evaluationId}.{mp4|mov|webm}       # kept for playback and retry
  batches/{batchId}/batch.json                # manifest, source of truth for the team table
  batches/{batchId}/teams/{subfolderId}.json  # full result per team
  tmp/                                        # in-flight files; emptied on startup
  logs/YYYY-MM-DD.jsonl
```

`data/` is created on first start and is gitignored.

### 4.2 Write discipline (`server/store/fs-store.ts`)

```ts
readJson<T>(path, schema: ZodType<T>): Promise<T | null>   // null if missing; throws StoreCorruptError if invalid
writeJson<T>(path, value: T, schema: ZodType<T>): Promise<void>
updateJson<T>(path, schema, fn: (cur: T | null) => T): Promise<T>   // read-modify-write under the path mutex
```

- **Atomic write**: validate with the schema, write `path.tmp-<random>`, `fsync` the file, `rename` it over the target, then `fsync` the directory.
- **Mutex**: a per-path promise chain in `mutex.ts`. Every read-modify-write goes through `updateJson`, so concurrent updates from the runner and the API never interleave.
- **Path safety** (`paths.ts`): IDs must match `UUID_RE` (evaluations) or `DRIVE_ID_RE = /^[A-Za-z0-9_-]{10,128}$/` (Drive IDs). Batch IDs must match `/^[a-f0-9]{16}$/`. Resolved paths must stay under `DATA_DIR`, and anything else throws before touching the filesystem.
- **Schema versioning**: every record has `schemaVersion`. `readJson` runs migrations from `store/migrations.ts` when the version is older, and writes the record back on its next update.
- **Corruption**: if a file fails validation, it is moved to `*.corrupt-<timestamp>` and the error is logged. The owning row shows Failed with `STORE_CORRUPT` and the batch continues.

### 4.3 Records

Zod schemas in `src/shared/schemas/`. TypeScript shapes shown for reading.

```ts
type TeamStatus = "Pending" | "Downloading" | "Uploading" | "Processing Video" | "Scoring" | "Completed" | "Failed";
type BatchStatus = "Running" | "Paused" | "Interrupted" | "Completed";

interface EvaluationRecord {
  schemaVersion: 1;
  id: string;                              // uuid v4
  source: { kind: "upload"; fileName: string; mimeType: string; sizeBytes: number; storedPath: string }
        | { kind: "drive"; batchId: string; subfolderId: string; driveFileId: string; fileName: string; sizeBytes: number; md5Checksum?: string };
  status: TeamStatus;
  step?: { name: TeamStatus; startedAt: string; note?: string };
  attempts: number;
  geminiFileName?: string;                 // set while a remote file may exist (cleanup on recovery)
  error?: { code: ErrorCode; message: string; step: TeamStatus; at: string };
  result?: JudgeResult;                    // agent-design.md section 7
  overrides: Override[];                   // S-4
  final?: { categoryScores: Record<string, number>; overallScore: number };
  createdAt: string; updatedAt: string; completedAt?: string;
}

interface Override { categoryId: string; score: 1|2|3|4|5; note: string; judge: string; at: string; removedAt?: string }

interface BatchManifest {
  schemaVersion: 1;
  id: string;                              // sha256(rootFolderId).slice(0, 16)
  rootFolderId: string; folderName: string; folderUrl: string;
  status: BatchStatus;
  createdAt: string; updatedAt: string; lastScanAt: string;
  teams: TeamRow[];                        // ordered queue
}

interface TeamRow {
  subfolderId: string; teamName: string; order: number;
  status: TeamStatus; step?: { name: TeamStatus; startedAt: string; note?: string };
  video?: { fileId: string; name: string; mimeType: string; sizeBytes: number; md5Checksum?: string; modifiedTime: string; durationMs?: number };
  warnings: string[];                      // message keys + params, e.g. "warn.multipleVideos"
  error?: { code: ErrorCode; message: string; step: TeamStatus; at: string };
  attempts: number;
  geminiFileName?: string;
  summary?: {                              // denormalized for the table and CSV
    aiCategoryScores: Record<string, number>; finalCategoryScores: Record<string, number>;
    aiOverall: number; finalOverall: number; overallComments: string;
    categoryRemarks: Record<string, string>; flags: string[];
    rubricVersion: string; model: string; completedAt: string; overridden: boolean;
  };
}
```

The team detail file `teams/{subfolderId}.json` is an `EvaluationRecord` with `source.kind = "drive"`. `batch.json` holds only the summary each row needs, so the table loads from one file.

## 5. BFF API

### 5.1 Conventions

- **Content types**: JSON in and out, except the upload body (raw video), SSE, the CSV export and video playback.
- **Errors**: always `{ "error": { "code": ErrorCode, "message": string, "details"?: object } }`. `message` is the user-facing text from the i18n catalog.
- **Validation**: every body, query and path parameter is parsed with Zod. Failures return 400 with `VALIDATION_FAILED` and per-field `details`.
- **Auth**: every handler starts with `const judge = await requireSession(request)`, which returns 401 `UNAUTHENTICATED` otherwise.
- **Mutations** (POST, PATCH, DELETE) require an `Origin` header equal to the app origin. Otherwise they return 403 `ORIGIN_MISMATCH` (CSRF defence together with `SameSite=Lax`).

### 5.2 Endpoints

| Method and path | Request | Success | Errors | Story |
| --- | --- | --- | --- | --- |
| `POST /api/auth/login` | `{ username, password }` | 204 and `Set-Cookie` | 401 `INVALID_CREDENTIALS`, 429 `RATE_LIMITED` | Auth (pending) |
| `POST /api/auth/logout` | --- | 204, cookie cleared | --- | Auth (pending) |
| `POST /api/evaluations` | Raw body; headers `Content-Type: video/*`, `X-File-Name` (URI-encoded), `Content-Length` | 202 `{ evaluationId }` | 400 `UNSUPPORTED_TYPE`, 413 `FILE_TOO_LARGE`, 400 `NOT_A_VIDEO`, 400 `EMPTY_FILE` | SNG-01 |
| `GET /api/evaluations` | `?limit=20` | 200 `{ items: EvaluationSummary[] }` | --- | SNG-01 (recent list) |
| `GET /api/evaluations/:id` | --- | 200 `EvaluationRecord` (without `storedPath`) | 404 `NOT_FOUND` | SNG-03 |
| `GET /api/evaluations/:id/events` | --- | 200 `text/event-stream` | 404 | SNG-02 |
| `DELETE /api/evaluations/:id` | --- | 204 (record and upload removed) | 409 `JOB_ACTIVE` | --- |
| `POST /api/evaluations/:id/retry` | --- | 202 | 409 `NOT_RETRYABLE` | RSM-04 |
| `GET /api/evaluations/:id/video` | `Range` header | 206 / 200 | 404, 416 | SNG-04 |
| `PATCH /api/evaluations/:id/override` | `{ categoryId, score, note }` or `{ categoryId, remove: true }` | 200 `EvaluationRecord` | 400 | TBL-03 |
| `POST /api/batches` | `{ folderUrl }` | 202 `{ batchId, reopened: boolean }` | 400 `INVALID_FOLDER_URL`, 403 `FOLDER_NOT_SHARED`, 404 `FOLDER_NOT_FOUND`, 422 `NO_TEAM_FOLDERS`, 409 `BATCH_ALREADY_RUNNING` | BAT-01, BAT-02 |
| `GET /api/batches` | --- | 200 `{ items: BatchSummary[] }` | --- | BAT-01 |
| `GET /api/batches/:id` | --- | 200 `BatchManifest` | 404 | TBL-01 |
| `GET /api/batches/:id/events` | --- | SSE | 404 | TBL-01 |
| `POST /api/batches/:id/pause` | --- | 202 | 409 `NOT_RUNNING` | RSM-02 |
| `POST /api/batches/:id/resume` | --- | 202 | 409 `ALREADY_RUNNING`, 409 `BATCH_ALREADY_RUNNING` | RSM-02 |
| `POST /api/batches/:id/rescan` | --- | 200 `{ added: number }` | 403, 404 as create | RSM-03 |
| `POST /api/batches/:id/teams/:teamId/retry` | `{ rejudge?: boolean }` | 202 | 409 `NOT_RETRYABLE` | RSM-04, RSM-03 |
| `PATCH /api/batches/:id/teams/:teamId/override` | as evaluation override | 200 | 400 | TBL-03 |
| `GET /api/batches/:id/export.csv` | --- | 200 `text/csv` | 404 | TBL-04 |
| `GET /api/rubric` | --- | 200 `{ source, version, hash, meta, text, error? }` | --- | JDG-01 |

Only one batch runs at a time. Creating or resuming a second batch while one runs returns 409 `BATCH_ALREADY_RUNNING`, and the UI offers "Open running batch".

### 5.3 Error code catalog (`src/shared/errors.ts`)

Every code maps to an HTTP status (for API errors) and an i18n key. The English text matches [stories.md](../stories.md). No message contains the word "Timeout".

| Code | Where | User message |
| --- | --- | --- |
| `UNSUPPORTED_TYPE` | Upload | Unsupported file type. Use MP4, MOV or WebM. |
| `FILE_TOO_LARGE` | Upload | File is larger than 1 GB |
| `NOT_A_VIDEO` | Upload | File is not a readable video |
| `INVALID_FOLDER_URL` | Batch | Enter a Google Drive folder link |
| `FOLDER_NOT_SHARED` | Batch | DemoDay cannot read this folder. Share it as 'Anyone with the link' and try again. |
| `NO_TEAM_FOLDERS` | Batch | No team folders found in this folder |
| `NO_VIDEO_IN_FOLDER` | Team | No video found in folder |
| `DRIVE_PERMISSION_DENIED` | Team | Permission denied or file not shared |
| `DRIVE_UNAVAILABLE` | Team | Google Drive unavailable, retry later |
| `VIDEO_UNPROCESSABLE` | Agent | Video could not be processed (corrupted or unsupported format) |
| `PROCESSING_TOO_LONG` | Agent | Video processing did not finish. Retry later. |
| `AI_UNAVAILABLE` | Agent | AI service unavailable, retry later |
| `AI_REJECTED` | Agent | AI service rejected the request (check configuration) |
| `AI_BLOCKED` | Agent | The AI declined to score this video ({reason}) |
| `INVALID_MODEL_OUTPUT` | Agent | The AI returned an incomplete scorecard |
| `RUBRIC_INVALID` | Agent | Rubric configuration invalid |
| `INTERRUPTED` | Recovery | Interrupted by server restart |
| `STORE_CORRUPT` | Store | Saved data for this item could not be read |
| `INTERNAL` | Any | Something failed inside DemoDay. Retry, and check the server log if it repeats. |

## 6. Single video evaluation (S-1)

### 6.1 Upload (`POST /api/evaluations`)

1. **Check headers** before reading the body:
   - `Content-Type` must be one of `video/mp4`, `video/quicktime`, `video/webm`. The extension in `X-File-Name` must match it.
   - `Content-Length` ≤ `MAX_UPLOAD_MB`. A missing length is allowed; it is enforced while streaming.
2. **Stream to disk**: `Readable.fromWeb(request.body)` is piped through a byte counter into `data/tmp/{uuid}.part`. Exceeding the limit aborts the stream, deletes the file and returns 413.
3. **Sniff**: read the first 12 bytes. MP4/MOV must have `ftyp` at offset 4; WebM must start with `1A 45 DF A3`. A mismatch returns `NOT_A_VIDEO`.
4. **Commit**: rename to `data/uploads/{evaluationId}.{ext}`, write the `EvaluationRecord` with `status: "Uploading"` (the server-side step "Uploading" means uploading to Gemini), and enqueue a `single` job.
5. Return 202 `{ evaluationId }`.

Client: the upload uses `XMLHttpRequest` for `upload.onprogress`, which drives the percentage in the Uploading step (prototype behavior). After the 202 the client switches to SSE.

### 6.2 Single job (`server/jobs/single-job.ts`)

```ts
async function runSingle(evaluationId, signal) {
  const rec = await evaluations.get(evaluationId);
  const rubric = await loadRubric();                       // RUBRIC_INVALID → Failed
  const result = await judgeVideo({
    source: { path: rec.source.storedPath, mimeType, sizeBytes, displayName: rec.source.fileName },
    rubric, signal,
    onStep: (step, note) => transition(evaluationId, step, note),           // persists + emits
    onRemoteFile: (name) => evaluations.patch(evaluationId, { geminiFileName: name }),
  });
  await evaluations.complete(evaluationId, result);        // status Completed, final = AI scores
}
```

Errors thrown by `judgeVideo` are `JudgeError { code, message, retryable }`. The job catches them and writes `status: "Failed"` with `error`. Anything else is logged with its stack and stored as `INTERNAL`.

## 7. Job runner (`server/jobs/`)

### 7.1 Model

- **Two lanes**:
  - The *batch lane* runs at most one batch, processing its teams in order.
  - The *single lane* processes single evaluations in arrival order, also one at a time.
  - The lanes run independently, so at most two Gemini jobs are active at once.
- **Job types**:

  ```ts
  type Job =
    | { kind: "single"; evaluationId: string }
    | { kind: "batch"; batchId: string }
    | { kind: "team-retry"; batchId: string; subfolderId: string };
  ```

  A team retry while its batch is idle runs on the batch lane as a one-team batch.
- **Cancellation**: each job gets an `AbortController`. Pause sets a flag that the batch loop checks *between* teams; the current team finishes. Shutdown (SIGTERM) aborts the controllers. Aborted work is reset to `Pending` in the checkpoint so resume picks it up.

### 7.2 Status transitions (`src/shared/status.ts`)

```ts
const NEXT: Record<TeamStatus, TeamStatus[]> = {
  "Pending":          ["Downloading", "Uploading", "Failed"],
  "Downloading":      ["Uploading", "Completed", "Failed", "Pending"],   // Completed: saved result reused (S-3)
  "Uploading":        ["Processing Video", "Failed", "Pending"],
  "Processing Video": ["Scoring", "Failed", "Pending"],
  "Scoring":          ["Completed", "Failed", "Pending"],
  "Completed":        ["Pending"],          // explicit re-judge only
  "Failed":           ["Pending"],          // retry
};
```

`transition()` rejects any other move with an internal error. Pending is reachable from in-progress states only through recovery or abort. Unit tests cover the whole table.

### 7.3 Event bus and SSE

- `events.ts` wraps `EventEmitter` with channels `evaluation:{id}` and `batch:{id}`. An event is emitted only *after* its checkpoint is written, so the UI never shows progress that has not been persisted.
- **Event shape**:

  ```ts
  type JobEvent =
    | { type: "step"; id: string; status: TeamStatus; step?: { name; startedAt; note? }; at: string }
    | { type: "completed"; id: string; summary: TeamRow["summary"]; at: string }
    | { type: "failed"; id: string; error: { code; message; step }; at: string }
    | { type: "batch"; batchId: string; status: BatchStatus; counts: Record<TeamStatus, number>; at: string };
  ```

- **SSE route**: returns `new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no" } })`.
  - On connect it first sends a `snapshot` event with the current record or manifest, so a reconnect needs no separate fetch.
  - It sends a `: keep-alive` comment every 15s.
  - It unsubscribes when `request.signal` aborts.
- **Client** (`useJobEvents`): `EventSource`, applying events to the React Query cache through `setQueryData`. On `error` it falls back to polling the snapshot every 3s, and retries SSE with backoff (1s, 2s, 5s, 10s).

### 7.4 Batch job (`server/jobs/batch-job.ts`)

```ts
async function runBatch(batchId, signal) {
  await batches.setStatus(batchId, "Running");
  for (;;) {
    if (pauseRequested(batchId)) return batches.setStatus(batchId, "Paused");
    const team = (await batches.get(batchId)).teams.find(t => t.status === "Pending");  // queue order
    if (!team) break;
    await runTeam(batchId, team, signal);          // never throws; records Failed on error
  }
  await batches.setStatus(batchId, "Completed");
}

async function runTeam(batchId, team, signal) {
  // 1. Skip rule (RSM-03): a completed team detail with the same video checksum is never re-judged.
  // 2. Locate video (BAT-03) → Downloading → stream to data/tmp (BAT-04)
  // 3. judgeVideo(...) → Uploading / Processing Video / Scoring
  // 4. Checkpoint order (RSM-01):
  //      a) write teams/{subfolderId}.json (full result)
  //      b) update batch.json row (status Completed + summary)
  //      c) emit "completed"
  //    A crash between a) and b) leaves the row non-Completed; on resume the skip rule finds
  //    the completed team file with a matching checksum and marks the row Completed without re-judging.
  // 5. finally: delete temp file
}
```

### 7.5 Create, reopen and rescan (`POST /api/batches`, `/rescan`)

1. Parse the folder URL (section 8.1) to get `rootFolderId`. `batchId = sha256(rootFolderId).slice(0,16)`.
2. **Folder metadata**: `GET /files/{rootFolderId}?fields=id,name,mimeType&supportsAllDrives=true`.
   - 404 or 403 returns `FOLDER_NOT_SHARED`.
   - A non-folder mimeType returns `INVALID_FOLDER_URL`.
3. **Subfolders**: list them (section 8.2). If there are none: `NO_TEAM_FOLDERS`.
4. **Merge** into the manifest under the mutex:
   - Existing rows are kept unchanged.
   - New subfolders are appended as `Pending`, after existing rows. A subfolder renamed in Drive keeps its row (matched by ID) and its name is updated.
   - Subfolders deleted from Drive keep their row and get the warning `warn.folderRemoved`.
5. Enqueue the batch unless it is `Completed` and nothing was added. Return `reopened: true` when the manifest already existed.

Team order: natural sort by name (`localeCompare(b, undefined, { numeric: true, sensitivity: "base" })`), so "Team 2" comes before "Team 10". The order is fixed when a row is created.

### 7.6 Recovery at startup (`server/jobs/recovery.ts`)

Runs once from `instrumentation.ts` before the runner accepts jobs:

1. Empty `data/tmp/`.
2. For each batch with status `Running`: set it to `Interrupted`, and reset rows in an in-progress state to `Pending`.
3. For each evaluation in an in-progress state: set it to `Failed` with `INTERRUPTED`. The stored upload stays, so Retry works without a new upload.
4. Collect every `geminiFileName` on rows and records that are not `Completed`. Delete each remote file (best effort; 404 counts as done), then clear the field.
5. Batches are never resumed automatically (RSM-02). A judge resumes them.

## 8. Google Drive client (`server/drive/`)

All calls use native `fetch` against `https://www.googleapis.com/drive/v3` with the header `x-goog-api-key: GOOGLE_DRIVE_API_KEY`, so the key never appears in a URL. Each request has a 30s connect-and-headers limit through `AbortSignal.timeout` and is retried per section 8.5.

### 8.1 URL parsing (`url.ts`)

Accepted forms (host `drive.google.com`):

- `/drive/folders/{id}`
- `/drive/u/{n}/folders/{id}`
- `/open?id={id}`
- `/drive/mobile/folders/{id}`

Any query string such as `?usp=sharing` is ignored. The ID must match `DRIVE_ID_RE`. Anything else returns `INVALID_FOLDER_URL`. Unit tests cover every form plus rejects: other hosts, file links (`/file/d/`) and empty IDs.

### 8.2 Listing (`client.ts`)

```
GET /files
  ?q='<parentId>' in parents and trashed=false and mimeType='application/vnd.google-apps.folder'
  &fields=nextPageToken,files(id,name,mimeType)
  &pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true
```

- Follows `nextPageToken` until it is exhausted (BAT-02, 250-folder case).
- Values in `q` are quote-escaped (`'` → `\'`), even though IDs are pattern-validated.

### 8.3 Video selection (`select-video.ts`, BAT-03)

```
q='<teamFolderId>' in parents and trashed=false and
  (mimeType contains 'video/' or mimeType='application/vnd.google-apps.shortcut')
fields=nextPageToken,files(id,name,mimeType,size,md5Checksum,modifiedTime,
       videoMediaMetadata(durationMillis),shortcutDetails(targetId,targetMimeType))
```

1. Resolve shortcuts whose `targetMimeType` starts with `video/`. Fetch target metadata with the same fields. Other shortcuts are ignored.
2. Zero candidates: `NO_VIDEO_IN_FOLDER`.
3. One candidate: use it.
4. Several: pick the latest `modifiedTime` and add the warning `warn.multipleVideos { count, chosen }`.

### 8.4 Download (BAT-04)

`GET /files/{id}?alt=media&supportsAllDrives=true` streams the response body into `data/tmp/{batchId}-{subfolderId}.{ext}` with `pipeline()`. There is no whole-file buffering.

- The connect limit applies; the body stream has no total-time limit, but a stall watchdog aborts if no bytes arrive for 60s.
- Bytes written are compared with `size`. A mismatch counts as a retryable failure.
- A 403 with reason `cannotDownloadAbusiveFile` maps to `DRIVE_PERMISSION_DENIED`. The message says Drive flagged the file; `acknowledgeAbuse` is not set automatically.

### 8.5 Error mapping and retries (`errors.ts`, RSM-06)

Drive reports rate limits as 403 with a reason, so the reason must be read before deciding.

| Response | Reason (`error.errors[0].reason`) | Mapping | Retry |
| --- | --- | --- | --- |
| 429 | any | rate limited | yes |
| 403 | `rateLimitExceeded`, `userRateLimitExceeded`, `sharingRateLimitExceeded` | rate limited | yes |
| 403 | other | `DRIVE_PERMISSION_DENIED` | no |
| 404 | `notFound` | `DRIVE_PERMISSION_DENIED` (unshared files appear as 404) | no |
| 500, 502, 503, 504, network error | --- | `DRIVE_UNAVAILABLE` | yes |

Retry policy: 3 attempts in total, exponential backoff of 1s and 2s plus up to 500ms jitter between them. `Retry-After` is honoured when present (capped at 30s). The step note shows "Google Drive busy · attempt n of 3".

### 8.6 Service account (deferred)

When `GOOGLE_SERVICE_ACCOUNT_JSON` is set:

1. Sign an RS256 JWT with Node `crypto` (scope `https://www.googleapis.com/auth/drive.readonly`).
2. Exchange it at `https://oauth2.googleapis.com/token`.
3. Cache the token until 60s before expiry, and send `Authorization: Bearer` instead of the key.

Not part of S-2. It needs its own story.

## 9. CSV export (`server/csv/`, TBL-04)

### 9.1 Columns

Category columns are generated from the rubric categories recorded on the batch's results, in rubric order.

```
Team, Status, Status reason,
<Category> AI score, <Category> final score, <Category> remarks,   (repeated per category)
Overall AI score, Overall final score, Overall comments,
Flags, Warnings, Overridden, Rubric version, Model, Evaluated at
```

- Scores are plain numbers. Overall scores have 2 decimals. Unscored cells are empty.
- `Evaluated at` is ISO 8601 UTC.

### 9.2 Encoding (`escape.ts`)

```ts
export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return '""';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // formula-injection guard
  return '"' + s.replace(/"/g, '""') + '"';          // RFC 4180: always quote, double inner quotes
}
export const csvRow = (cells: unknown[]) => cells.map(csvCell).join(",") + "\r\n";
```

- Embedded `\n` and `\r\n` stay inside the quoted field.
- The file starts with a UTF-8 BOM (`﻿`).
- **Response headers**: `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename="scores.csv"`.
- **Body**: generated from `batch.json` only, so the export works during a running batch.

Unit tests cover:

- commas, quotes and multi-line remarks round-tripping through a real CSV parser written in the test (the RFC 4180 grammar);
- each of the injection prefixes;
- the BOM;
- Chinese and accented team names.

## 10. Authentication (pending story)

Sign-in is not in the BRD. tech-spec.md lists `SESSION_SECRET` and points here. This design is ready to implement once the story is captured with `/new-requirement`. Until then the app runs single-user on localhost, and the proxy gate is disabled with `AUTH_MODE=off`, which is allowed only when bound to `127.0.0.1`.

- **Accounts**: `data/users.json` = `[{ username, passwordHash, createdAt }]`.
  - The hash is `scrypt` (N=2^15, r=8, p=1, 16-byte salt), stored as `scrypt$N$r$p$salt$hash`.
  - Accounts are created with `npm run user:add -- <username>`, which prompts for the password.
- **Session cookie** `dd_session`:
  - Value: `base64url(JSON{ sub, iat, exp }) + "." + base64url(HMAC-SHA256(SESSION_SECRET, payload))`.
  - Attributes: `HttpOnly; SameSite=Lax; Path=/; Max-Age=43200`, plus `Secure` when served over HTTPS.
  - Verification uses `timingSafeEqual`.
- **Login rate limit**: 5 failures per username and IP per 15 minutes, in memory.

## 11. Frontend

### 11.1 Pages and data

| Page | Server component reads | Client components | Query keys |
| --- | --- | --- | --- |
| `/evaluate` | Rubric meta (for stickers), recent evaluations | `UploadDropzone`, `StepTracker`, `PitchClock`, `Scorecard` | `["evaluations"]`, `["evaluation", id]` |
| `/results/[id]` | The evaluation record | `Scorecard` | `["evaluation", id]` |
| `/rubric` | `GET /api/rubric` equivalent (direct server call) | --- (static) | --- |
| `/batches` | Batch summaries | `StartBatchForm` (RHF + Zod) | `["batches"]` |
| `/batches/[id]` | Manifest | `BatchHeader`, `TeamTable`, `ReviewPanel` | `["batch", id]`, `["team", batchId, subfolderId]` |

- Server components read the store directly through the same repositories, with no HTTP hop, and pass the initial data to client components. Those components hydrate React Query with `initialData`, so stored scores render on first paint (TBL-01: within 2s).
- Zustand holds only UI state: the open review row, remarks expansion, density, and the shortcut on/off switch (persisted to `localStorage`).

### 11.2 Components and guideline mapping

Component names and contracts follow [ui-guideline.md](../ui-guideline.md) section 6. The prototype's `renderScorecard`, step tracker and pitch clock are the reference behavior. They are rebuilt as typed React components, with no prototype code carried over.

### 11.3 i18n

- **Catalog**: all user-facing strings live in `src/i18n/messages/en.json`, keyed by area (`evaluate.dropzone.title`, `error.FILE_TOO_LARGE`, `status.Processing Video`).
- **`t(key, vars)`**: a small function using `{name}` interpolation, shared by server (error messages) and client. No i18n library is added; that would need approval under the stack rule.
- **Tests**: a unit test fails if a component file contains a JSX text literal outside `t()` (an ESLint rule `react/jsx-no-literals` with an allowlist).

### 11.4 Brand assets

- The logo mark is a React component, rendering the same geometry as `specs/prototype/assets/logo.svg`.
- Banner photos are served from `public/img/` with `next/image`: `priority` on the Evaluate banner, `sizes` set per breakpoint.
- `PhotoCredit` renders the author, title and licence from a typed registry (ui-guideline.md section 2.2).

## 12. Testing

Extends `common-test-strategy`. Coverage targets: 100% of critical paths (status transitions, skip rule, checkpoint order, CSV escaping, Drive error mapping, upload validation) and ≥ 80% overall.

| Layer | Tooling | Scope |
| --- | --- | --- |
| Unit (Vitest) | Pure functions | URL parser, video selection, Drive error mapper, retry/backoff (fake timers), status table, CSV cell and row, path safety, session sign and verify, scrypt verify, env parsing, natural sort |
| Integration (Vitest, Node) | Real filesystem in a per-test `DATA_DIR` (temp dir), Route Handlers called with `Request` objects, `fetch` injected | Upload streaming (size cap, sniff), store atomicity and mutex under concurrent updates, batch create/reopen/rescan merge, batch run against recorded Drive and Gemini fixtures, crash-between-writes recovery, startup recovery, pause and resume, CSV over a populated batch, 401/403 paths |
| E2E (Playwright) | `next start` with `JUDGE_UPSTREAM=fixture` and a temp `DATA_DIR` | S-1: upload → steps → scorecard → reload result; failure path (`unprocessable` fixture). S-2: start batch → rows fill in order → empty-folder team shows Failed → batch completes. S-3: kill and restart server mid-batch → Interrupted → Resume continues at the right team; export CSV and parse it. Keyboard-only run of each journey; `@axe-core/playwright` scan (to be added) |
| Live (opt-in) | `npm run test:live` with real keys | One real Drive folder and one real Gemini evaluation |

**Fixtures** (`tests/fixtures/`):

- Drive JSON responses recorded from a real shared test folder.
- Gemini responses recorded from real calls: file resource states, a `generateContent` response, and error bodies.
- The two test videos from `specs/prototype/test-videos/`.

`JUDGE_UPSTREAM=fixture` swaps the `fetch` used by the Drive client and Gemini provider for a fixture router. It is rejected at startup unless `NODE_ENV=test`.

## 13. Observability

- **`server/log.ts`**: writes JSON lines to stdout and `data/logs/YYYY-MM-DD.jsonl`.
  - Fields: `ts`, `level`, `event`, `jobId`, `batchId?`, `teamId?`, `step?`, `durationMs?`, `code?`, `attempt?`.
  - Keys named `key`, `token`, `authorization`, `password`, `secret` are redacted at any depth.
- **One `job.step` event per transition**, and one `job.done` event with step durations and token usage (from the agent's provenance).
- **Batch page footer** shows total tokens and wall time for the batch. S-4 adds AI-versus-human score difference metrics there.

## 14. Story traceability

| Story | Modules |
| --- | --- |
| SNG-01 | `api/evaluations/route.ts`, `server/upload/*`, `UploadDropzone` |
| SNG-02 | `jobs/single-job.ts`, `jobs/events.ts`, `api/evaluations/[id]/events`, `useJobEvents`, `StepTracker` |
| SNG-03 | `Scorecard`, `CategoryRow`, `OverallScore`, `results/[id]` |
| SNG-04 | `api/evaluations/[id]/video`, `ReviewPanel` video pane |
| BAT-01 | `api/batches/route.ts`, `drive/url.ts`, `StartBatchForm` |
| BAT-02 | `drive/client.ts` (list subfolders), batch merge |
| BAT-03 | `drive/select-video.ts` |
| BAT-04 | `drive/client.ts` (download) |
| BAT-05 | `jobs/batch-job.ts`, `jobs/runner.ts` |
| JDG-01 to JDG-06, RSM-05 | Agent (see agent-design.md) |
| TBL-01 | `batches/[id]/page.tsx`, `TeamTable`, SSE |
| TBL-02 | `ReviewPanel` |
| TBL-03 | `override` routes, `final` computation, `OverrideDialog` |
| TBL-04 | `server/csv/*`, `export.csv` route |
| RSM-01 | `store/fs-store.ts`, checkpoint order in `batch-job.ts` |
| RSM-02 | `jobs/recovery.ts`, pause and resume routes |
| RSM-03 | Skip rule in `batch-job.ts`, rescan merge, rubric-version marker |
| RSM-04 | Retry routes |
| RSM-06 | `drive/errors.ts`, retry helper |

## 15. Implementation notes (S-1 2026-10-05, S-2 2026-10-06, S-3 and S-4 2026-10-07)

Where the S-1 build differs from the sections above:

| Topic | Design said | Built | Reason |
| --- | --- | --- | --- |
| Server-only guard | `import "server-only"` in `src/server/**` | ESLint `no-restricted-imports` blocks `@/server/*` from `src/components/**` and `src/hooks/**` | The agent also runs from the command line (`npm run judge`), where `server-only` throws |
| Server imports | `@/` aliases | Relative imports with `.ts` extensions in `src/server/**`, `src/shared/**`, `src/i18n/**` | Node 24 runs these files directly (type stripping) for the CLI; no extra tool such as `tsx` |
| Fixture mode | Allowed only when `NODE_ENV=test` | Refused only when `NODE_ENV=production` | E2E runs against `next dev` (development); `next start` always means production |
| Fixture poll interval | --- | `JUDGE_POLL_MS` (fixture mode only) | Integration tests run polling in milliseconds; E2E keeps 2s so steps are visible |
| New evaluation status | `Uploading` at creation | `Pending` at creation, `Uploading` when the job starts | A second upload can wait behind the first in the single lane |
| Client data loading | SSE plus initial fetch | SSE snapshot only; fetch only after falling back to polling | A parallel fetch could resolve after a newer event and overwrite it |
| Job lanes | Single and batch lanes | Both, since S-2 | --- |
| Auth | Section 10 | Not built; server binds to `127.0.0.1` | Pending story |
| Error checks across the app context (S-2) | `instanceof` | `isDriveError()` checks by name and fields where errors cross from the shared app context into a route | Under `next dev` the startup hook and the routes load separate copies of the same modules. `instanceof` failed and an unshared folder returned 500 |
| Drive client config | Fail at startup without `GOOGLE_DRIVE_API_KEY` | Optional. Batch start returns `DRIVE_NOT_CONFIGURED` | Single uploads keep working without Drive |
| Batch states | Running, Paused, Interrupted, Completed | Running, Interrupted, Completed | Pause and Resume arrive with S-3 (RSM-02). Until then, starting the same folder again continues an interrupted batch |
| Unsupported Drive video types | --- | Team fails with `UNSUPPORTED_TYPE` unless MP4, MOV or WebM | Same formats as single upload |
| Pause (S-3) | Flag checked between teams | In-memory pause request, taken by the batch loop before the next team; the batch becomes `Paused`. A pause requested before the first team starts pauses immediately | --- |
| Reuse of saved results (S-3) | Skip by subfolder and checksum | Before downloading, a saved `teams/<id>.json` for the same Drive file and checksum is reused: the row is restored to Completed without download or AI call. Explicit Re-judge sets `forceJudge` to bypass reuse once | Covers the crash between the two checkpoint writes (RSM-01) and reruns (RSM-03) |
| Changed-video detection (S-3) | --- | Rescan and reopen re-list each completed team's folder; a different file or checksum puts the row back to Pending | Costs one Drive listing per completed team per rescan |
| Status table (S-3) | Completed only from Scoring | Also Downloading → Completed (reused result) | --- |
| CSV columns (S-3) | From the rubric recorded on results | From the current rubric's categories; "final" equals AI until overrides exist (S-4) | Results judged with a different rubric still export their matching category ids |
| Overrides (S-4) | List of overrides with judge name | One override per category (`overrides: { [categoryId]: { score, note, at } }`) plus stored `final` scores; no judge name until sign-in exists. A re-judge clears overrides, because they refer to the previous AI result | --- |
| Override validation (S-4) | 1–5 segmented control | Number input validated in the browser (RHF + Zod) and on the server, with the story's messages | TBL-03 tests entering 6 |
| Delete (S-4) | `DELETE /api/evaluations/:id` with 409 `JOB_ACTIVE` | As designed, plus `DELETE /api/batches/:id`; remote copies are deleted best effort; Drive is never touched | RSM-07 |
| Flag wording (S-4) | "Over 3:00" chips (ui-guideline 6.7) | "Exceeds 3-minute maximum (3:24)" and the JDG-06 texts | Aligns the UI with the SNG-03/JDG-06 acceptance criteria |
| E2E server (S-4) | --- | `NEXT_DIST_DIR=.next-e2e`, so E2E runs beside a developer's `next dev` (Next 16 allows one dev server per build folder) | Tests no longer need to stop the developer's server |
| Reopening a batch | Keeps all rows | Also queues rows that failed with `AI_UNAVAILABLE`, `DRIVE_UNAVAILABLE` or `PROCESSING_TOO_LONG` (`TEMPORARY_FAILURES`) | Retry path until RSM-04 adds per-team Retry |

## 16. Open items

| Item | Needed by | Default until decided |
| --- | --- | --- |
| Authentication story | Before deploying beyond localhost | `AUTH_MODE=off` on 127.0.0.1 only |
| Next.js advisory (16.2.11, critical) | Before any non-local deployment | Stay pinned (tech-spec) |
| `@axe-core/playwright` dev dependency | S-1 E2E | Not installed; needs approval |
| Upload size limit and retention | S-1 | 1 GB; kept until deleted |
| Weights sum to 60% | S-1 | Normalized weighted mean |
