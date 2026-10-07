# ADR-003: Rubric-driven output schema; overall score and duration flag computed in code

## Status
Accepted

## Context
The BRD requires an externalized rubric, with a fallback when the file is missing, and weighted categories (25/20/15). tech-spec forbids hardcoding rubric text in TypeScript. The model must return one score per category, and it can miscount or invent categories.

## Decision
- `rubric.md` carries one fenced `json rubric-meta` block: category IDs, names, weights, tier text and the maximum duration. The prose around it is what the model reads.
- The loader resolves `data/rubric.md` first, then `config/rubric.default.md`, and validates the block with Zod. An invalid block fails the evaluation with "Rubric configuration invalid".
- The response schema is built per evaluation from the rubric. Categories are an object keyed by ID, so JSON Schema `required` forces each category exactly once. `remarks` comes before `score`, so the model writes its reasoning before the number.
- The weighted overall score and the over-duration flag are computed in code: the duration comes from Gemini's `videoMetadata`, rounded to whole seconds.

## Rationale
- Weights must come from the same file the model reads, without a second source of truth.
- An array of categories cannot express "each ID exactly once" in JSON Schema.
- Arithmetic and duration are deterministic facts. Asking the model for them adds error for no benefit.

## Consequences
- Editing `rubric.md` changes the scoring at the next evaluation, with no code change.
- Every result stores the rubric metadata and version it used, so old results stay readable after rubric changes.
- The weights currently sum to 60%. The overall score is normalized by the sum of weights (open question Q1).

## Date
2026-10-05
