# ADR-011: One scoring request waits at most 2 minutes; unanswered requests get 3 attempts

## Status
Accepted (extends ADR-008)

## Context
On 2026-10-07, during a Gemini overload, video scoring requests were neither answered nor refused: Google held them open. With a 300 s per-request deadline and the 4-attempt policy, an evaluation sat at "Scoring" for about 20 minutes before failing, and looked frozen to the judge. Successful scoring has taken 14–44 s.

## Decision
- **Deadline.** `GEMINI_SCORING_TIMEOUT_S` (default 120) bounds each `generateContent` request, for both providers.
- **Retry policy.** A request that times out without a response uses `NO_RESPONSE_POLICY`: 3 attempts, with 5 s and 10 s waits between them. The worst case before a visible failure is about 6 minutes.
- **Other policies are unchanged.** 503 still gets the overload budget (ADR-008), other retryable errors 4 attempts.

## Rationale
- 120 s is about 3× the slowest successful scoring observed, which leaves room for longer videos and thinking.
- **Keeping 300 s or more** was rejected: it only lengthens a wait that, during an overload, rarely ends in success.
- **Much shorter (30–60 s)** was rejected: it risks cutting off legitimate long scorings.
- Bounded failure plus the Retry button (RSM-04) puts the judge back in control.

## Consequences
- A request that would have succeeded after more than 120 s now fails; the judge can retry, or raise the setting.
- An abandoned request may still be processed, and billed, on Google's side (knowledge/gemini note on billing).

## Date
2026-10-07
