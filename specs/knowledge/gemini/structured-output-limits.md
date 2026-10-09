---
title: Structured-output schema limits on Vertex AI (gemini-3.8-flash)
type: ops-lesson
status: active
as_of: 2026-10-09
tags:
  - gemini
  - vertex
  - structured-output
related_spec: specs/agent/agent-design.md
related:
  - adr/ADR-013-supporting-fields-never-discard-scores.md
  - knowledge/gemini/providers-and-routes.md
---

# Structured-output schema limits on Vertex AI

## Summary
Vertex AI rejected the whole scoring request with `400 INVALID_ARGUMENT` ("Request contains an invalid argument.", no field named) after the S-5 transcript array was added to `responseJsonSchema`. The cause was `maxItems` on that array: constrained decoding has a complexity limit, and a large `maxItems` on an array of objects exceeds it. The error does not say so. All automated tests passed, because the protocol stand-in does not model this limit; only a live run found it.

## Evidence
Text-only probes against `gemini-3.8-flash` on Vertex `global`, 2026-10-09 (no video, fractions of a cent each):

| Schema sent | Result |
| --- | --- |
| v2 scorecard (observations `maxItems: 40`) | OK |
| v2 + summary string | OK |
| v2 + transcript array (`minItems: 1, maxItems: 150`, 4 fields, `additionalProperties: false`, `text maxLength: 1500`) | 400 |
| Transcript alone, same constraints | 400 |
| Transcript alone, 4 fields, no array limits | OK |
| … with `minItems: 1` only | OK |
| … with `maxItems: 40` | OK |
| … with `maxItems: 100` or `150` | 400 |
| v2 + transcript with `maxItems: 40` and the other constraints | 400 |
| Full v3 schema without the transcript's `maxItems` | OK |
| Same, also without `minItems` or `text maxLength` | OK |

So the limit depends on the combination of constraints, not on one keyword. `maxLength` on strings and `additionalProperties: false` were fine on their own.

## Lesson / guidance
- When a new array or long field is added to the response schema, run one live request (`make judge VIDEO=...`) before calling the change done. The stand-in validates the request shape, not the provider's limits.
- A bare `400 INVALID_ARGUMENT` right after a schema change points at schema complexity. Probe with text-only requests and the schema reduced step by step (variants script approach: `provider.generate` with `thinkingBudget: 0`).
- Keep size limits that the provider rejects in the Zod validation and remove them from the request (`buildRequestSchema` in `output-schema.ts`). The answer is still checked.
- AI Studio (`gemini` provider) was not probed for this limit; the request without `maxItems` works for both.

## Links
- [agent-design.md 7.2](../../agent/agent-design.md) (request schema)
- [ADR-013](../../adr/ADR-013-supporting-fields-never-discard-scores.md)
