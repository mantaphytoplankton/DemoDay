# ADR-007: A batch is identified by its Drive folder; reopening continues it

## Status
Accepted

## Context
Judges start a batch by pasting a Drive folder link (BAT-01). Runs get interrupted (server restarts) or partly fail (AI overload). tech-spec requires that resumed runs never re-bill or re-judge completed teams. S-2 has no Pause, Resume or per-team Retry controls yet; those are RSM-02 and RSM-04 in S-3.

## Decision
- **Batch ID** = `sha256(rootFolderId)` truncated to 16 hex characters. The same folder, whatever the link format (`?usp=sharing`, `/u/1/`, `open?id=`), always maps to the same batch.
- **Reopening** (submitting the same folder again):
  - keeps every existing row, so completed teams are never judged again;
  - updates renamed team folders by ID;
  - appends new subfolders as Pending;
  - re-queues rows that failed for a temporary reason (`TEMPORARY_FAILURES`: `AI_UNAVAILABLE`, `DRIVE_UNAVAILABLE`, `PROCESSING_TOO_LONG`);
  - leaves lasting failures alone: no video, not shared, unprocessable.
- **After a restart**, a Running batch becomes Interrupted and in-flight rows return to Pending. Nothing resumes automatically; reopening the folder continues it.
- **One batch runs at a time.** Another folder gets `BATCH_ALREADY_RUNNING`.

## Rationale
- Deriving the ID from the folder makes "same link again" safe by construction. A random ID per submission would create duplicate batches and double billing.
- Re-queuing only temporary failures gives judges a retry path before the RSM-04 Retry button exists, without wasting AI requests on teams that cannot succeed.
- Manual continuation after a restart avoids surprise billing (architecture-design.md Q5).

## Consequences
- Reopening is currently the only retry mechanism. S-3 adds explicit Resume (RSM-02) and per-team Retry (RSM-04) on the same rules.
- Judging the same folder twice from scratch requires deleting its `data/batches/<id>/` directory; a re-judge action is part of RSM-03.
- Covers candidate 07 in architecture-design.md section 15. Checksum-based skipping of changed videos (RSM-03) is not built yet.

## Date
2026-10-07
