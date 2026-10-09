# Knowledge Base

Reusable research conclusions, ops lessons, and domain notes (not code truth).
Product requirements live under `specs/`. Architecture decisions live under `specs/adr/`.

## Index

| Doc | Topic | Updated |
|-----|--------|---------|
| [gemini/model-availability-and-quotas.md](gemini/model-availability-and-quotas.md) | Retired models, free-tier caps, 503 overload and held requests, billing, baselines, score variation, evidence and transcript/summary output checks, diagnostics | 2026-10-09 |
| [testing/e2e-stalls-macos-sleep.md](testing/e2e-stalls-macos-sleep.md) | Playwright stalls caused by macOS sleep; watchdog diagnostic | 2026-10-06 |
| [testing/react-next-test-gotchas.md](testing/react-next-test-gotchas.md) | Next 16 / React 19 / TanStack Query / Tailwind 4 / Node 24 pitfalls: duplicate modules, hydration, dialogs, dev-server lock, AC-wording drift, stale cache after delete, a test passing for the wrong reason | 2026-10-09 |
| [design/photo-sourcing.md](design/photo-sourcing.md) | Openly licensed photos via Openverse and Wikimedia Commons | 2026-10-05 |
| [google-drive/api-key-access.md](google-drive/api-key-access.md) | Drive API key setup, service-account JSON mistake, sharing and error semantics | 2026-10-07 |
| [gemini/providers-and-routes.md](gemini/providers-and-routes.md) | AI Studio vs Vertex vs gateways for Gemini 3.8 Flash: price, video delivery, capacity, Vertex findings | 2026-10-07 |
| [gemini/structured-output-limits.md](gemini/structured-output-limits.md) | Vertex AI rejects complex response schemas (maxItems on an array of objects) with a bare 400; probe results and guidance | 2026-10-09 |
| [video/container-duration.md](video/container-duration.md) | Reading video length from MP4, fragmented MP4 and WebM headers; real-file pitfall | 2026-10-07 |
