# 0001 — Monorepo layout, module resolution, and toolchain

**Status:** Accepted (Wave 0)

## Decision

- pnpm workspace at the repository root: `apps/*`, `packages/*`, `tools/*`. Package scope `@docs-platform/*`.
- TypeScript **6.0.x** (not 7.x: typescript-eslint supports `<6.1`). ESM only, `module: NodeNext`, strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`. Relative imports use `.js` extensions.
- Each library's `package.json` `exports` has a `development` condition pointing at `src/index.ts`, plus `types`/`default` pointing at `dist`. `tsconfig.base.json` sets `customConditions: ["development"]`, Vitest resolves the same condition, and `tsx --conditions=development` runs apps from source. So **typechecking, tests, and local dev need no build step**. `tsconfig.build.json` clears the condition so production builds link against `dist`, and `pnpm build` runs in topological order.
- Vitest 5 runs from the root (`pnpm test`). Tests sit beside their code as `*.test.ts`; cross-package and integration tests go in `tests/`. Tests that need Postgres check for `PGHOST` and skip with a clear message if it's missing.
- Zod 4 for every runtime-validated boundary (config, HTTP bodies, files, stream events).
- `@docs-platform/contracts` depends only on `zod` and must stay browser-safe (no Node types or APIs), because the chat widget imports it.

## Consequences

Agents can work on packages in parallel against contract sources without coordinating builds. Changing a contract is a cross-cutting change and goes through the orchestrator.
