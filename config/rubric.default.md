# DemoDay judging rubric (default)

Judge each hackathon video of about 3 minutes on what the team demonstrates, not on what it claims.
Expected flow: about 20 seconds setting context, about 2 minutes showing the demo, about 40 seconds highlighting value.

```json rubric-meta
{
  "schemaVersion": 1,
  "maxDurationSeconds": 180,
  "categories": [
    {
      "id": "working_solution", "name": "Working Solution", "short": "WS", "weight": 25,
      "tiers": { "1": "Mostly concept", "3": "Core flow works", "5": "Convincing across realistic cases" }
    },
    {
      "id": "meaningful_ai", "name": "Meaningful Use of AI", "short": "AI", "weight": 20,
      "tiers": { "1": "Superficial use of AI", "3": "AI enables a key step", "5": "Strong task/AI fit with safeguards" }
    },
    {
      "id": "ux_value", "name": "User Experience & Value", "short": "UX", "weight": 15,
      "tiers": { "1": "Hard to follow", "3": "Usable and plausible", "5": "Clear, practical and valuable" }
    }
  ]
}
```

## Working Solution (25%)

Does the video demonstrate an actual usable end-to-end flow: real input, the AI or solution acting on it, and a visible output?

- 1: Mostly concept. Slides, narration or static screens; nothing runs.
- 3: Core flow works. One realistic input goes through the main flow and produces an output on screen.
- 5: Convincing across realistic cases. The flow runs on more than one realistic input, including a less ideal one, and the results differ as expected.

Evidence that counts: the presenter provides input live, the system responds, the output is shown. Evidence that does not count on its own: a slide describing the flow, a pre-filled result with no visible input.

## Meaningful Use of AI (20%)

Is AI appropriately applied, and does it materially enable or improve the solution rather than add novelty?

- 1: Superficial use of AI. AI is decorative or could be removed without changing the outcome.
- 3: AI enables a key step. A step of the flow depends on the model and the demo shows that step.
- 5: Strong task/AI fit with safeguards. The task suits AI, and the demo shows how wrong or uncertain output is handled.

## User Experience & Value (15%)

Does the demo make it easy to understand how the user would use it and why the outcome is better?

- 1: Hard to follow. The user, the steps or the benefit are unclear.
- 3: Usable and plausible. The steps are clear and a real user could plausibly follow them.
- 5: Clear, practical and valuable. The user and their problem are named, the flow is short, and the benefit is concrete (for example a before/after).

## Target audience expectations

The team names the target audience and the problem they face within the first 20 seconds or so.

## Common pitfalls

- Slideware-only pitches with no working walkthrough.
- Hardcoded mockups presented as a working product.
- Impact claimed without explaining how it is achieved.
- Polish, editing effects or jargon used in place of a working flow.
