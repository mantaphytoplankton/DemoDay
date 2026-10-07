# ADR-002: The judging agent is one structured model call, not a tool loop

## Status
Accepted

## Context
The BRD calls the judge an "agent". The usual agent pattern is a loop in which the model calls tools until it decides to answer. The judging task is: watch one video and score it against one rubric.

## Decision
`judgeVideo` is a fixed pipeline: upload → wait until ACTIVE → one `generateContent` call with a JSON response schema → at most one repair turn → post-process → delete the remote file. The model has no tools.

## Rationale
- Everything the model needs fits in one request: the video (~52k tokens at 1 fps), the rubric and the prompt (~3k).
- No tool would give the model information it does not already have.
- A loop would add latency, cost and run-to-run variance with no quality gain.
- Upload, polling, retries and validation are deterministic, so they belong in code, not in model decisions.

## Consequences
- Behaviour is predictable and testable. Every failure path maps to one error code (agent-design.md section 9).
- Revisit only with golden-set evidence, for example a second focused pass over the demo segment using video clipping, or self-consistency for borderline scores (agent-design.md section 2).

## Date
2026-10-05
