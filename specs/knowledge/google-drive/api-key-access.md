---
title: Google Drive access with an API key (setup and failure modes)
type: ops-lesson
status: active
as_of: 2026-10-07
tags:
  - google-drive
  - configuration
related_spec: specs/app/app-design.md
related:
  - adr/ADR-007-batch-identity-and-reopen.md
  - knowledge/gemini/model-availability-and-quotas.md
---

# Google Drive access with an API key

## Summary
DemoDay reads batch folders with a plain Google API key, which only works for files shared as "Anyone with the link". The common setup mistake is creating a service account and pasting its JSON key into `.env.local`. The first real batch run (2026-10-06) listed folders, downloaded videos and handled a team folder without a video correctly.

## Evidence
- **Wrong credential**: the user downloaded a service-account JSON key and pasted it into `GOOGLE_DRIVE_API_KEY`. Env files are one value per line, so the variable became `{`, and 12 lines of JSON, including a private key, were left as stray lines in `.env.local`. They also broke `. ./.env.local` in the shell.
- **Correct setup**:
  1. In the same Google Cloud project, enable **Google Drive API**.
  2. *Credentials → Create credentials → API key*. Optionally restrict it to the Google Drive API.
  3. Put it on one line: `GOOGLE_DRIVE_API_KEY=…`, then restart the server.
- **The folder link is not configuration.** Judges paste it on the Batches page, and each folder becomes its own batch (ADR-007).
- **API-key access requires link sharing.** An unshared file or folder returns **404 notFound**, not 403. Drive reports rate limits as **403** with reason `rateLimitExceeded` / `userRateLimitExceeded`, so the reason decides whether to retry (app-design.md section 8.5).
- **Shared Drives** need `supportsAllDrives=true&includeItemsFromAllDrives=true` on every `/files` listing. The test fake rejects listings without them.

## Lesson / guidance
- **When batch setup fails, check in order**: the key format (one line; not JSON), whether the Drive API is enabled in the project, whether the parent folder is shared as "Anyone with the link", then the logs (`batch.rejected`, `team.failed`).
- **Service-account access** (private folders) is designed (app-design.md section 8.6) but not built. It needs its own story. If someone created a service-account key by mistake, delete it in *IAM & Admin → Service Accounts → Keys*.

## Links
- specs/app/app-design.md section 8
- README.md "Batch evaluation"
