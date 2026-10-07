/* DemoDay S-1 prototype: rubric source and sample agent output.
   The rubric text mirrors config/rubric.default.md (architecture-design.md 5.2).
   The scorecard below is SAMPLE output used only to prototype the flow. */
window.DD = window.DD || {};

DD.RUBRIC_MD = `# DemoDay judging rubric (default)

Judge each ~3-minute hackathon video on what is demonstrated, not on what is claimed.
Expected flow: ~20s setting context, ~2m showing the demo, ~40s highlighting value.

\`\`\`json rubric-meta
{
  "maxDurationSeconds": 180,
  "categories": [
    { "id": "working_solution", "name": "Working Solution",        "short": "WS", "weight": 25 },
    { "id": "meaningful_ai",    "name": "Meaningful Use of AI",    "short": "AI", "weight": 20 },
    { "id": "ux_value",         "name": "User Experience & Value", "short": "UX", "weight": 15 }
  ]
}
\`\`\`

## Working Solution (25%)
Does the video demonstrate an actual usable end-to-end flow (input -> AI/solution -> output)?
- 1/5: Mostly concept
- 3/5: Core flow works
- 5/5: Convincing across realistic cases

## Meaningful Use of AI (20%)
Is AI appropriately applied, and does it materially enable or improve the solution rather than add novelty?
- 1/5: Superficial use of AI
- 3/5: AI enables a key step
- 5/5: Strong task/AI fit with safeguards

## User Experience & Value (15%)
Does the demo make it easy to understand how the user would use it and why the outcome is better?
- 1/5: Hard to follow
- 3/5: Usable and plausible
- 5/5: Clear, practical and valuable

## Target audience expectations
The team names who the user is and the problem they face within the first ~20 seconds.

## Common pitfalls
- Slideware-only pitches with no working walkthrough
- Hardcoded mockups presented as a working product
- Impact claimed without explaining how it is achieved
- Polish, editing effects or jargon used in place of a working flow
`;

DD.TIERS = {
  working_solution: ["Mostly concept", "Core flow works", "Convincing across realistic cases"],
  meaningful_ai: ["Superficial use of AI", "AI enables a key step", "Strong task/AI fit with safeguards"],
  ux_value: ["Hard to follow", "Usable and plausible", "Clear, practical and valuable"],
};

/* SAMPLE agent output (prototype only). Shape follows architecture-design.md 5.3. */
DD.SAMPLE_OUTPUT = {
  categories: [
    {
      id: "working_solution",
      score: 4,
      remarks:
        "The demo shows a complete flow at 00:31–02:05: the presenter uploads a 12-page PDF lease, the app extracts clauses and returns a plain-language summary with highlighted risks. A second document is processed at 01:48 with a different result, which shows the flow is not hardcoded. Not shown: handling of scanned or low-quality documents, which keeps this below 5.",
    },
    {
      id: "meaningful_ai",
      score: 3,
      remarks:
        "AI performs the key step (clause extraction and risk summary, 00:52). The narration at 02:20 claims the model \"flags illegal clauses in any jurisdiction\", but this is not demonstrated and no safeguard against wrong advice is shown.",
    },
    {
      id: "ux_value",
      score: 5,
      remarks:
        "The target user (first-time renters) and their problem are stated in the first 15 seconds. The interface is two steps and the value — understanding a lease in minutes instead of paying for a review — is explained with a concrete before/after at 02:35.",
    },
  ],
  overallComments:
    "A working, focused prototype with a clear audience. The core extraction flow is demonstrated twice on different inputs. The strongest claims about legal accuracy are narrated rather than shown; judges may want to ask how incorrect summaries are detected.",
};
