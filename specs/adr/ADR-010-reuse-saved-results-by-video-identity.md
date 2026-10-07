# ADR-010: Saved team results are reused when the Drive video is unchanged

## Status
Accepted

## Context
S-3 needed three behaviours that all hinge on one question, "has this team already been judged on this video?":
- RSM-01: a crash can land between writing `teams/<id>.json` and updating the row.
- RSM-03: a rerun must not re-judge unchanged teams, but must re-judge a team whose video changed.
- RSM-04: an explicit Re-judge must actually call the AI.

## Decision
- **Video identity** is the Drive file ID plus `md5Checksum`, or `modifiedTime` when Drive gives no checksum (`sameVideo()` in `batch-job.ts`).
- **Before downloading**, the batch job looks for a saved team result with the same video identity. If one exists, it restores the row to Completed (status Downloading → Completed), without downloading or calling the AI, and does not count it as an attempt.
- **Rescan and reopen** re-list each completed team's folder. A different file or checksum puts the row back to Pending, so that team is judged again.
- **Explicit Re-judge** sets `forceJudge` on the row, which bypasses reuse once and is cleared on completion.
- **Results judged with an older rubric version** are marked in the UI ("Judged with a previous rubric") but are not re-judged automatically.

## Rationale
Alternatives considered:
- **Skip by subfolder only** (the original sketch). Rejected: it can't detect a replaced video.
- **Always re-judge on rerun.** Rejected: it re-bills completed teams (tech-spec "Batch Resumability").
- **A separate crash journal.** Rejected: the saved team file already is the journal.

## Consequences
- Each rescan costs one Drive listing per completed team.
- The status transition table gained Downloading → Completed (app-design.md section 7.2).
- A rubric change never re-bills silently; judges choose which teams to re-judge.

## Date
2026-10-07
