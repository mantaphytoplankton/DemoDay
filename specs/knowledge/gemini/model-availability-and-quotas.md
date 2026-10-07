---
title: Gemini model availability and free-tier quotas
type: ops-lesson
status: active
as_of: 2026-10-07
tags:
  - gemini
  - configuration
  - debugging
related_spec: specs/tech-spec.md
related:
  - adr/ADR-004-gemini-rest-fetch-and-protocol-fake.md
  - adr/ADR-006-default-model-gemini-3-8-flash.md
  - adr/ADR-008-error-specific-retry-budgets.md
  - adr/ADR-011-bounded-scoring-wait.md
  - knowledge/gemini/providers-and-routes.md
---

# Gemini model availability and free-tier quotas

## Summary
The model named in tech-spec.md (`gemini-2.5-pro`, and `gemini-2.5-flash`) is refused for API keys created after Google's cutoff, even though the models still appear in the model list. On a free-tier key, the Pro models have a quota of 0. Both failures look like configuration errors in the UI, and the cause is only visible in Google's error message.

## Evidence (2026-10-05/06, the project's key)
- `GET /v1beta/models/gemini-2.5-flash` returned 200, and the model appears in `GET /v1beta/models`. But `generateContent` returned **404 NOT_FOUND**: "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash". The same happens with `gemini-2.5-pro`, where Google suggests `gemini-3.1-pro-preview`.
- `gemini-3.1-pro-preview` on the free tier returned **429 RESOURCE_EXHAUSTED** with a `QuotaFailure`. The metrics were `generate_content_free_tier_requests` and `generate_content_free_tier_input_token_count`, both with **limit: 0**, quota ID `...PerModelPerDay-FreeTier`. "Retry in 1h31m" is only the daily reset time; the limit stays 0.
- `gemini-3.8-flash` on the free tier completed a full evaluation: upload, processing, scoring and delete. It accepted `thinkingConfig.thinkingBudget` and `responseJsonSchema`. It used about 10k tokens for a 2-minute static video and returned two transient 429 "busy" errors, which the retry policy absorbed.

## First real baseline (`gemini-3.8-flash`, free tier, 2026-10-06)

| Video | Length | Size | Input tokens | Output | Thinking | Upload | Processing | Scoring | Repair |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Pitch-deck makeover (real submission-style video) | 104 s | 9.6 MB | 10,558 | 367 | 703 | 4.5 s | 7.1 s | 44.0 s | no |

- **Token use**: about 100 input tokens per second of video, including about 3k tokens of prompt and rubric. That is roughly 4× lower than the planning estimate in agent-design.md section 10 (about 290 per second, based on 2.5-era figures). A 3-minute video should need about 20k tokens.
- **Time**: scoring dominates (44 of 58 s). A batch of 50 three-minute videos run one at a time would take roughly 1 hour. This is an estimate, to be confirmed in S-2.
- **Result**: the score (1.25 overall) matched the content, a slide-deck video with no working product shown.

## Free-tier limits, overload and billing (2026-10-06/07)

- **Free-tier daily cap**: 429 with quota ID `GenerateRequestsPerDayPerProjectPerModel-FreeTier`, **limit 20**, model `gemini-3.8-flash`. `retryDelay` gave the time to the daily reset (about 10 h at the time). **Every retry and every repair turn counts as a request.** The cap is per model, so other models have separate counters.
- **Overload (503 "high demand")** lasted 15+ minutes and, at its peak, hit **every model the key could use**: 3.5/3.6/3.7/3.8 Flash, `gemini-flash-latest` and `gemini-3.1-pro-preview`. Switching models does not help in that state. One request also got no response within 5 minutes before the 503s started.
- **Prepaying $7** removed the 429 daily cap within minutes, but not the 503s. Paying raises limits, not available capacity.
- **Billing**: requests refused with an error are not processed, so no tokens are billed. A request DemoDay abandons after its 5-minute deadline may still be processed and billed on Google's side.
- **Response header** `x-gemini-service-tier: standard` was present both before and after prepaying.
- **Key format**: the project's Gemini key starts with `AQ.` (53 characters), not the classic `AIza…`. Code that recognises keys by the `AIza` prefix misses it. The upstream-message redaction in `src/server/agent/errors.ts` and `src/server/drive/errors.ts` has this gap; low risk, because Google error texts do not echo keys and the logger redacts key-named fields.

### Second baseline (batch run, 2026-10-06 22:24 UTC)

| Video | Length | Size | Input | Output | Thinking | Upload | Processing | Scoring |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Airbnb pitch-deck makeover (via Drive batch) | 104 s | 9.6 MB | 10,562 | 357 | 589 | 3.2 s | 7.3 s | 14.1 s |

Same video as the first baseline: tokens are stable (about 11.5k), and scoring time varies with load (44 s → 14 s).

## Overload behaviour seen on 2026-10-07

- **Requests held, not refused.** A tiny text request got 503 within about 1 s, but **video scoring requests were held open with no reply** until DemoDay's 300 s deadline, three times in a row. The deadline is now 120 s, with 3 attempts (ADR-011).
- **Vertex as a workaround.** At the same time, the same model on **Vertex AI (`global`)** answered in about 2 s (knowledge/gemini/providers-and-routes.md).

## Score variation (same video, same model)

| Run | Route | WS | AI | UX | Overall |
| --- | --- | --- | --- | --- | --- |
| 2026-10-06 | AI Studio | 1 | 1 | 2 | 1.25 |
| 2026-10-07 | Vertex | 2 | 2 | 3 | 2.25 |

The remarks agreed on the substance (slideware, no AI), but each category moved by one point at temperature 0.2. Treat single-run scores as approximate until the golden set (agent-design.md section 13) measures spread. Self-consistency (median of 3 runs) is the documented next step if the spread stays at 1 point.

## Evidence output (version 2) on the real model (2026-10-07, Vertex)

The Airbnb slideware video (1:44) returned valid observations and flags on the first attempt, with no repair turn and 12,862 tokens (versus about 12,400 for version 1):
- seven observations, all `claimed`, at sensible times across context, demo and value;
- flags: no working demo, audio missing (music, no narration), impact claimed without explanation;
- remarks cited the timestamps.

The evidence-first schema order (observations before categories) adds about 4% tokens.

## Diagnostics that worked (and one that did not)

- **Use Node, not the shell, to call the API.** In this environment, sourcing `.env.local` into the shell (`set -a; . ./.env.local`) failed, and curl calls to `generativelanguage.googleapis.com` intermittently returned an empty `text/html` 404 within about 25 ms, which is not a real API answer. A small Node script using `process.loadEnvFile(".env.local")` and `fetch` gave reliable results. Print `error.details[]` (QuotaFailure `quotaId`/`quotaValue`, RetryInfo `retryDelay`) and the `x-gemini-service-tier` header.
- **Read the logs first**: `data/logs/<UTC date>.jsonl` (`job.failed`, `team.failed`, `agent.retry` events). The `detail` field shows the first 300 characters of Google's message.

## Lesson / guidance
- **Check the model with a real `generateContent` call**, not the model list or a model GET.
- **Diagnose from the server log**: `grep job.failed data/logs/*.jsonl`. The `detail` field carries Google's message (first 300 characters). For the full quota breakdown, send one tiny text request with curl and read `error.details[].violations`.
- **A 429 has two meanings**:
  - a transient rate limit, which is retryable;
  - an exhausted daily quota, especially `limit: 0`, which retrying cannot fix.

  DemoDay currently retries both, and shows "AI service unavailable, retry later" for both. Improving this is a proposed follow-up.
- **Choosing a model**: a free-tier key needs a Flash model (`gemini-3.8-flash` verified). Pro needs billing enabled on the key's project.
- **For real events, enable billing.** 20 requests a day cannot cover a batch, and overload retries use the same budget.
- **When everything returns 503**, wait, then reopen the batch (ADR-007). Check one video with `make judge` before re-running a large batch.
- **Several `next dev` processes** keep running on other ports with stale settings. `pkill -f "next dev"` before restarting after changing `.env.local`.

## Links
- specs/tech-spec.md: default changed to `gemini-3.8-flash` on 2026-10-06
- specs/agent/agent-design.md sections 8–9
