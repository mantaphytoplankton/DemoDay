# ADR-012: Human overrides sit beside the AI score and are cleared by a re-judge

## Status
Accepted

## Context
TBL-03 makes human judges the final authority (BRD guardrail). The design sketched an override list per evaluation with the judge's name. In S-4 the questions were:
- whether overrides replace the AI score;
- how many are kept per category;
- what happens to them when a team is re-judged (RSM-03/04);
- whose name is recorded, given that sign-in does not exist yet.

## Decision
- **The AI score is never changed.** Overrides are stored separately: `overrides: { [categoryId]: { score, note, at } }`, one active override per category. A new override replaces the old one, and Remove deletes it.
- **Final scores are computed in code** (`computeFinal`): AI scores with overrides applied, the overall score recalculated with the rubric weights, and `overridden` set. They are stored with the item (`final` on single evaluations, `summary.final` on batch rows), so the table and the CSV need no extra reads.
- **A note is required.** The score must be a whole number from 1 to 5, validated in the browser and on the server with the story's messages.
- **A re-judge clears overrides.** They referred to the previous AI result; keeping them would silently attach old human judgments to new AI remarks.
- **No judge identity** is recorded until a sign-in story exists.

## Rationale
Alternatives considered:
- **Edit the AI score in place.** Rejected: it loses the comparison that the AI-versus-human metrics (architecture-design.md section 12) rely on.
- **Keep a full history per category.** Deferred: no story asks for an audit trail yet, and the note already explains the latest change.
- **Keep overrides across a re-judge.** Rejected, for the reason above.

## Consequences
- The CSV exports both AI and final scores, plus an "Overridden" column.
- Adding sign-in later means adding `judge` to each override. The stored shape allows that without migrating old records.
- AI-versus-human difference metrics can be computed from stored data whenever they are scheduled.

## Date
2026-10-07
