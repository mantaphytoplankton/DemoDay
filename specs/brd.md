# DemoDay --- Business Requirements
## What it is
DemoDay is an AI-assisted evaluation tool designed to assess hackathon video submissions. Built to analyze approximately three-minute project pitches, it evaluates each team's solution across three core pillars: clearly identifying the target audience and their problem, demonstrating the working prototype through an actual walkthrough, and articulating the tangible value and impact the solution delivers.
## Who it's for
DemoDay is built primarily for hackathon judges and organizers who face the time-consuming bottleneck of manually reviewing dozens—or even hundreds—of team videos. By acting as an AI co-pilot, DemoDay automates the initial review and synthesis process, drastically cutting down evaluation time while helping judges deliver consistent, structured, and objective assessments for every submission.
## How it fits together
- **Web app** --- submission portal, judge review workspace, side-by-side video and scorecard view, and human-in-the-loop score override controls. The browser talks only to the app backend.
- **demoday-judge-agent** --- sends the ~3-minute video directly to a multimodal LLM along with the dynamically loaded rubric; separates observed video facts (what was actually shown in the demo vs. merely claimed), rubric evaluations (target audience, walkthrough, value), and preliminary scores.
- **demoday-rubric-config** --- rubric.md, an externalized Markdown file defining judging criteria weights, target audience expectations, scoring tiers, and common demo pitfalls (e.g., slideware-only pitches or hardcoded mockups), loaded into the agent's context at runtime without hardcoding.

## Features
### Single Video Evaluation
- Upload one video file at a time (recommended ~3 minutes, 16:9 landscape screen recording with narration) for immediate assessment
- Display the detailed score (1–5 scale) and weight for each category, remarks explaining why the score was given, overall score, and overall comments
- Map observations from the expected video flow (~20s setting context, ~2m showing the demo, ~40s highlighting value) directly into the category remarks

### Batch Google Drive Evaluation
- Provide a URL to a parent Google Drive folder containing multiple team subfolders, with each subfolder holding a team's video file
- Retrieve and judge one video file at a time sequentially across all team subfolders
- Dynamically update a master table of scores for all teams with the same detailed category scores, category remarks, overall score, and overall comments as single-file mode

### Video Judging Agent --- demoday-judge-agent
- Analyzes submission videos using a multimodal LLM against three weighted rubric categories:
  - **Working Solution (25%):** Evaluates whether the video demonstrates an actual usable end-to-end flow (input -> AI/solution -> output), scoring from 1/5 (mostly concept) to 3/5 (core flow works) to 5/5 (convincing across realistic cases)
  - **Meaningful Use of AI (20%):** Assesses whether AI is appropriately applied and materially enables or improves the solution rather than for novelty, scoring from 1/5 (superficial use of AI) to 3/5 (AI enables key step) to 5/5 (strong task/AI fit with safeguards)
  - **User Experience & Value (15%):** Evaluates whether the demo makes it easy to understand how the user would use it and why the experience or outcome is better, scoring from 1/5 (hard to follow) to 3/5 (usable and plausible) to 5/5 (clear, practical, and valuable)
- Distinguishes demonstrated video evidence (actual input, AI behaviour, and output) from unverified verbal claims; flags submissions that narrate an idea without showing it or claim impact without explaining how
- Agent prompt and judging rubric stored in separate, version-controlled `rubrics.md` files. If no file found, use the above rubrics.

### Team Score Table & CSV Export
- Screen for the batch evaluation queue: team name (from subfolder), processing status, individual category scores, category remarks, overall score, and overall comments
- Select any evaluated team row to view the full detailed scorecard and remarks breakdown
- Export the complete table of team scores, category breakdowns, and remarks as a downloadable `scores.csv` file

### Data Quality & Judging Guardrails
- Flag videos that exceed the 3-minute maximum, lack a working demo walkthrough, or have missing/unintelligible audio
- Disregard video polish, fancy editing, or overused jargon without context so evaluations focus on practical experimentation and functional flow
- AI scores and remarks must be presented as decision-support assessments rather than final official results
- One corrupted video or unreadable subfolder must not take down the whole batch run

### Performance & Resumability
- Show stored team scores and batch progress immediately in the table while remaining videos are queued and judged
- Persist assessment state after each completed team subfolder; if a batch run fails or stops at any point, resume cleanly from the exact subfolder where it stopped
- Cache completed evaluations with timestamps to avoid re-downloading videos or making repeated LLM calls for already-judged teams
- Use timeouts, retries, and graceful fallbacks for Google Drive retrieval and LLM inference

## Success looks like
A hackathon judge can either upload a single video or link a Google Drive folder of team submissions, watch the score table populate one team at a time with clear category scores and evidence-backed remarks across Working Solution, Meaningful Use of AI, and User Experience & Value, seamlessly resume if a batch run is interrupted, and export the complete results to CSV---while keeping human judges as the final authority.