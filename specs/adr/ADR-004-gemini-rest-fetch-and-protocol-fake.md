# ADR-004: Call Gemini over REST with native fetch; test against a protocol-level fake

## Status
Accepted

## Context
tech-spec pins no Google SDK and prefers zero extra SDKs. Tests must not bill or need a key by default. The common test strategy prefers fixtures over mocks inside production code paths.

## Decision
- `GeminiProvider` implements the Files API (resumable upload, query offset, get, delete) and `generateContent` with native `fetch`, behind a `VideoJudgeProvider` interface. The key goes only in the `x-goog-api-key` header.
- Tests and E2E use `FakeGemini`, an in-process fake of the same HTTP contract. Scenarios are selected by ASCII markers in the uploaded bytes. It is enabled with `JUDGE_UPSTREAM=fixture`, refused when `NODE_ENV=production`, and labels every output "Fixture output".
- A schema-keyword fallback (`responseJsonSchema` → `responseSchema`) is built in.

## Rationale
- No dependency, full control over retries, upload resume and the request deadline.
- A protocol fake exercises the real provider code: headers, resumable upload, polling. Function-level mocks would skip all of that.

## Consequences
- The fake reflects the documented API, not recorded traffic. The first live run (2026-10-05) confirmed the request shape works with `gemini-3.8-flash`. Replacing the fake's responses with recorded ones remains a follow-up.
- Upstream API changes surface only in live runs: `make judge` is the live check.

## Date
2026-10-05
