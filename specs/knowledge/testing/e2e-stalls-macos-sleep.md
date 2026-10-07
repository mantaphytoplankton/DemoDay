---
title: E2E stalls were macOS system sleep, not an app defect
type: ops-lesson
status: active
as_of: 2026-10-06
tags:
  - playwright
  - e2e
  - macos
related_spec: specs/app/app-design.md
related:
  - knowledge/testing/react-next-test-gotchas.md
---

# E2E stalls were macOS system sleep, not an app defect

## Summary
Unattended Playwright runs stalled several times for 15–19 minutes. A random test froze mid-evaluation, and teardown hung. The cause was the Mac entering system sleep, including "Back to Sleep" after a dark wake. Every run that was not interrupted passed.

## Evidence
- The stalls lasted 16.2, 15.7, 18.8 and about 16 minutes. The page snapshot showed the elapsed-seconds counter frozen at different steps in different tests.
- A watchdog `setInterval` in the test worker, which pinged the server every 5s, logged nothing between 145s and 1117s. The server answered in 37ms afterwards. When timers stop in every process while the server stays healthy, the whole machine was suspended.
- `pmset -g log` showed `Entering Sleep state ... 969 secs` at exactly the stall window, and later `Sleep Service Back to Sleep ... 249 secs`.
- Disproven along the way:
  - Next dev recompiles caused by Playwright writing into the repo (no "Compiling" lines in the logs).
  - The web server's stdout pipe filling up (Playwright drains it).
  - The in-browser video-length probe (stalls continued with it disabled).

## Lesson / guidance
- **When a run stalls for a suspiciously round time, check `pmset -g log | grep -E "Sleep|Wake"`** before debugging code.
- **Run E2E with `make e2e`**, which wraps `caffeinate -dims`. Even that cannot stop the OS re-sleeping after a dark wake (display off, unattended at night), so run long suites while the machine is in use, or on CI.
- **The diagnostic pattern is reusable**: a worker-side watchdog timer plus explicit `setDefaultTimeout` and `setDefaultNavigationTimeout`. Playwright actions and navigations have no time limit by default, so a hang otherwise surfaces only as the test timeout.

## Links
- Makefile `e2e` target
