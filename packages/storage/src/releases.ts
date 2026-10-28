import {
  CHAT_QUERYABLE_RELEASE_STATUSES,
  ReleaseManifestSchema,
  canTransitionRelease,
  type ReleaseEventType,
  type ReleaseManifest,
  type ReleaseStatus,
  type ReleaseSummary,
} from "@docs-platform/contracts";
import { inTransaction, isPgError, type GuardedResult, type Pool, type Queryable } from "./db.js";

interface ReleaseRow {
  id: string;
  git_sha: string;
  status: ReleaseStatus;
  artifact_path: string;
  embedding_model: string;
  embedding_dimensions: number;
  docs_yaml: unknown;
  manifest: ReleaseManifest | null;
  created_at: Date;
  ready_at: Date | null;
  activated_at: Date | null;
  deactivated_at: Date | null;
  pruned_at: Date | null;
}

/** Full release record (superset of the `ReleaseSummary` DTO). */
export interface ReleaseRecord extends ReleaseSummary {
  artifactPath: string;
  embeddingModel: string;
  embeddingDimensions: number;
  docsYaml: unknown;
  manifest: ReleaseManifest | null;
  readyAt: string | null;
  deactivatedAt: string | null;
  prunedAt: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function toRecord(r: ReleaseRow): ReleaseRecord {
  return {
    id: r.id,
    gitSha: r.git_sha,
    status: r.status,
    createdAt: r.created_at.toISOString(),
    activatedAt: iso(r.activated_at),
    artifactPath: r.artifact_path,
    embeddingModel: r.embedding_model,
    embeddingDimensions: r.embedding_dimensions,
    docsYaml: r.docs_yaml,
    manifest: r.manifest,
    readyAt: iso(r.ready_at),
    deactivatedAt: iso(r.deactivated_at),
    prunedAt: iso(r.pruned_at),
  };
}

export function toReleaseSummary(r: ReleaseRecord): ReleaseSummary {
  return { id: r.id, gitSha: r.gitSha, status: r.status, createdAt: r.createdAt, activatedAt: r.activatedAt };
}

const RELEASE_COLUMNS = `id, git_sha, status, artifact_path, embedding_model, embedding_dimensions,
  docs_yaml, manifest, created_at, ready_at, activated_at, deactivated_at, pruned_at`;

export async function recordReleaseEvent(
  db: Queryable,
  releaseId: string,
  type: ReleaseEventType,
  details: Record<string, unknown> = {},
): Promise<void> {
  await db.query("INSERT INTO release_events (release_id, type, details) VALUES ($1, $2, $3::jsonb)", [
    releaseId,
    type,
    JSON.stringify(details),
  ]);
}

export interface CreateCandidateReleaseInput {
  id: string;
  gitSha: string;
  artifactPath: string;
  embeddingModel: string;
  embeddingDimensions: number;
  docsYaml: unknown;
}

export async function createCandidateRelease(
  db: Queryable | Pool,
  input: CreateCandidateReleaseInput,
): Promise<ReleaseRecord> {
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<ReleaseRow>(
      `INSERT INTO releases (id, git_sha, status, artifact_path, embedding_model, embedding_dimensions, docs_yaml)
       VALUES ($1, $2, 'CANDIDATE', $3, $4, $5, $6::jsonb) RETURNING ${RELEASE_COLUMNS}`,
      [
        input.id,
        input.gitSha,
        input.artifactPath,
        input.embeddingModel,
        input.embeddingDimensions,
        JSON.stringify(input.docsYaml),
      ],
    );
    await recordReleaseEvent(tx, input.id, "CREATED", { gitSha: input.gitSha });
    return toRecord(rows[0]!);
  });
}

/** Guarded status change used by ready/fail/prune; `extra` is a trusted SQL fragment of SET clauses. */
async function guardedReleaseUpdate(
  tx: Queryable,
  id: string,
  allowedFrom: readonly ReleaseStatus[],
  to: ReleaseStatus,
  setSql: string,
  params: unknown[],
): Promise<GuardedResult<ReleaseRecord & { from: ReleaseStatus }>> {
  const cur = await tx.query<{ status: ReleaseStatus }>(
    "SELECT status FROM releases WHERE id = $1 FOR UPDATE",
    [id],
  );
  const from = cur.rows[0]?.status;
  if (!from) return { ok: false, reason: "not_found" };
  if (!allowedFrom.includes(from) || !canTransitionRelease(from, to)) {
    return { ok: false, reason: "invalid_transition", current: from };
  }
  const { rows } = await tx.query<ReleaseRow>(
    `UPDATE releases SET status = $2 ${setSql} WHERE id = $1 AND status = $3 RETURNING ${RELEASE_COLUMNS}`,
    [id, to, from, ...params],
  );
  if (!rows[0]) return { ok: false, reason: "lost_race", current: from };
  return { ok: true, value: { ...toRecord(rows[0]), from } };
}

/** CANDIDATE -> READY, storing the validated manifest. */
export async function markReleaseReady(
  db: Queryable | Pool,
  id: string,
  manifest: ReleaseManifest,
): Promise<GuardedResult<ReleaseRecord>> {
  const parsed = ReleaseManifestSchema.parse(manifest);
  return inTransaction(db, async (tx): Promise<GuardedResult<ReleaseRecord>> => {
    const res = await guardedReleaseUpdate(
      tx,
      id,
      ["CANDIDATE"],
      "READY",
      ", manifest = $4::jsonb, ready_at = clock_timestamp()",
      [JSON.stringify(parsed)],
    );
    if (!res.ok) return res;
    await recordReleaseEvent(tx, id, "VALIDATED");
    return res;
  });
}

/** CANDIDATE -> FAILED. */
export async function failRelease(
  db: Queryable | Pool,
  id: string,
  reason: string,
): Promise<GuardedResult<ReleaseRecord>> {
  return inTransaction(db, async (tx): Promise<GuardedResult<ReleaseRecord>> => {
    const res = await guardedReleaseUpdate(tx, id, ["CANDIDATE"], "FAILED", "", []);
    if (!res.ok) return res;
    await recordReleaseEvent(tx, id, "FAILED", { reason });
    return res;
  });
}

export async function getRelease(db: Queryable, id: string): Promise<ReleaseRecord | null> {
  const { rows } = await db.query<ReleaseRow>(`SELECT ${RELEASE_COLUMNS} FROM releases WHERE id = $1`, [id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function getActiveRelease(db: Queryable): Promise<ReleaseRecord | null> {
  const { rows } = await db.query<ReleaseRow>(
    `SELECT ${RELEASE_COLUMNS} FROM releases WHERE status = 'ACTIVE'`,
  );
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function listReleases(db: Queryable, opts: { limit?: number } = {}): Promise<ReleaseRecord[]> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 50), 1), 500);
  const { rows } = await db.query<ReleaseRow>(
    `SELECT ${RELEASE_COLUMNS} FROM releases ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit],
  );
  return rows.map(toRecord);
}

/** True when chat may query this release's chunks (ACTIVE or INACTIVE). */
export async function isChatQueryable(db: Queryable, releaseId: string): Promise<boolean> {
  const { rows } = await db.query<{ status: ReleaseStatus }>("SELECT status FROM releases WHERE id = $1", [
    releaseId,
  ]);
  const status = rows[0]?.status;
  return status !== undefined && CHAT_QUERYABLE_RELEASE_STATUSES.includes(status);
}

export interface ActivationOutcome {
  release: ReleaseRecord;
  /** The release that was deactivated, if any. */
  previous: ReleaseRecord | null;
  /** False when the target was already ACTIVE (idempotent no-op). */
  changed: boolean;
  rolledBack: boolean;
}

const ACTIVATION_LOCK = "docs-platform:release-activation";

/**
 * One transaction: old ACTIVE -> INACTIVE, target (READY or INACTIVE) -> ACTIVE, release_events
 * written. Idempotent when the target is already ACTIVE. Serialized by an advisory xact lock.
 */
export async function activateRelease(
  db: Queryable | Pool,
  id: string,
): Promise<GuardedResult<ActivationOutcome>> {
  try {
    return await inTransaction(db, async (tx): Promise<GuardedResult<ActivationOutcome>> => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ACTIVATION_LOCK]);
      const target = await tx.query<ReleaseRow>(
        `SELECT ${RELEASE_COLUMNS} FROM releases WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const t = target.rows[0];
      if (!t) return { ok: false, reason: "not_found" };
      if (t.status === "ACTIVE") {
        return {
          ok: true,
          value: { release: toRecord(t), previous: null, changed: false, rolledBack: false },
        };
      }
      if (!canTransitionRelease(t.status, "ACTIVE")) {
        return { ok: false, reason: "invalid_transition", current: t.status };
      }
      const old = await tx.query<ReleaseRow>(
        `UPDATE releases SET status = 'INACTIVE', deactivated_at = clock_timestamp()
         WHERE status = 'ACTIVE' RETURNING ${RELEASE_COLUMNS}`,
      );
      const prev = old.rows[0] ?? null;
      const upd = await tx.query<ReleaseRow>(
        `UPDATE releases SET status = 'ACTIVE', activated_at = clock_timestamp(), deactivated_at = NULL
         WHERE id = $1 AND status = $2 RETURNING ${RELEASE_COLUMNS}`,
        [id, t.status],
      );
      if (!upd.rows[0]) return { ok: false, reason: "lost_race", current: t.status };
      const rolledBack = t.status === "INACTIVE";
      await recordReleaseEvent(tx, id, "ACTIVATED", { from: t.status, previous: prev?.id ?? null });
      if (rolledBack) await recordReleaseEvent(tx, id, "ROLLED_BACK", { previous: prev?.id ?? null });
      if (prev) await recordReleaseEvent(tx, prev.id, "DEACTIVATED", { replacedBy: id });
      return {
        ok: true,
        value: {
          release: toRecord(upd.rows[0]),
          previous: prev ? toRecord({ ...prev, status: "INACTIVE" }) : null,
          changed: true,
          rolledBack,
        },
      };
    });
  } catch (err) {
    // Unique-index violation on the single-ACTIVE invariant: someone else won.
    if (isPgError(err, "23505")) return { ok: false, reason: "lost_race" };
    throw err;
  }
}

/**
 * Oldest INACTIVE releases beyond the newest `retain` non-pruned releases. Never the ACTIVE
 * release, never anything referenced by an open (non-terminal) build.
 */
export async function listPrunableReleases(db: Queryable, retain: number): Promise<ReleaseRecord[]> {
  const keep = Math.max(Math.trunc(retain), 0);
  const { rows } = await db.query<ReleaseRow>(
    `SELECT ${RELEASE_COLUMNS} FROM (
       SELECT r.*, row_number() OVER (ORDER BY created_at DESC, id DESC) AS rn
       FROM releases r WHERE status <> 'PRUNED'
     ) ranked
     WHERE rn > $1 AND status = 'INACTIVE'
       AND NOT EXISTS (
         SELECT 1 FROM builds b WHERE b.release_id = ranked.id
           AND b.status NOT IN ('PUBLISHED','FAILED','SUPERSEDED'))
     ORDER BY created_at, id`,
    [keep],
  );
  return rows.map(toRecord);
}

/** Mark PRUNED and delete the release's documents and chunks. */
export async function markReleasePruned(
  db: Queryable | Pool,
  id: string,
): Promise<GuardedResult<ReleaseRecord>> {
  return inTransaction(db, async (tx): Promise<GuardedResult<ReleaseRecord>> => {
    const res = await guardedReleaseUpdate(
      tx,
      id,
      ["READY", "INACTIVE", "FAILED"],
      "PRUNED",
      ", pruned_at = clock_timestamp()",
      [],
    );
    if (!res.ok) return res;
    await tx.query("DELETE FROM document_chunks WHERE release_id = $1", [id]);
    await tx.query("DELETE FROM documents WHERE release_id = $1", [id]);
    await recordReleaseEvent(tx, id, "PRUNED");
    return res;
  });
}

export async function listReleaseEvents(
  db: Queryable,
  releaseId: string,
): Promise<{ type: ReleaseEventType; details: Record<string, unknown>; occurredAt: string }[]> {
  const { rows } = await db.query<{
    type: ReleaseEventType;
    details: Record<string, unknown>;
    occurred_at: Date;
  }>("SELECT type, details, occurred_at FROM release_events WHERE release_id = $1 ORDER BY id", [releaseId]);
  return rows.map((r) => ({ type: r.type, details: r.details, occurredAt: r.occurred_at.toISOString() }));
}
