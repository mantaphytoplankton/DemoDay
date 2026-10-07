# Tech stack & dependencies
Shared across projects. Copy secrets into `.env.local` only --- never commit real key values or `.env.local`. Product behavior belongs in each project's requirements doc, not here.
## Stack
| Category | Tech | Version |
| --- | --- | --- |
| Framework | Next.js (App Router) | 16.2.11 |
| UI / language | React · TypeScript | 19.2.4 · 5.9.3 |
| Styles | Tailwind CSS | 4.3.1 |
| State / forms | React Query · Zustand · RHF + Zod + `@hookform/resolvers` | 5.101.1 · 5.0.14 · 7.80.0 + 4.4.3 + latest |
| Storage | Local JSON (`data/`) --- no DB (stores batch checkpoints, scores, and `rubric.md`) | --- |
| AI | Google Gemini Files + Multimodal API (primary for native video+audio) · optional `openai` SDK → DashScope (Qwen-VL/Omni) | 6.39.0 |
| Test | Vitest · RTL · Playwright | 4.1.9 · 16.3.2 · 1.61.1 |

## 3rd party capabilities and API
### Multimodal Video LLM capability: Gemini Files & GenerateContent API (or DashScope Qwen-Omni)
- API Configuration
  - Model-name=`gemini-3.8-flash` (default; works on the free tier). For higher quality use `gemini-3.1-pro-preview`, which needs billing enabled (free-tier quota is 0). The 2.5 models are refused for new API keys; see `specs/knowledge/gemini/model-availability-and-quotas.md`
  - Host=`generativelanguage.googleapis.com`
  - API-Key=`GEMINI_API_KEY`
  - Base_URL=`https://generativelanguage.googleapis.com/v1beta`
- Technical highlights
  - **Upload Endpoint (`upload/v1beta/files`):** Upload the ~3-minute video file via resumable upload protocol (supports up to 2GB per file; stored transiently for 48 hours).
  - **File State Polling (`GET /v1beta/files/{name}`):** Poll until video state transitions from `PROCESSING` to `ACTIVE` before invoking inference.
  - **Inference Endpoint (`POST /v1beta/models/{model}:generateContent`):** Pass the `file_uri`, the dynamically read `rubric.md`, and `responseMimeType: "application/json"` (structured output matching the Zod scorecard schema).
  - **Cleanup (`DELETE /v1beta/files/{name}`):** Delete the remote file from the LLM Files API after evaluation completes to stay well within the 20GB project storage cap.
  - On failure: return error to caller for component error + persist failed/pending state in `data/` so batch mode can resume --- never silent empty success.
  - Product behavior: see project requirements doc.

### Google Drive capability: Drive REST API v3 (Batch Folder & Video Retrieval)
- API Configuration
  - Service=`Google Drive API v3`
  - Host=`www.googleapis.com`
  - API-Key=`GOOGLE_DRIVE_API_KEY` (for link-shared hackathon folders) or `GOOGLE_SERVICE_ACCOUNT_JSON` (for restricted folders)
  - Base_URL=`https://www.googleapis.com/drive/v3`
- Technical highlights
  - **Zero extra SDK needed:** Call directly from Next.js server routes using native `fetch()`.
  - **Parse Folder ID:** Extract the root `folderId` from the user-provided Google Drive folder URL.
  - **List Team Subfolders (`GET /files`):** Query `q='<rootFolderId>' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false` with `fields=files(id,name)` to build the sequential team queue.
  - **Locate Team Video (`GET /files`):** For each subfolder, query `q='<teamFolderId>' in parents and mimeType contains 'video/' and trashed=false` with `fields=files(id,name,mimeType,size)`.
  - **Stream Video Content (`GET /files/{fileId}?alt=media`):** Stream the video binary on the server directly to a temporary buffer/file to forward to the Multimodal LLM Files API.
  - Do **not** expose `GOOGLE_DRIVE_API_KEY` to the client (`no NEXT_PUBLIC_*`).
  - On failure (e.g., empty subfolder, permission denied, corrupted file): record team row status as `Failed` with reason in `data/` and continue batch queue or allow resume --- one bad subfolder must not crash the app.
  - Product behavior: see project requirements doc.

## Environment
Copy keys into `.env.local` (gitignored; do not commit). Do not hardcode in source.
```env
# Multimodal Video LLM
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
# Optional fallback if using DashScope / OpenAI-compatible multimodal
DASHSCOPE_API_KEY=
OPENAI_API_KEY=
OPENAI_BASE_URL=[https://api.openai.com/v1](https://api.openai.com/v1)

# Google Drive API v3 (Batch folder traversal & media download)
GOOGLE_DRIVE_API_KEY=
# Optional: only if Drive folders are private rather than "Anyone with link"
GOOGLE_SERVICE_ACCOUNT_JSON=

# Auth (session cookie signing — see specs/app/app-design.md)
SESSION_SECRET=
```
## Performance
**Latency (all components --- one contract only):**
- Soft tip: after ~**10s**, show "more time is needed" while work continues (never the word "Timeout")
- Target: UI views, cached tables, and Google Drive folder scans ready within **≤20s**; for ~3-minute video evaluations, emit active step progress (`Uploading` → `Processing Video` → `Scoring`) within **≤20s** per step
- Do **not** implement a separate conflicting 10s hard timeout that abandons the video evaluation or batch queue early without a user-visible state

**Loading & batch strategy (all components):**
- Show stored team scores and cached batch progress from `data/` **immediately** while remaining videos are queued and judged
- Process batch Google Drive subfolders **sequentially** (one video at a time) to avoid upstream rate limits and memory spikes, streaming each completed team row to the UI table as soon as its evaluation finishes
- Show **per-component and per-team** status tips (`Pending`, `Downloading`, `Processing Video`, `Scoring`, `Completed`, `Failed`) while work is pending

**Resumability & fallbacks:**
- Checkpoint batch progress to `data/` immediately after each team subfolder completes so interrupted runs resume cleanly from the exact subfolder where they stopped
- Isolate individual subfolder or video failures: log the error state on that team's row and continue to the next team folder rather than halting the entire batch
- Do **not** silently swap to a dummy/fallback score on LLM failure --- always surface the failed status so the judge can trigger a retry or resume

## Implementation pitfalls (must follow)
Cross-check when implementing against the project requirements doc:
| Area | Contract |
| --- | --- |
| **Video LLM Upload** | Do not base64-inline ~3-minute videos into JSON request bodies (exceeds payload limits); always upload via the Multimodal Files API first, poll until state is `ACTIVE`, then run inference |
| **Remote File Cleanup** | Delete the uploaded video from the LLM Files API after scoring completes to avoid hitting project storage quotas during large batch runs |
| **Structured Output** | Enforce JSON schema output (category scores, category remarks, overall score, overall comments) and validate with Zod before writing to `data/` |
| **Externalized Prompts** | Read the agent system prompt and judging rubric (`rubric.md`) dynamically from version-controlled `.md` files --- never hardcode rubric text in TypeScript routes |
| **Google Drive API** | Server-side `GOOGLE_DRIVE_API_KEY` only --- no `NEXT_PUBLIC_*`; always include `supportsAllDrives=true&includeItemsFromAllDrives=true` on `/files` queries so Shared Drives resolve properly |
| **Batch Resumability** | Write completed team evaluations to `data/` after every single video; check `data/` by subfolder ID before downloading/judging so resumed runs never re-bill or re-judge completed teams |
| **CSV Export** | Properly escape double quotes, commas, and multi-line remarks in CSV cells (RFC 4180) so detailed AI comments do not break spreadsheet column alignment |
| **Latency** | Soft tip ~10s ("more time is needed") · never map a server cut-off to the word "Timeout" --- **one contract only** (see Performance --- all components) |
| **Secrets** | Env vars only in `.env.local` --- never commit real keys in specs or repo |