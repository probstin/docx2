import {
  canTransitionBuild,
  isTerminalBuildStatus,
  type BuildDetail,
  type BuildStatus,
  type BuildSummary,
  type BuildTrigger,
} from "@docs-platform/contracts";
import {
  StorageError,
  inTransaction,
  isPgError,
  type GuardedResult,
  type Pool,
  type Queryable,
} from "./db.js";

interface BuildRow {
  id: string;
  git_sha: string | null;
  status: BuildStatus;
  trigger: BuildTrigger;
  release_id: string | null;
  k8s_job_name: string | null;
  error: string | null;
  created_at: Date;
  updated_at: Date;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const BUILD_COLUMNS = "id, git_sha, status, trigger, release_id, k8s_job_name, error, created_at, updated_at";

function toSummary(r: BuildRow): BuildSummary {
  return {
    id: r.id,
    gitSha: r.git_sha,
    status: r.status,
    trigger: r.trigger,
    releaseId: r.release_id,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    error: r.error,
  };
}

async function addBuildEvent(db: Queryable, buildId: string, status: BuildStatus, message?: string) {
  await db.query("INSERT INTO build_events (build_id, status, message) VALUES ($1, $2, $3)", [
    buildId,
    status,
    message ?? null,
  ]);
}

export interface CreateBuildInput {
  trigger: BuildTrigger;
  /** Omit for manual builds of a branch head (resolved later). */
  gitSha?: string;
  /** Initial state; defaults to QUEUED. */
  initialStatus?: "RECEIVED" | "QUEUED";
}

export type CreateBuildResult =
  { ok: true; build: BuildSummary } | { ok: false; reason: "duplicate_open"; existing: BuildSummary };

/** Insert a build. A second open build for the same SHA is rejected by a partial unique index. */
export async function createBuild(db: Queryable | Pool, input: CreateBuildInput): Promise<CreateBuildResult> {
  const status = input.initialStatus ?? "QUEUED";
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<BuildRow>(
      `INSERT INTO builds (git_sha, status, trigger) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING RETURNING ${BUILD_COLUMNS}`,
      [input.gitSha ?? null, status, input.trigger],
    );
    const row = rows[0];
    if (!row) {
      const existing = input.gitSha ? await findOpenBuildBySha(tx, input.gitSha) : null;
      if (existing) return { ok: false as const, reason: "duplicate_open" as const, existing };
      throw new Error("createBuild: insert conflicted but no open build was found");
    }
    await addBuildEvent(tx, row.id, status, `created via ${input.trigger}`);
    return { ok: true as const, build: toSummary(row) };
  });
}

export async function findOpenBuildBySha(db: Queryable, gitSha: string): Promise<BuildSummary | null> {
  const { rows } = await db.query<BuildRow>(
    `SELECT ${BUILD_COLUMNS} FROM builds
     WHERE git_sha = $1 AND status NOT IN ('PUBLISHED','FAILED','SUPERSEDED') LIMIT 1`,
    [gitSha],
  );
  return rows[0] ? toSummary(rows[0]) : null;
}

export async function hasPublishedBuildForSha(db: Queryable, gitSha: string): Promise<boolean> {
  const { rowCount } = await db.query(
    "SELECT 1 FROM builds WHERE git_sha = $1 AND status = 'PUBLISHED' LIMIT 1",
    [gitSha],
  );
  return (rowCount ?? 0) > 0;
}

export interface TransitionBuildOptions {
  message?: string;
  error?: string;
  releaseId?: string;
  k8sJobName?: string;
  /** Resolve a previously unknown SHA (manual build of a branch head). */
  gitSha?: string;
}

/**
 * Guarded transition: validates with `canTransitionBuild` and updates only if the row is still in
 * `from`. Returns `lost_race` if another writer moved it first, and `duplicate_open` if `gitSha`
 * is already used by another open build.
 */
export async function transitionBuild(
  db: Queryable | Pool,
  id: string,
  from: BuildStatus,
  to: BuildStatus,
  opts: TransitionBuildOptions = {},
): Promise<GuardedResult<BuildSummary>> {
  if (!canTransitionBuild(from, to)) return { ok: false, reason: "invalid_transition", current: from };
  if (!UUID.test(id)) return { ok: false, reason: "not_found" };
  return inTransaction(db, async (tx): Promise<GuardedResult<BuildSummary>> => {
    // Setting `git_sha` can collide with another open build for that SHA (`builds_open_sha_unique`).
    // A savepoint keeps the caller's transaction usable after the violation.
    await tx.query("SAVEPOINT transition_build");
    let rows: BuildRow[];
    try {
      ({ rows } = await tx.query<BuildRow>(
        `UPDATE builds SET status = $3,
         updated_at = clock_timestamp(),
         error = COALESCE($4, error),
         release_id = COALESCE($5, release_id),
         k8s_job_name = COALESCE($6, k8s_job_name),
         git_sha = COALESCE(git_sha, $7),
         started_at = CASE WHEN $3 = 'CHECKOUT' THEN COALESCE(started_at, clock_timestamp()) ELSE started_at END,
         finished_at = CASE WHEN $8 THEN clock_timestamp() ELSE finished_at END
       WHERE id = $1 AND status = $2
       RETURNING ${BUILD_COLUMNS}`,
        [
          id,
          from,
          to,
          opts.error ?? null,
          opts.releaseId ?? null,
          opts.k8sJobName ?? null,
          opts.gitSha ?? null,
          isTerminalBuildStatus(to),
        ],
      ));
    } catch (err) {
      await tx.query("ROLLBACK TO SAVEPOINT transition_build");
      if (isPgError(err, "23505")) return { ok: false, reason: "duplicate_open" };
      throw err;
    }
    await tx.query("RELEASE SAVEPOINT transition_build");
    const row = rows[0];
    if (!row) {
      const cur = await tx.query<{ status: string }>("SELECT status FROM builds WHERE id = $1", [id]);
      const current = cur.rows[0]?.status;
      return current === undefined
        ? { ok: false, reason: "not_found" }
        : { ok: false, reason: "lost_race", current };
    }
    await addBuildEvent(tx, id, to, opts.message ?? opts.error);
    return { ok: true, value: toSummary(row) };
  });
}

/**
 * Atomically take the oldest QUEUED build (`FOR UPDATE SKIP LOCKED`) and move it to CHECKOUT.
 * Concurrent claimers never receive the same build.
 */
export async function claimNextQueued(
  db: Queryable | Pool,
  opts: { k8sJobName?: string } = {},
): Promise<BuildSummary | null> {
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<BuildRow>(
      `UPDATE builds SET status = 'CHECKOUT', updated_at = clock_timestamp(),
         started_at = COALESCE(started_at, clock_timestamp()),
         k8s_job_name = COALESCE($1, k8s_job_name)
       WHERE id = (
         SELECT id FROM builds WHERE status = 'QUEUED'
         ORDER BY created_at, id FOR UPDATE SKIP LOCKED LIMIT 1)
       RETURNING ${BUILD_COLUMNS}`,
      [opts.k8sJobName ?? null],
    );
    const row = rows[0];
    if (!row) return null;
    await addBuildEvent(tx, row.id, "CHECKOUT", "claimed from queue");
    return toSummary(row);
  });
}

/** Mark QUEUED builds older than `buildId` as SUPERSEDED (coalescing). Returns their ids. */
export async function supersedeQueuedOlderThan(db: Queryable | Pool, buildId: string): Promise<string[]> {
  return inTransaction(db, async (tx) => {
    const { rows } = await tx.query<{ id: string }>(
      `UPDATE builds SET status = 'SUPERSEDED', updated_at = clock_timestamp(), finished_at = clock_timestamp()
       WHERE status = 'QUEUED' AND (created_at, id) < (SELECT created_at, id FROM builds WHERE id = $1)
       RETURNING id`,
      [buildId],
    );
    for (const r of rows) await addBuildEvent(tx, r.id, "SUPERSEDED", `superseded by ${buildId}`);
    return rows.map((r) => r.id);
  });
}

export async function listBuilds(
  db: Queryable,
  opts: { limit: number; cursor?: string },
): Promise<{ items: BuildSummary[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit), 1), 200);
  if (opts.cursor !== undefined) {
    if (!UUID.test(opts.cursor)) throw new StorageError("INVALID_CURSOR", "cursor is not a valid build id");
    const known = await db.query("SELECT 1 FROM builds WHERE id = $1", [opts.cursor]);
    if (known.rowCount === 0) throw new StorageError("INVALID_CURSOR", "cursor does not match any build");
  }
  const { rows } = await db.query<BuildRow>(
    `SELECT ${BUILD_COLUMNS} FROM builds
     WHERE $2::uuid IS NULL OR (created_at, id) < (SELECT created_at, id FROM builds WHERE id = $2::uuid)
     ORDER BY created_at DESC, id DESC LIMIT $1`,
    [limit + 1, opts.cursor ?? null],
  );
  const page = rows.slice(0, limit);
  return {
    items: page.map(toSummary),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}

export async function getBuildDetail(db: Queryable, id: string): Promise<BuildDetail | null> {
  if (!UUID.test(id)) return null;
  const { rows } = await db.query<BuildRow>(`SELECT ${BUILD_COLUMNS} FROM builds WHERE id = $1`, [id]);
  const row = rows[0];
  if (!row) return null;
  const events = await db.query<{ status: BuildStatus; message: string | null; at: Date }>(
    "SELECT status, message, at FROM build_events WHERE build_id = $1 ORDER BY id",
    [id],
  );
  return {
    ...toSummary(row),
    k8sJobName: row.k8s_job_name,
    history: events.rows.map((e) => ({
      status: e.status,
      at: e.at.toISOString(),
      ...(e.message !== null ? { message: e.message } : {}),
    })),
  };
}
