# ADR-005: Server code runs directly under Node (type stripping); lint rule instead of `server-only`

## Status
Accepted

## Context
The agent must run from the terminal (`npm run judge`) as well as inside Next.js. Options were: add `tsx` or a build step for scripts, or let Node 24 run the TypeScript directly. The `server-only` package throws outside the React server condition, so it breaks the command-line tool.

## Decision
- Code in `src/server/**`, `src/shared/**` and `src/i18n/**` uses relative imports with `.ts` extensions and only erasable TypeScript syntax (`erasableSyntaxOnly`; no parameter properties or enums). `package.json` has `"type": "module"`.
- UI code may use the `@/` alias.
- The client/server boundary is enforced by ESLint `no-restricted-imports` (components and hooks may not import `@/server/*`), not by `server-only`.

## Rationale
- No extra dev dependency or build step for scripts.
- The same modules run unchanged under Next, Vitest and plain Node.

## Consequences
- Two import styles in one repo; the rule is documented in app-design.md section 15.
- Parameter properties fail at runtime under Node (ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX). Rely on `tsc` with `erasableSyntaxOnly` to catch them before running.

## Date
2026-10-05
