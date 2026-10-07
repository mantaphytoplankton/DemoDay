---
title: Test gotchas in this stack (Next 16, React 19, TanStack Query 5, Tailwind 4, Node 24)
type: ops-lesson
status: active
as_of: 2026-10-07
tags:
  - testing
  - vitest
  - playwright
  - react-query
related_spec: specs/app/app-design.md
related:
  - adr/ADR-005-node-native-ts-and-server-boundary.md
  - knowledge/testing/e2e-stalls-macos-sleep.md
---

# Test gotchas in this stack

## Summary
Issues that cost time during S-1, and the fix for each. Two of them were real product defects that the tests exposed.

## Evidence and fixes

| Symptom | Cause | Fix |
| --- | --- | --- |
| Assertion right after `queryClient.setQueryData` fails in RTL | TanStack Query notifies subscribers on `setTimeout(0)` | `await waitFor(...)` or `findBy*` after pushing data |
| UI briefly shows an older step (**product defect**) | An initial `useQuery` fetch resolved after a newer server-sent event and overwrote it | Fetch only after falling back to polling; the SSE snapshot on connect supplies the initial state (`useEvaluation`) |
| Test hangs for many minutes with `vi.useFakeTimers()` | Faking `setTimeout` also freezes Testing Library's waits | Fake only the clock: `vi.useFakeTimers({ toFake: ["Date"] })` plus `vi.setSystemTime` |
| `getByRole("alert")` matches 2 elements in Playwright | Next.js adds a hidden `role="alert"` route announcer | Target the field's own error element |
| Accessible name reads "Show remarksfor Working Solution" (**product defect**) | Leading space in screen-reader-only text is dropped by the name calculation | Explicit `aria-label` that starts with the visible text (WCAG 2.5.3) |
| Links lost underlines (colour-only distinction, WCAG 1.4.1) | Tailwind 4 preflight sets `a { text-decoration: inherit }` | Set `text-decoration: underline` on `a` in globals.css |
| `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` when running scripts | Node type stripping rejects parameter properties | Declare fields explicitly; keep `erasableSyntaxOnly` on and run `tsc` first |
| Video duration probe never resolves in jsdom | jsdom has no media pipeline | Stub `HTMLMediaElement.prototype.src` so it fires `error` |
| Unshared Drive folder returned HTTP 500 under `next dev` (**product defect**, S-2) | The startup hook (`instrumentation.ts`) and the route handlers load separate copies of the same modules. A `DriveError` thrown by the client created at startup (shared on `globalThis`) failed `instanceof DriveError` in the route. Vitest loads one module graph, so only the browser test caught it | Check errors that cross from the shared app context into routes by name and fields (`isDriveError`); keep `instanceof` only where creator and checker share a module graph |
| "Hydration failed because the server rendered text didn't match the client" (**product defect**, S-3) | Client components formatted dates with `toLocaleString` during server rendering. The Node server and a browser in another time zone or locale render different text. Only visible when the two differ, so the default test browser missed it | `LocalTime`: render fixed UTC text on the server and during hydration, switch to local time after (`useHydrated` via `useSyncExternalStore`). E2E now runs one spec with `timezoneId: "America/Los_Angeles"`, `locale: "en-GB"` and fails on any hydration error |
| Latent hydration mismatches | `localStorage` read when a Zustand store is created; `Date.now()` in `useState` initialisers used in rendered output | Read storage in an effect after mount; keep the clock `null` until mounted |
| Modal dialogs appeared at the top-left instead of centred (S-4) | Tailwind 4's base reset removes the browser's `margin: auto` on `<dialog>`; it affected the S-1 shortcuts dialog unnoticed | `dialog[open] { margin: auto; }` in globals.css |
| React lint "Cannot access refs during render" on a form | Calling RHF `handleSubmit(fn)` during render, where `fn` closes the dialog through a ref | Call it in the event: `onSubmit={(e) => void handleSubmit(onValid)(e)}` |
| An E2E check broke when the stand-in model gained a field (S-4) | The Gemini stand-in started setting a flag on every video, so "no flags" assertions failed | Assert on the specific element (`.flag` with text "Exceeds"), not a total count; update the stand-in together with the output schema |
| Static test fakes leak between tests | Class-level `current` instance kept from the previous test | Reset static state in `beforeEach` |
| React lint: `set-state-in-effect`, impure `Date.now()` in render | React 19 compiler lint rules | Derive values (for example the live-region text) instead of storing them; use state for clock ticks |

## Dev-environment lessons (S-3)

- **`pkill -f "next dev"` in test scripts also kills the user's own dev server.** It happened during an S-3 test run.
- **Next 16 allows one `next dev` per build folder** ("Another next dev server is already running"). E2E now sets `NEXT_DIST_DIR=.next-e2e` (`next.config.ts` reads it), so tests run beside the developer's server with no need to stop it.
- **Ctrl+Z suspends `make dev`** (state `T`) instead of stopping it. Suspended servers ignore SIGTERM and pile up; two were found 38 h old. Stop with Ctrl+C; clean up with `kill -CONT <pid>; kill <pid>`.
- **Changing `.env.local` needs a server restart.** Settings, providers and token sources are created once per process.

## Process lesson: UI wording drifted from the acceptance criteria for three sprints

SNG-03 (S-1) and JDG-06 required the flag text "Exceeds 3-minute maximum". The UI followed the UI guideline's shorter "Over 3:00 (3:24)", and the tests were written against the UI, so the mismatch went unnoticed until S-4 re-read the stories. **Write E2E and component assertions using the exact text from the acceptance criteria.** When a design document proposes different wording, update the story or record the choice; don't let the two diverge silently.

## Lesson / guidance
Push data, then await the rendered result. Fake as little as possible: only the clock, or only the browser boundary (XHR, EventSource). Keep the server's event stream as the single source of live state.

## Links
- tests/unit/evaluate-client.test.tsx
- specs/app/app-design.md section 15
