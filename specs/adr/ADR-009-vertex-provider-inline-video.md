# ADR-009: Vertex AI as an optional scoring provider, with inline video and the global endpoint

## Status
Accepted

## Context
Google AI Studio (the Gemini API) was overloaded repeatedly on 2026-10-06/07: 503 errors, and requests held without a reply. The organizer created a Google Cloud service account (project `demoday-510812`) and asked to score through Vertex AI instead. Findings on 2026-10-07 with that account:
- `gemini-3.8-flash` answered within about 2 s on the **`global`** endpoint while AI Studio was overloaded. It is **not** offered in `us-central1` (404).
- The account has **no Cloud Storage permission** (`storage.buckets.list` denied), so videos cannot go through a bucket yet.
- **Inline video** (base64 `inlineData`) was accepted at 9.2 MB (real upload), 20, 40 and 90 MB.

## Decision
- **Provider setting.** `AI_PROVIDER=gemini|vertex` (default `gemini`). The Vertex provider implements the existing `VideoJudgeProvider` interface; prompts, schema, scoring and UI are unchanged.
- **Sign-in.** A service-account key file referenced by `VERTEX_SERVICE_ACCOUNT_FILE`, kept outside the project. JWT bearer grant, signed with Node `crypto` (no Google SDK, consistent with ADR-004). The token is cached per process and refreshed 5 min before expiry.
- **Endpoint.** `VERTEX_LOCATION` defaults to `global`.
- **Video transport.** Inline up to `VERTEX_INLINE_MAX_MB` (default 80, under the 90 MB measured). Larger videos fail with `VIDEO_TOO_LARGE` before any request is sent.
- **Video length.** Read from the container header (MP4/MOV `mvhd`, fragmented-MP4 `moof` timing, WebM `Duration`), because Vertex has no Files API metadata. The 3:00 flag stays computed in code (ADR-003).
- **Provenance** records `provider: "vertex"`.

## Rationale
- **Inline transport**: Cloud Storage would remove the size cap but needs extra IAM roles and a bucket the organizer does not have today. Inline covers typical hackathon exports (the test pitch was 9.2 MB for 1:44).
- **A setting, not automatic fallback** between providers: keeps scores attributable to one route, and avoids silent switching (ADR-008).
- **The tech-spec rule against base64 video** exists because of payload limits. Here the limit is measured, and enforced with a clear message.

## Consequences
- Videos above 80 MB cannot be scored on Vertex until a bucket path is added (Storage Object Admin on a bucket plus a `VERTEX_GCS_BUCKET` setting). Switching `AI_PROVIDER=gemini` scores them through AI Studio.
- Inline requests hold the base64 video in memory (about 1.33× the file size) during scoring.
- **Same video, same model, two runs:** 1.25 (AI Studio, 2026-10-06) and 2.25 (Vertex, 2026-10-07). Run-to-run variation must be measured with the golden set (agent-design.md section 13) before relying on single-run scores.

## Date
2026-10-07
