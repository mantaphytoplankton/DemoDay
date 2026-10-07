---
title: Reading video length from MP4, fragmented MP4 and WebM headers
type: ops-lesson
status: active
as_of: 2026-10-07
tags:
  - video
  - mp4
  - webm
related_spec: specs/agent/agent-design.md
related:
  - adr/ADR-009-vertex-provider-inline-video.md
---

# Reading video length from container headers

## Summary
Vertex AI does not report a video's length, and DemoDay computes the 3:00 flag in code (ADR-003), so `src/server/agent/video-duration.ts` reads the length from the file. The user's real recording turned out to be a **fragmented MP4**, whose standard length fields are 0. A parser tested only with simple synthetic files would have returned 0 and silently skipped the over-length flag.

## Evidence
- **The real upload** (`Airbnb Pitch deck makeover…mp4`, 9.2 MB): `moov/mvhd` duration = 0, `mdhd` duration = 0, an `mvex/trex` box, then `moof` fragments with no `mehd` and no `sidx`. Gemini described it as 1:44. After adding fragment parsing, the reader returned **103.6 s**.
- **Formats handled:**

  | Format | Length is |
  | --- | --- |
  | Plain MP4/MOV | `mvhd` duration / timescale (version 0: 32-bit fields; version 1: 64-bit). `moov` may sit after `mdat` at the end of the file, so walk the top-level boxes rather than reading only the first bytes |
  | Fragmented MP4 | Per track: latest `tfdt.baseMediaDecodeTime` plus that fragment's sample durations (`trun` per-sample durations, else `tfhd` default, else `trex` default), divided by the track's `mdhd` timescale. Take the maximum across tracks |
  | WebM | `Segment/Info/Duration` (float, 4 or 8 bytes) × `TimecodeScale` (default 1,000,000 ns) |

- **Unreadable files** return null; the scorecard then shows no length flag instead of a wrong one, and the agent logs `agent.duration_unknown`.

## Lesson / guidance
- **Always test media parsers against a real file from the actual source.** Synthetic files hide the format variants that recorders produce: fragmented MP4 from screen and browser recorders, `moov` at the end from some exporters.
- **No ffprobe is needed** for length only; the header walk reads a few KB per fragment.

## Links
- tests/unit/video-duration.test.ts (synthetic plain, version-1 and fragmented MP4; real WebM fixtures)
