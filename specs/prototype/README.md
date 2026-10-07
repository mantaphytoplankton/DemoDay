# DemoDay S-1 prototype

A clickable HTML prototype of S-1, single video upload and rubric scorecard ([stories.md](../stories.md#sprint-plan)). It follows [ui-guideline.md](../ui-guideline.md) and needs no build step.

## Run

```sh
make prototype        # serves http://localhost:4100
```

You can also open `index.html` directly in a browser.

## Pages

| Page | Stories | Shows |
| --- | --- | --- |
| `index.html` | --- | Page index, and which parts are real and which are simulated |
| `evaluate.html` | SNG-01, SNG-02, SNG-03 | Upload with file checks, live steps, the 10s tip, failure reasons, scorecard, recent evaluations |
| `result.html?id=…` | SNG-03 | A stored evaluation reopened after a reload. Also covers the failed and not-found states |
| `rubric.html` | JDG-01 | Active rubric, weights, tiers and version. Covers the default-rubric and invalid-configuration states |

## Prototype controls

The dashed panel at the bottom left is not product UI. It selects the simulated outcome:

- **Evaluation outcome**:
  - Normal
  - Slow processing (shows the tip)
  - Video could not be processed
  - AI service unavailable
  - Incomplete scorecard
- **Rubric file**:
  - Default rubric
  - Malformed rubric (evaluations fail with "Rubric configuration invalid")
- **Clear stored evaluations**

## Real and simulated behavior

- **Real**: file type, size and content checks; video length measured in the browser and the over-3:00 flag; rubric parsing, validation and version hash; the weighted overall score.
- **Simulated**: upload, video processing and AI scoring, and their timing. The scorecard text is sample output, the same for every video.
- **Storage**: evaluations are kept in browser storage, standing in for `data/evaluations/`.

## Brand and photos

- **Logo**: `assets/logo.svg`, a play button made of the five score-colour bars.
- **Banner rules**: see [ui-guideline.md section 2.2](../ui-guideline.md).
- **Photos**: openly licensed images from Wikimedia Commons, credited at the bottom of each page that uses one.

| File | Author | Licence | Source |
| --- | --- | --- | --- |
| `assets/img/hero-pitch.jpg` | Asaidlo | CC0 1.0 | [Wikimedia Hackathon 2024 10](https://commons.wikimedia.org/wiki/File:Wikimedia_Hackathon_2024_10.jpg) |
| `assets/img/teams-building.jpg` | Tulipasylvestris | CC BY 4.0 | [Hackathon participants at Wikimania 2024](https://commons.wikimedia.org/wiki/File:Hackathon_participants_at_Wikimania_2024.jpg) |
| `assets/img/demo-room.jpg` | SSethi (WMF) | CC BY-SA 4.0 | [Day2 Indic Wikimania Hackathon 2022 10](https://commons.wikimedia.org/wiki/File:Day2_Indic_Wikimania_Hackathon_2022_10.jpg) |

## Test files

`test-videos/` has a 2:00 video (`team-alpha.webm`), a 3:24 video (`team-long.webm`, which triggers the length flag) and a non-video file named `.mp4` (`fake.mp4`).

## Keyboard

- `?`: shortcut list.
- `E`: show or hide all remarks on a scorecard.
- `Esc`: close dialogs.
- The single-key shortcuts can be turned off in the shortcut list.
