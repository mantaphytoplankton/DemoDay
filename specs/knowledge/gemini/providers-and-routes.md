---
title: Routes to Gemini 3.8 Flash (AI Studio, Vertex AI, gateways)
type: research-note
status: active
as_of: 2026-10-07
tags:
  - gemini
  - vertex
  - providers
related_spec: specs/agent/agent-design.md
related:
  - adr/ADR-009-vertex-provider-inline-video.md
  - knowledge/gemini/model-availability-and-quotas.md
---

# Routes to Gemini 3.8 Flash

## Summary
The same model can be reached through Google AI Studio (API key and Files API), Vertex AI (service account; Cloud Storage or inline video), or third-party gateways (OpenRouter, Requesty). Token prices are essentially Google's on every route. What differs is capacity, how the video is delivered, and setup effort. On 2026-10-07 Vertex answered while AI Studio was overloaded, and DemoDay now supports both through `AI_PROVIDER`.

## Evidence
- **Price (Gemini 3.8 Flash):** $0.75 input / $3.75 output per 1M tokens, introductory until 2026-12-31, then $1.50 / $7.50 (PricePerToken, BenchLM). Requesty lists the same Vertex price, plus 5% pay-as-you-go or 0% with your own keys.
- **Vertex with the project's service account** (`demoday-510812`):
  - the JWT-bearer sign-in worked;
  - `gemini-3.8-flash` is served on the **`global`** endpoint (reply in about 2 s) and returns **404 in `us-central1`**;
  - inline `inlineData` video was accepted at 9.2, 20, 40 and 90 MB;
  - the account had **no Cloud Storage permission** (`storage.buckets.list` denied).
- **Vertex request format:** the body (`contents`, `systemInstruction`, `generationConfig` with `responseJsonSchema` and `thinkingConfig`) worked unchanged from the Gemini API. Only the URL, the sign-in and the video part differ.
- **OpenRouter video for Gemini:** only YouTube links (AI Studio route) or base64 data URLs (Vertex route); it does not take private file links. OpenRouter docs, "Video inputs".
- **OpenAI and Anthropic APIs:** no native video file input (frames plus separate audio only), so they are not a like-for-like alternative for judging narration and demo together.

## Lesson / guidance
| Situation | Route |
| --- | --- |
| First setup, small tests, no Google Cloud | AI Studio (`AI_PROVIDER=gemini`) |
| Live event, large batch, AI Studio overloaded | Vertex (`AI_PROVIDER=vertex`) |
| Video over 80 MB | AI Studio (up to 1 GB through the Files API), until a Vertex Cloud Storage path exists |
| Minimal setup and only small videos | A gateway; requires a new provider in DemoDay and a size cap |

- **Check a new route with one real call** (`make judge`). For Vertex, try `global` first.
- **Cloud Storage for Vertex** needs a bucket plus the *Storage Object Admin* role on it. The project doesn't have this today.
- **The service-account key file is a secret.** Keep it outside the repo (`~/.config/demoday/`, `chmod 600`), reference it by path only, and delete unused keys in IAM.

## Links
- [OpenRouter: video inputs](https://openrouter.ai/docs/features/multimodal/videos)
- [Requesty: Vertex gemini-3.8-flash](https://www.requesty.ai/models/vertex/gemini-3.8-flash)
- [PricePerToken: Gemini 3.8 Flash](https://pricepertoken.com/pricing-page/model/google-gemini-3.8-flash)
