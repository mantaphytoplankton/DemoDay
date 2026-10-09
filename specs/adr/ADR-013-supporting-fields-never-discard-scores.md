# ADR-013: Supporting output fields are validated separately and never discard scores

## Status
Accepted

## Context
S-5 adds a transcript (JDG-08) and a video summary (JDG-09) to the agent's output. Until then the whole model answer was validated as one schema: if it was still invalid after the one repair turn, the evaluation failed with `INVALID_MODEL_OUTPUT` and no scorecard was saved (JDG-04, agent-design.md 6.4).

The new fields are long (a transcript of a 3-minute pitch is about 500 words in 10 to 20 segments) and carry rules the JSON Schema cannot express (summary of at least 40 words, no score talk). They are therefore more likely to be wrong than the scorecard itself. The organizer asked for them as evidence and context, not as part of the score. A failed scoring costs a judge a retry and a second paid request.

## Decision
- The transcript and summary are requested in the **same** generateContent call as the scores. No second request is made for them.
- The full schema (supporting fields plus scorecard) is still sent and validated first, and a failure still triggers the one repair turn, which names the transcript or summary issue.
- If the answer is still invalid after the repair, the scorecard part (observations, categories, overall comments, flags) is validated on its own (`buildCoreOutputSchema`). When it is valid, the result is saved and each supporting field that is invalid on its own is stored as `null` ("Transcript / Summary not available for this result"). Of the two answers, the one missing the fewest supporting fields is used, preferring the repaired one.
- An invalid scorecard still fails as before. No default or partial scores are ever saved.
- Results keep `outputVersion`. A missing field (`undefined`, version 1 or 2) means "judged before this feature"; `null` (version 3) means "not available for this result".

## Rationale
- **Separate request for the transcript**: rejected. It doubles video input tokens (about 12,000 to 18,000 per video) and latency, and the model would no longer transcribe before judging.
- **Treat the new fields like the scorecard (fail on invalid)**: rejected. A transcript problem would fail an otherwise valid evaluation, contrary to the stories' rule that a missing transcript or summary never discards valid scores.
- **Make the fields optional in the request schema**: rejected. The model would be free to omit them, and the repair turn would not ask for them.

## Consequences
- `EXTRA_FIELDS` in `output-schema.ts` lists the supporting fields. A future supporting field is added there with its own schema and gets the same behavior.
- `agent.extras_missing` in the server log records which fields were dropped. If it becomes frequent for a model, the prompt or schema needs attention; the scores are unaffected.
- Request-schema limits that the provider rejects (Vertex AI and `maxItems` on the transcript) are removed from the request only and enforced on the answer ([knowledge note](../knowledge/gemini/structured-output-limits.md)).

## Date
2026-10-09
