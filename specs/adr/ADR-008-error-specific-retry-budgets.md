# ADR-008: Retry budgets depend on the error; 503 overload waits longer

## Status
Accepted

## Context
On 2026-10-06 Gemini returned 503 UNAVAILABLE ("model is currently experiencing high demand") for minutes at a time, for every model the key could use. The original policy (4 attempts, about 14 s of backoff) failed teams that would have succeeded a few minutes later. In one run, the next team scored about 30 s after the previous one gave up. Every retry is a billed-or-quota-counted request, and the free tier allowed 20 requests per day per model.

## Decision
- `generateContent` chooses its retry policy from the latest error:
  - **503**: 6 attempts with 5, 10, 20, 40 and 80 s waits (about 2.6 min plus jitter); `Retry-After` honoured up to 90 s.
  - **Other retryable errors** (network errors, 429 rate limits, 500, 502, 504): 4 attempts with 2, 4 and 8 s waits.
- Rejected requests (400, 401, 403) are never retried.
- During waits the row shows "AI service busy · attempt n of max".
- Waits beyond that budget are handled by the judge reopening the batch (ADR-007), not by longer automatic waiting.

## Rationale
Alternatives considered:
- **Fall back to another model on 503.** Rejected: on the day of the outage every model returned 503, and a silent model swap makes scores less comparable.
- **Unlimited or much longer waiting.** Rejected: it blocks the sequential batch, and each attempt consumes quota.
- **Keep one policy for all errors.** Rejected: too short for overload, wasteful for other errors.

## Consequences
- On the free tier, an overload can burn up to 6 of the 20 daily requests for one team. Billing is needed for real events (knowledge/gemini/model-availability-and-quotas.md).
- **Open follow-up**: a daily-quota 429 (`...PerDay...` quota IDs) is currently treated as a rate limit and retried. It should fail at once with a "quota used up" message and not be re-queued until the reset.

## Date
2026-10-07
