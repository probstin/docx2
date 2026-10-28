# Execution Plan

How `PLAN.md` gets built. Read this, `PLAN.md`, and `docs/adr/` before starting any task.

## Waves

Each wave ends with an orchestrator integration pass, `pnpm check` green, a code review, and a PR against `main`.

| Wave              | PLAN milestones   | Agents (model)                                                                                                                       |
| ----------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0 — Foundation    | M1 scaffold       | Orchestrator (Opus): workspace, `@docs-platform/contracts`, ADRs                                                                     |
| 1 — Core services | M1, M2 start      | API core (Sonnet) · Storage (Sonnet) · Sources + site builder (Sonnet) · Chat UI shell (Haiku)                                       |
| 2 — RAG + chat    | M2 finish, M3, M4 | RAG pipeline + mock model server (Sonnet) · Chat state/stream (Sonnet) · Chat presentation (Haiku) · Docusaurus integration (Sonnet) |
| 3 — Publishing    | M5                | Webhook + queue + reconciler (Sonnet) · Builder Job + promotion (Sonnet) · Images + Helm (Sonnet)                                    |
| 4 — Hardening     | M0 proofs, M6     | Auth/oauth2-proxy + security tests (Sonnet) · kind E2E + failure injection (Sonnet) · Guides/runbooks (Sonnet)                       |

The M0 feasibility gates are proven locally on kind (Gitea, pgvector, ingress-nginx, oauth2-proxy) as each wave makes them testable. Gates that depend on the real environment (internal model endpoints, the production RWX storage class, the enterprise IdP) are tracked as an operator checklist in Wave 4.

## Rules for every agent

1. **Contracts are the source of truth.** Import types and schemas from `@docs-platform/contracts`. Don't redefine them locally. If a contract is wrong or missing something, make the smallest additive change and **call it out explicitly in your final report**. Never make breaking changes to contracts silently.
2. **Stay in your lane.** Change only the paths your task assigns, plus your package's `package.json`. Shared root files (`package.json`, `tsconfig.base.json`, `eslint.config.js`, `vitest.config.ts`) change only if the task says so.
3. **Pin dependencies** to exact versions (`pnpm add -E`). Prefer maintained, widely used libraries. No dependency may need network access at runtime.
4. **Tests are part of the work.** Add Vitest tests beside the code. Postgres-dependent tests skip when `PGHOST` isn't set.
5. **Before reporting done:** `pnpm install`, `pnpm typecheck`, `pnpm lint`, and `pnpm test` all pass. Your report lists what you built, contract changes, deviations from PLAN/ADRs, and open questions.
6. **Security defaults:** no secrets in logs, responses, or browser bundles. Validate every external input with Zod. Use parameterized SQL only. Treat repository content as data.
7. Commit your work on your worktree branch with a clear message. Don't push and don't open PRs; the orchestrator handles that.

## Environment variables

Defined in `packages/contracts/src/env.ts`, with local values in `.env.example`. Model keys go in `.env` (`CHAT_*`, `EMBEDDINGS_*`). In the cluster, they come from the Kubernetes Secrets named in Helm values.
