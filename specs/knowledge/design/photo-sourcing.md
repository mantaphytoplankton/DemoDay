---
title: Sourcing openly licensed stock photos from the command line
type: ops-lesson
status: active
as_of: 2026-10-05
tags:
  - design
  - licensing
related_spec: specs/ui-guideline.md
related: []
---

# Sourcing openly licensed stock photos from the command line

## Summary
Unsplash's search endpoint is not usable from scripts. Openverse plus Wikimedia Commons works without a key and returns real hackathon photos with machine-readable licences.

## Evidence
- `unsplash.com/napi/search/photos` returned a non-JSON response to curl.
- `https://api.openverse.org/v1/images/?q=hackathon&license=cc0,pdm,by,by-sa&aspect_ratio=wide&size=large` returned Wikimedia Commons results, CC0 and CC BY / BY-SA.
- Download at a chosen width: `https://commons.wikimedia.org/wiki/Special:FilePath/<File_name>?width=1800`. Send a descriptive User-Agent, and percent-encode file names; names with commas or non-ASCII characters returned HTML until encoded.
- Author and licence: `commons.wikimedia.org/w/api.php?action=query&titles=File:<name>&prop=imageinfo&iiprop=extmetadata&format=json` (`Artist`, `LicenseShortName`, `LicenseUrl`).

## Lesson / guidance
- **Review candidates on a contact sheet**: render the photos with Playwright from a local HTML file (`page.goto("file://…")`; `setContent` cannot load `file://` images).
- **Credit every non-CC0 photo** on the page that uses it, and note any colour treatment (ui-guideline.md section 2.2).
- **Before a public launch**, consider imagery without identifiable people or event branding.

## Links
- specs/ui-guideline.md section 2.2
- specs/prototype/README.md
