# DemoDay --- UI/UX Guideline

Status: Draft v1 · 2026-10-05
Related: [stories.md](stories.md) (behavior and copy in acceptance criteria), [architecture-design.md](architecture-design.md) (screens and routes, section 6).

## 1. Design intent

**Who**: a hackathon judge with dozens or hundreds of 3-minute pitch videos and limited time, usually on a laptop and often in a noisy venue.

**The single job of the UI**: help the judge reach a confident decision per team in the fewest looks, and see where the AI is unsure or the evidence is thin.

Principles, in priority order:

1. **Scan first, read on demand.** Scores, states and flags are readable at a glance. Remarks and evidence open only when asked.
2. **Show evidence, not just verdicts.** Every score can be traced to what was shown in the video. The UI separates *demonstrated* from *claimed*.
3. **Never hide state.** Every team and every evaluation always shows what is happening, what failed, and what the judge can do next.
4. **The human decides.** AI output is labelled as decision support. Overrides are first-class, and the AI score stays visible next to the final score.
5. **Keyboard-complete.** A judge can work through a whole batch without touching the mouse.

## 2. Visual direction

A night-shift control room for judging: deep navy and slate surfaces, quiet chrome, and colour reserved for meaning, namely scores, states and flags. The data is the brightest thing on screen.

**Signature element: the Evidence Strip.** A horizontal bar that represents the 3-minute pitch, divided into the BRD's expected flow: Context (0:00–0:20), Demo (0:20–2:20), Value (2:20–3:00). Observations sit on it as markers at their timestamps. A solid marker is *demonstrated*; a hollow ring is *claimed*. A hard vertical rule marks 3:00, and anything past it is hatched. A judge can see in one glance whether a team actually showed its demo or only talked about it. It is the only decorative-looking element in the product, and it carries data. Section 6.5 specifies it.

Kept deliberately quiet inside the working areas (tables, scorecards, forms):

- No gradients, glows or glassmorphism.
- No illustration.
- No motion except state changes (section 9).

The hackathon energy lives in a separate brand layer (section 2.2): the logo, page banners and photography. It stays out of the working areas.

### 2.1 Theme

Dark theme only for S-1 to S-4. All tokens are named by role, not by value, so a light theme can be added later without changing components.

### 2.2 Brand layer (hackathon feel)

| Element | Specification | Where |
| --- | --- | --- |
| **Logo** | A play button built from five vertical bars, tallest to shortest, coloured `--score-5` down to `--score-1`. It reads as "demo" and "score" at once. Wordmark "DemoDay" in Bricolage Grotesque 600 at 90% width. Source: `specs/prototype/assets/logo.svg` (32×32 grid). Minimum size 16px. The mark stays in the score colours; never recolour it | Top bar (22px), page banners (40px) |
| **Spectrum** | `linear-gradient(90deg, score-1 → score-5)`. The only gradient in the product | Logo; 6px underline under the key phrase of a banner headline |
| **Page banner** | A photo in greyscale with a violet duotone (`#4B3A9E`, blend mode `color`), fading into `--surface-1` behind the text. Headline in Bricolage Grotesque, 52px desktop / 38px phone, −0.035em tracking. On phones the photo becomes a 200px band at the top | Evaluate (full), Rubric (compact), Index |
| **Rubric stickers** | Rubric categories as laptop-style stickers: `--text-primary` fill, ink text, mono weight, rotated −2.5° to +1.5°. Generated from the rubric file, never hardcoded | Evaluate banner |
| **Pitch clock** | Mono 44px clock showing the 3:00 limit. After upload it shows the video's measured length "2:00 / 3:00": `--state-done` within the limit, `--state-failed` with a coral border when over. Always has a text note ("Within the 3:00 limit" / "Over the 3:00 limit, will be flagged") | Evaluate banner |
| **Dot grid** | 1px dots every 22px at 10% `--state-pending` on `--surface-bg`. Decorative only | Page background |
| **Logo motion** | Bars rise once on page load (520ms, 70ms stagger). None under reduced motion | Logo only |

Photography rules:

- Use real hackathon scenes: pitches on stage, teams at laptops, rooms watching a demo. No generic office or handshake stock.
- Only use openly licensed photos (CC0, CC BY, CC BY-SA). Credit author, title and licence on the page that uses the photo, and note the colour treatment.
- Always apply the banner treatment, so photos never compete with the data colours.
- Text never sits on an untreated photo area. The fade guarantees `--surface-1`-level contrast behind all banner text.
- Give the photo an `aria-label` describing the scene. Photos are supporting, never the only carrier of information.

Current photos (in `specs/prototype/assets/img/`, from Wikimedia Commons):

| File | Scene | Author | Licence |
| --- | --- | --- | --- |
| `hero-pitch.jpg` | Team pitching on a hackathon stage | Asaidlo | CC0 1.0 |
| `teams-building.jpg` | Participants at laptops around a table | Tulipasylvestris | CC BY 4.0 |
| `demo-room.jpg` | Room watching a project demo | SSethi (WMF) | CC BY-SA 4.0 |

## 3. Colour tokens

All ratios were measured with the WCAG 2.x relative-luminance formula against the three surfaces. Text tokens are ≥ 4.5:1 on every surface. Control borders are ≥ 3:1.

### 3.1 Surfaces and text

| Token | Hex | Use | Contrast (bg / s1 / s2) |
| --- | --- | --- | --- |
| `--surface-bg` | `#0B1220` | Page background | --- |
| `--surface-1` | `#111A2E` | Panels, table body, drawer | --- |
| `--surface-2` | `#18233A` | Raised: table header, hovered row, inputs, expanded remarks | --- |
| `--border-subtle` | `#2A3754` | Dividers, table row lines (decorative only) | 1.6 / 1.5 / 1.3 |
| `--border-control` | `#63749A` | Input, checkbox and button outlines | 4.0 / 3.7 / 3.4 |
| `--text-primary` | `#E8EDF5` | Body text, numbers | 15.9 / 14.8 / 13.3 |
| `--text-secondary` | `#A9B6CA` | Labels, column headers, remarks | 9.1 / 8.5 / 7.6 |
| `--text-muted` | `#8494AD` | Timestamps, helper text, disabled labels | 6.1 / 5.6 / 5.1 |
| `--link` | `#9CC2FF` | Links and text buttons | 10.3 / 9.6 / 8.6 |
| `--focus` | `#F5F7FF` | Focus ring | 17.5 / 16.2 / 14.7 |

### 3.2 Score scale (1–5)

A diverging scale: warm hues for weak scores, cool hues for strong ones. The colour is never the only signal. Every score also shows its numeral and filled pips (section 6.2).

| Score | Token | Hex | Meaning (rubric tier) | Contrast on s1 · ink on colour |
| --- | --- | --- | --- | --- |
| 1 | `--score-1` | `#FF7070` | Mostly concept / superficial / hard to follow | 6.4 · 7.0 |
| 2 | `--score-2` | `#FFAE57` | Between 1 and 3 | 9.5 · 10.2 |
| 3 | `--score-3` | `#EBD36C` | Core flow works / AI enables a key step / usable | 11.6 · 12.5 |
| 4 | `--score-4` | `#4FD8C6` | Between 3 and 5 | 9.9 · 10.7 |
| 5 | `--score-5` | `#7DB8FF` | Convincing / strong fit / clear and valuable | 8.4 · 9.1 |

Overall scores are decimals (for example 3.92). They take the colour of the nearest whole score, rounding half up, so 3.50 uses `--score-4`.

### 3.3 Processing states

| State | Token | Hex | Icon (shape carries meaning) | Label |
| --- | --- | --- | --- | --- |
| Pending | `--state-pending` | `#94A3BB` | Hollow circle | Pending |
| In progress | `--state-active` | `#B79CFF` | Circle with a rotating quarter arc; static half-filled circle under reduced motion | Downloading · Uploading · Processing Video · Scoring |
| Completed | `--state-done` | `#5EE0A0` | Filled circle with a check | Completed |
| Failed | `--state-failed` | `#FF7070` | Filled triangle with an exclamation mark | Failed |
| Interrupted / Paused | `--state-hold` | `#FFAE57` | Two vertical bars | Interrupted |

Rules:

- States always appear as **icon + text label**, never as a colour dot alone.
- In-progress states share one colour and differ by label, so a judge sees "work happening" at a glance and the exact step on reading.
- Failed and score 1 share a hue on purpose: both mean "needs attention". They never appear in the same visual slot. States are in the Status column; scores are in score columns.

### 3.4 Flags

Data-quality flags (over 3:00, no working demo, audio missing or unintelligible, narrated not shown, impact claimed without explanation) use a neutral style, not an alarm colour. They are outlined chips: `--text-primary` on `--surface-2`, 1px `--border-control`, with a small flag glyph. Flags call for caution, not alarm. The score colours already carry quality.

### 3.5 Tailwind 4 mapping

Define the tokens once in `src/app/globals.css`. Components use only these utilities, never raw hex values.

```css
@import "tailwindcss";

@theme {
  --color-surface-bg: #0B1220;
  --color-surface-1: #111A2E;
  --color-surface-2: #18233A;
  --color-border-subtle: #2A3754;
  --color-border-control: #63749A;
  --color-text-primary: #E8EDF5;
  --color-text-secondary: #A9B6CA;
  --color-text-muted: #8494AD;
  --color-link: #9CC2FF;
  --color-focus: #F5F7FF;

  --color-score-1: #FF7070;
  --color-score-2: #FFAE57;
  --color-score-3: #EBD36C;
  --color-score-4: #4FD8C6;
  --color-score-5: #7DB8FF;

  --color-state-pending: #94A3BB;
  --color-state-active: #B79CFF;
  --color-state-done: #5EE0A0;
  --color-state-failed: #FF7070;
  --color-state-hold: #FFAE57;

  --font-display: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Atkinson Hyperlegible Next", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "Atkinson Hyperlegible Mono", ui-monospace, "SFMono-Regular", monospace;

  --radius-sm: 4px;
  --radius-md: 6px;
}

:root { color-scheme: dark; }
body { background: var(--color-surface-bg); color: var(--color-text-primary); }
```

## 4. Typography

| Role | Typeface | Why |
| --- | --- | --- |
| UI and body | **Atkinson Hyperlegible Next** | Designed by the Braille Institute so that similar characters (I/l/1, 0/O, rn/m) stay distinct. Judges read many short remarks quickly; low-vision legibility is part of the brief, not an add-on |
| Data | **Atkinson Hyperlegible Mono** | Scores, overall decimals, timestamps (`01:42`), queue numbers. Equal-width figures keep table columns aligned. Same family as the body, so data and prose sit together without clashing |
| Display (restrained) | **Bricolage Grotesque**, semibold, slightly condensed width | Used in exactly two places: the page title, and the large overall score in a scorecard. It gives the overall score a stamped, verdict-like presence |

Load all three with `next/font/google` and `display: swap`, subsetting to Latin plus Latin Extended. If the Atkinson Next or Mono families are not available through `next/font/google` in the installed Next version, self-host them with `next/font/local`. The fallbacks in section 3.5 apply until the fonts load.

### 4.1 Type scale

The scale is dense by design. The body is 14px, and nothing below 12px is allowed.

| Token | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| `text-xs` | 12 / 16 | 400 | Timestamps, helper text, table meta (never for remarks) |
| `text-sm` | 13 / 18 | 400, 600 | Table cells, chips, column headers (600, sentence case) |
| `text-base` | 14 / 20 | 400 | Body, remarks, form fields |
| `text-md` | 16 / 24 | 600 | Section headings in panels, team name in the drawer |
| `text-lg` | 20 / 28 | 600 | Panel titles |
| `text-xl` (display) | 28 / 32 | 600 | Page title |
| `text-score` (display) | 48 / 48 | 600 | Overall score in a scorecard, tabular |

Rules:

- Numbers in tables and scorecards use `font-mono` with `font-variant-numeric: tabular-nums`.
- Never use all caps for labels. Use sentence case, which is easier to read at small sizes.
- Remarks have a maximum line length of 72 characters (`max-w-[72ch]`).

## 5. Layout

### 5.1 App shell

```
┌──────────────────────────────────────────────────────────────────────────┐
│ DemoDay   Evaluate   Batches   Rubric                  ? Shortcuts  Judge│  48px top bar
├──────────────────────────────────────────────────────────────────────────┤
│ AI scores are decision support, not final results.                       │  28px notice
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   page content (max-width none for tables; 1200px for forms)             │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Top navigation** is used instead of a side rail, so the score table gets the full width.
- **The decision-support notice** is permanent and cannot be dismissed (BRD guardrail). It is a single line of `text-xs` in `--text-secondary` on `--surface-1`, quiet but always present.
- **Spacing** is a 4px base grid. Panel padding is 16px, gaps between panels 12px, and table cell padding is 8px vertical by 12px horizontal.
- **Radius**: 4px on chips and inputs, 6px on panels. Nothing is fully rounded except state icons.

### 5.2 Batch screen (S-2, the main working screen)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ Spring Hackathon 2026 · Drive folder            [Pause] [Export CSV]     │
│ ███████████████████▓▓░░░░░░░░░░░  12 completed · 1 scoring · 1 failed · 6 pending │
│ Filter: [All 20] [Completed 12] [In progress 1] [Failed 1] [Pending 6]   │
├────┬───────────────┬──────────────┬─────┬─────┬─────┬────────┬──────────┤
│ #  │ Team          │ Status       │ WS  │ AI  │ UX  │Overall │ Flags    │
├────┼───────────────┼──────────────┼─────┼─────┼─────┼────────┼──────────┤
│ 1  │ Team Alpha  ▸ │ ● Completed  │ 4 ▪▪▪▪▫ 3 ▪▪▪▫▫ 5 ▪▪▪▪▪│  3.92 │          │
│ 2  │ Team Beta   ▸ │ ◐ Scoring    │  –  │  –  │  –  │   –    │          │
│    │               │ More time is needed                                 │
│ 3  │ Team Gamma  ▸ │ ▲ Failed     │ No video found in folder · Retry team│
│ …  │               │              │     │     │     │        │          │
└────┴───────────────┴──────────────┴─────┴─────┴─────┴────────┴──────────┘
```

- **Progress bar**: one segment per state, in state colours. The text summary of counts is always shown next to it, so the counts can be read without colour.
- **Filter chips** show counts and work as toggle buttons (`aria-pressed`).
- **Columns** are queue number, team, status, one column per rubric category (header shows the short name and weight, for example "Working Solution 25%"), overall, flags, and last updated (hidden below 1280px).
- **Remarks in the table**: the BRD requires category remarks in the table. Each completed row has a disclosure (`▸`) that expands the row in place to show the remarks for all categories and the overall comments in a two-column grid. Collapsed rows show no remark text, which keeps the table scannable.
- **Failed rows** span the score columns with the reason and a "Retry team" text button.
- **Default sort** is queue order. Clicking a header sorts by overall score or by a category; `aria-sort` reflects it.
- **Row density** is 40px by default, with a "Comfortable" toggle (52px) in the table header. The choice is remembered per browser.

### 5.3 Review mode (team detail, TBL-02 and SNG-04)

Selecting a row opens a review panel without leaving the table. The judge moves through teams with `J` / `K` (section 8).

```
≥ 1280px: split view
┌───────────────────────────┬──────────────────────────────────────────────┐
│ Table (compressed:        │ Team Alpha                     3.92  ◂ ▸  ✕ │
│ #, Team, Status, Overall) │ ┌──────────────────────┐ Overall comments…   │
│                           │ │      video 16:9      │                      │
│ ▸ 1 Team Alpha   3.92     │ └──────────────────────┘                      │
│   2 Team Beta    –        │ Evidence strip ──●──○───●●──○──|3:00         │
│   3 Team Gamma   Failed   │ Working Solution 25%   4 ▪▪▪▪▫  ▾ remarks    │
│                           │ Meaningful Use of AI 20%  3 ▪▪▪▫▫  ▾         │
│                           │ UX & Value 15%         5 ▪▪▪▪▪  ▾           │
│                           │ Flags · Provenance · Override score          │
└───────────────────────────┴──────────────────────────────────────────────┘
```

- **At 1280px and wider**: the table narrows to about 40% and the panel takes about 60%.
- **From 768 to 1279px**: the panel overlays 80% of the width from the right, with a scrim. The table stays mounted underneath.
- **Below 768px**: the panel is a full-screen view with a back control. The video is on top, then the evidence strip, then the categories.
- The panel is a labelled region (`role="region"`, `aria-label="Team Alpha scorecard"`). `Esc` closes it and returns focus to the originating row.

### 5.4 Single evaluation screen (S-1)

```
┌──────────────────────────────────────────────────────────────┐
│ Evaluate a video                                             │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │  Drop a video here or choose a file                      │ │
│ │  MP4, MOV or WebM · up to 1 GB · about 3 minutes         │ │
│ └──────────────────────────────────────────────────────────┘ │
│ Uploading ──── Processing Video ──── Scoring ──── Completed  │
│     ●━━━━━━━━━━━━━━━━◐                                       │
│ More time is needed. Still processing video…                 │
└──────────────────────────────────────────────────────────────┘
```

- The step tracker shows the four steps as text, with the current one marked by the active icon and `aria-current="step"`.
- Upload shows a percentage and the bytes sent.
- On completion, the scorecard replaces the tracker in the same layout as review mode (section 5.3).

## 6. Components

Each component lists its anatomy, states and accessibility contract. All user-facing strings come from i18n keys, not literals, per the project i18n rule.

### 6.1 StatusBadge

- **Anatomy**: icon (16px) + label (`text-sm`, 600), in the state colour, with no background fill.
- **Optional second line**: for in-progress states after 10s, "More time is needed" in `text-xs`, `--text-muted`.
- The icon is `aria-hidden`; the label carries the meaning.

### 6.2 ScoreChip and ScorePips

- **Anatomy**: the numeral (`font-mono`, 600) in the score colour, followed by five 6×10px pips, with filled pips in the score colour and empty pips in `--border-subtle`.
- **Accessible name**: `aria-label="Working Solution: 4 out of 5"`.
- **Missing score** (pending or failed): an en dash in `--text-muted`, with `aria-label="No score yet"`.
- **Overridden score**: the final score is shown, followed by the AI score struck through in `--text-muted` (for example `2 ~~4~~`) and an "Overridden" text tag. Accessible name: "Working Solution: final 2 out of 5, AI 4".

### 6.3 OverallScore

- Shown in `text-score` display type in the colour of the nearest whole score, with "out of 5" in `text-sm` beside it.
- Below it, the weighting line: `Weighted · WS 25% · AI 20% · UX 15%`.
- When any override exists, it shows "Final 3.08 · AI 3.92".

### 6.4 CategoryRow (expandable remarks)

- **Collapsed**: category name, weight, ScoreChip, and the first line of the remarks truncated with an ellipsis, followed by an expand toggle.
- **Expanded**: the full remarks, with observation timestamps rendered as links (`01:42`). Activating one seeks the video (single uploads) and highlights the marker on the Evidence Strip.
- **The toggle** is a `<button aria-expanded aria-controls>`. `E` expands or collapses all categories in the open scorecard.

### 6.5 EvidenceStrip (signature)

```
 Context      Demo                                   Value         │ over
 0:00   0:20                                   2:20          3:00 │ ////
 ├──────┼──────●────●──○───●────────○──────────┼──────●──○───────┤////
```

- **Track**: 8px tall, `--surface-2`. Segment boundaries are 1px `--border-control` ticks with labels in `text-xs`.
- **Markers**:
  - *Demonstrated* is a 10px filled circle in `--text-primary`.
  - *Claimed* is a 10px hollow ring with a 2px stroke in `--text-secondary`.
  - Shape carries the meaning, not colour.
- **Duration**:
  - The track spans 0 to max(3:00, video length).
  - Time past 3:00 is hatched with diagonal lines in `--state-hold`.
  - The flag chip "Over 3:00 (3:24)" sits at the end of the strip.
- **Interaction**:
  - Markers are focusable buttons in time order. Left and right arrow keys move between markers.
  - Each marker's accessible name is its tooltip text, for example "01:42, demonstrated, demo: summary generated from uploaded PDF".
  - `Enter` seeks the video.
- **Legend**: an inline legend ("● demonstrated ○ claimed") sits directly under the strip, always visible, never in a tooltip.
- **Empty state** (results from before S-4): only the track and duration are shown, with the text "No evidence details for this result".
- **Summary**: a text line below the strip counts the observations, for example "Demo segment: 4 demonstrated, 1 claimed", so the meaning is also available as text.

### 6.6 BatchProgressBar

- A stacked horizontal bar 8px tall, with segments in queue state order: Completed, In progress, Failed, Interrupted, Pending.
- It always shows the text summary next to it, and `role="progressbar"` with `aria-valuenow` set to the number of finished teams (Completed + Failed).

### 6.7 FlagChip

- An outlined neutral chip (section 3.4) with fixed wording that matches the stories:
  - "Over 3:00"
  - "No working demo"
  - "Audio missing"
  - "Audio unintelligible"
  - "Narrated, not shown"
  - "Impact claimed without explanation"
  - "Judged with a previous rubric"
- In the table, up to two chips are shown, then "+N".

### 6.8 OverrideDialog

- **Modal dialog** (`role="dialog"`, `aria-modal="true"`). Focus is trapped while it is open and returns to the trigger on close. `Esc` closes it without saving.
- **Fields**: category (preselected), score (a 1–5 segmented control with arrow-key support), and note (required, multi-line).
- **Validation messages** match the stories: "Add a note explaining the override", "Score must be a whole number from 1 to 5".
- **Primary action**: "Save override". Toast on success: "Override saved".

### 6.9 Buttons and controls

| Variant | Style | Use |
| --- | --- | --- |
| Primary | `--text-primary` fill with `--surface-bg` text | One per view: "Start batch", "Evaluate video", "Save override" |
| Secondary | 1px `--border-control` outline, `--text-primary` text | "Resume batch", "Export CSV", "Pause" |
| Text | `--link` text, underline on hover and focus | Inline actions: "Retry team", "Show remarks" |
| Destructive | `--state-failed` outline and text | "Delete evaluation" (confirmation is built into the page, never a browser `confirm()`) |

- Minimum target size is 24×24px (WCAG 2.5.8). Primary actions are 36px tall.
- Disabled controls use `--text-muted` and keep a visible outline. A tooltip explains why the control is disabled, for example "Batch is already running".

### 6.10 Feedback surfaces

| Surface | Use | Behavior |
| --- | --- | --- |
| Inline field error | Form validation | Below the field in `--state-failed` with an icon; the field gets `aria-invalid` and `aria-describedby` |
| Row-level reason | Team failure | In the row (section 5.2); persistent |
| Page banner | Batch-level problems (Interrupted, folder unreadable) | Top of the content, with an action ("Resume batch") |
| Toast | Confirmation of a judge action ("Override saved", "Export ready") | Bottom right, 5s, pauses on hover and focus, `role="status"` |

Errors never go only in a toast. Anything the judge must act on stays on the page until it is resolved.

## 7. Content and copy

- **Sentence case** everywhere. No exclamation marks. No apologies in errors.
- **One name per action** through the whole flow:
  - "Start batch" (button) → "Batch started" (toast)
  - "Resume batch" → "Batch resumed"
  - "Retry team" → status returns to "Pending"
  - "Export CSV" → file `scores.csv`
- **Status vocabulary** is fixed, matching [stories.md](stories.md): Pending, Downloading, Uploading, Processing Video, Scoring, Completed, Failed, Interrupted. The word "Timeout" never appears. The slow-step tip is "More time is needed. Still {step}…".
- **Error pattern**: what happened, then what to do.
  - Good example: "DemoDay cannot read this folder. Share it as 'Anyone with the link' and try again."
  - Bad example: "Something went wrong."
- **Empty states give direction**:
  - Batches list with none yet: "No batches yet. Paste a Google Drive folder link to judge every team in it."
  - Filter with no matches: "No teams match this filter." plus a "Clear filter" text button.
- **AI language**: say "AI score", "AI remarks", "Final score". Never "verdict", "grade" or "result" without qualification.

## 8. Keyboard model

Every action is reachable with Tab in a logical order: top nav, page actions, filters, table, review panel. Single-key shortcuts speed up batch review.

| Key | Context | Action |
| --- | --- | --- |
| `J` / `K` | Table or review panel | Next / previous team (opens it in the panel if the panel is open) |
| `Enter` | Focused row | Open review panel |
| `Esc` | Panel or dialog | Close; focus returns to the row or trigger |
| `E` | Review panel | Expand or collapse all remarks |
| `O` | Review panel, focused category | Open the override dialog for that category |
| `Space` | Review panel | Play or pause the video |
| `←` / `→` | Evidence Strip | Previous / next marker |
| `/` | Batch screen | Focus the team search field |
| `?` | Anywhere | Open the shortcut reference |

Rules:

- **Single-key shortcuts are inactive while focus is in a text field.** The shortcut reference has a "Turn off single-key shortcuts" switch, remembered per browser (WCAG 2.1.4).
- **Table focus**: the table uses a roving focus model. Rows are focusable, and `↑` / `↓` move between rows. Interactive cells are reached with Tab inside the row.
- **Focus ring**: a 2px `--focus` outline with a 2px offset in `--surface-bg`. It is never removed. Use `:focus-visible` so mouse clicks do not show it.
- **Skip link**: "Skip to team table" is the first focusable element on the batch screen.

## 9. Motion

Motion signals only state changes.

| Event | Motion | Reduced motion |
| --- | --- | --- |
| Team row completes or fails | Row background flashes `--surface-2` to transparent over 800ms | No flash; the status label change alone |
| In-progress icon | Quarter arc rotates once per 1.2s | Static half-filled circle |
| Review panel open | Slide in 160ms ease-out | Appears instantly |
| Remarks expand | Height 120ms | Instant |

No page-load animation, no hover lift, no skeleton shimmer. Loading placeholders are static `--surface-2` blocks.

## 10. Accessibility checklist

Target: WCAG 2.2 AA.

- **Contrast**: text ≥ 4.5:1 and UI component boundaries ≥ 3:1 on every surface. Verified in section 3. Any new token must be verified the same way before use.
- **Not colour alone**: states use icon and label; scores use numeral and pips; evidence uses filled or hollow shapes; the progress bar has a text summary.
- **Semantics**:
  - The table is a real `<table>` with `<th scope>`, a `<caption>` (visually hidden: "Team scores for {batch}"), and `aria-sort` on sortable headers.
  - Disclosures use `aria-expanded`. The step tracker uses `aria-current="step"`.
- **Live updates**:
  - One `aria-live="polite"` region announces team completions, at most one announcement every 5s and batched ("3 teams completed. Team Gamma failed.").
  - In-progress step changes are not announced, which avoids noise.
- **Zoom and reflow**: usable at 200% zoom. At 320 CSS px the page does not scroll horizontally, except the score table, which has its own horizontal scroll container with a sticky Team column.
- **Media**: the video player uses native controls, which are keyboard accessible. Captions are not available from team videos; the AI remarks are the text alternative.
- **Forms**: visible labels (never placeholder-only), errors linked with `aria-describedby`, and the required note in the override dialog marked in text, not only with an asterisk.

## 11. Responsive breakpoints

| Width | Batch screen | Review panel |
| --- | --- | --- |
| ≥ 1280px | Full table with all columns | Split view (40/60) |
| 768–1279px | "Last updated" column hidden; flags collapse to a count | Overlay drawer at 80% width |
| < 768px | Horizontally scrollable table with a sticky Team column; filters scroll horizontally | Full-screen view with a back control |

The primary target is a 13–16 inch laptop (1280–1728px). Phones are supported for checking progress and reading scorecards, not for long review sessions.

## 12. Definition of done for UI stories

On top of the DoD and common-test-strategy rules:

- [ ] Uses only the tokens in section 3; no raw hex values in components.
- [ ] Every state, score and flag on the screen has a non-colour indicator.
- [ ] Keyboard path verified: the story's main flow is completed without a mouse, and focus is visible at every step.
- [ ] Checked at 1440px, 1024px and 390px widths, and at 200% zoom.
- [ ] Reduced-motion setting verified.
- [ ] Copy matches section 7 and the story's acceptance criteria; all strings come from i18n keys.
- [ ] Automated accessibility scan (axe through Playwright) on the changed screen with no serious or critical issues.
