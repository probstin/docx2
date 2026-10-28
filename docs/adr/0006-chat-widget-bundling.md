# 0006 — Chat widget bundling: Docusaurus consumes workspace `dist/`

**Status:** Accepted (Wave 2)

## Context

`@docs-platform/chat-react` and `@docs-platform/contracts` use a `development` export condition that points at TypeScript sources (tsc, tsx and vitest set it). Docusaurus' webpack does not set it for `docusaurus build`, but does add it in development mode (`docusaurus start`), where it would select sources that use `./x.js` imports of `.ts` files and fail to resolve.

## Decision

- Webpack consumes the packages' **built output**. `chat-react` has a real `build` (`tsc` to `dist`, plus `styles.css` copied to `dist`); its `exports` point `./styles.css` at `dist`.
- A small template plugin (`plugins/workspace-bundling.ts`) pins exact webpack aliases for `@docs-platform/contracts`, `@docs-platform/chat-react` and `.../styles.css` to `dist`, so `build` and `start` behave identically regardless of conditions.
- `apps/builder` calls `ensureWorkspaceDist()` before every site build and dev preview. It builds `contracts` and `chat-react` with `tsc` only when `dist` is missing or older than `src`. In an offline builder image, `dist` is produced at image build time (`pnpm build`) and nothing is compiled at run time.
- The template's own `tsc` typecheck keeps the `development` condition (sources), so `pnpm typecheck` needs no prior build. Vitest still runs against sources.
- The widget renders client-only (`BrowserOnly`); static HTML contains only the mount element. The API base path is an operator setting (`apiBasePath` in `platform.generated.json`, default `/api/v1`), not a `docs.yaml` field.

## Alternatives rejected

A webpack plugin that transpiles workspace TypeScript sources with extension aliases and extra resolve conditions needs source packages (and their dev toolchain) inside the builder image and couples the site to every package's source layout.

## Consequences

Build order matters: `contracts` before `chat-react` (`pnpm build` already does this). The hashed `assets/` output required by ADR 0002 is unchanged.
