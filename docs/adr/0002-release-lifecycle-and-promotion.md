# 0002 — Release IDs, build/release state, promotion, and asset retention

**Status:** Accepted (Wave 0). Validated end-to-end in Wave 3.

## Context

PLAN §9 requires immutable revisions, a site and index that always match, recoverable promotion with no cross-resource transaction between the PVC and PostgreSQL, and old HTML that can still load its fingerprinted assets after a switch.

## Decision

**IDs.** `releaseId = <UTC yyyymmddhhmmss>-<sha[0:12]>` (`createReleaseId`). Path-safe and sortable. Used as the PVC directory name and embedded into the generated site.

**Two state machines** (`packages/contracts/src/lifecycle.ts`):

- _Build:_ `RECEIVED → QUEUED → CHECKOUT → BUILDING → INDEXING → VALIDATING → READY → PUBLISHING → PUBLISHED`, plus `FAILED`/`SUPERSEDED`. The PLAN's terminal `ACTIVE` is renamed `PUBLISHED`, because "currently live" belongs to the release, not the build.
- _Release:_ `CANDIDATE → READY → ACTIVE ⇄ INACTIVE → PRUNED`, plus `FAILED`. Exactly one `ACTIVE` release, enforced by a partial unique index.
- The API claims a queued build (`QUEUED → CHECKOUT`, atomically with `FOR UPDATE SKIP LOCKED`) at the moment it dispatches the Job. The builder Job then owns transitions out of `CHECKOUT` through `READY` and writes the release as `CANDIDATE → READY`. The API owns queueing, claiming, `PUBLISHING`, `PUBLISHED`, activation, and pruning.

**PVC layout** follows PLAN §9.3 (`ArtifactLayout`). The builder works in `staging/build-<id>/`, then renames it into `releases/<releaseId>/`. `manifest.json` is written **last**, and a release directory without a valid manifest is treated as garbage.

**Promotion (API, idempotent):**

1. Verify the release is `READY` and its manifest exists and validates.
2. Mark the build `PUBLISHING`.
3. Atomically swap the `current` symlink: create `current.tmp` → `releases/<id>/site`, then `rename()` over `current`.
4. In one DB transaction: old `ACTIVE` → `INACTIVE`, new → `ACTIVE`, build → `PUBLISHED`, and write `release_events`.
   On startup and periodically, the reconciler compares the `current` target with the DB's `ACTIVE` release and repairs whichever side lags (the DB is authoritative, provided the release still has a valid manifest).

**Asset retention.** Docusaurus emits content-hashed files under `assets/`. During staging the builder also copies them, without overwriting, into `shared-assets/`. The `web` server resolves `/assets/*` from `current/` first and falls back to `shared-assets/`, so HTML loaded just before a switch can still fetch its JS/CSS. Each manifest lists its `hashedAssets`. GC deletes a shared asset only when no non-`PRUNED` release references it.

**Serving.** `web` (nginx) roots at `/data/current` with `open_file_cache off`, so it follows the symlink on every request. The DB never "switches" nginx; only the symlink does.

## Consequences

Rollback is the same promotion run against an `INACTIVE` release. Retention (`PUBLISHING_RETAIN_REVISIONS`) prunes the oldest `INACTIVE` releases: their artifacts, then their chunks, then the row is marked `PRUNED`.
