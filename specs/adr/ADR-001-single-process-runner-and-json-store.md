# ADR-001: Single Node process with an in-process job runner and a local JSON store

## Status
Accepted

## Context
DemoDay judges ~3-minute videos. One evaluation takes seconds to minutes (upload, Gemini processing, scoring), and batches run one team at a time. tech-spec.md requires local JSON storage in `data/` (no database) and resumable batches. One deployment serves one event and a small group of judges.

## Decision
- Run the app as one long-lived Node.js process (`next dev` / `next start`).
- Long work runs in an in-process job runner (lanes on `globalThis`), never inside a request. Requests start jobs and read state.
- State lives in JSON files under `data/`. Every write validates with Zod, writes a temp file, fsyncs and renames. Read-modify-write is serialized with a per-path lock.
- Progress reaches the browser through server-sent events. Each event is emitted only after its checkpoint is written.
- Serverless hosting is out of scope.

## Rationale
- Serverless functions cannot hold multi-minute jobs or a local filesystem between requests.
- A queue plus a database (Redis, Postgres) adds infrastructure without benefit at one event's scale, and tech-spec rules out a database.
- Atomic rename plus per-path locks gives crash safety without a database.

## Consequences
- The app cannot scale beyond one instance. The scale-out path is in architecture-design.md section 13 (separate worker, Postgres, queue).
- Startup recovery is required: in-flight jobs become Failed or Interrupted, and orphaned remote files are deleted (`src/server/jobs/recovery.ts`).
- Dev hot reload must not create a second runner, which is why singletons live on `globalThis`.

## Date
2026-10-05
