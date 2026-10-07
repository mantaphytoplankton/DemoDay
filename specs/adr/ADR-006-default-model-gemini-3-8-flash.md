# ADR-006: Default judging model is `gemini-3.8-flash`

## Status
Accepted

## Context
tech-spec.md named `gemini-2.5-pro` as the default, with `gemini-2.5-flash` as the faster option. On 2026-10-05 the project's API key (free tier) could not use either:
- Both 2.5 models returned 404 on `generateContent` ("no longer available to new users").
- `gemini-3.1-pro-preview`, which Google suggested in place of 2.5 Pro, has a free-tier quota of 0.

`gemini-3.8-flash` completed real evaluations, including a 104-second pitch video judged in 58 seconds.

## Decision
`GEMINI_MODEL` defaults to `gemini-3.8-flash` in code (`src/server/env.ts`), in `.env.local.example`, in tech-spec.md and in the design specs. `gemini-3.1-pro-preview` is the documented higher-quality option and requires billing on the key's project.

## Rationale
- It is the only verified model that works on the key the project actually has.
- Flash is also the throughput choice for S-2 batches, where teams are judged one at a time.
- Alternative considered: keep Pro as the default and require billing. Rejected for now, because it blocks first use and there is no quality evidence yet that Pro scores better for this rubric.

## Consequences
- Scoring quality is unmeasured for either model. Choosing between Flash and Pro should come from the golden set (agent-design.md section 13) once reference videos exist.
- Google retires or restricts models without changing the model list. Verify any model change with a real `generateContent` call (`make judge`), not the model list.
- Every result records its model and model version, so scores from different models stay distinguishable.

## Date
2026-10-06
