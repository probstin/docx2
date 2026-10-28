import pg from "pg";

/** Anything that can run a query: a Pool or a checked-out/transaction client. */
export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export type Pool = pg.Pool;

export interface CreatePoolOptions {
  /** Override TLS settings, e.g. `{ ca, rejectUnauthorized: true }` for `verify-full`. */
  ssl?: pg.ClientConfig["ssl"];
  max?: number;
  /** Override the database; everything else comes from the libpq `PG*` env vars. */
  database?: string;
}

/** Create a pool configured from `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD`/`PGDATABASE`/`PGSSLMODE`. */
export function createPool(options: CreatePoolOptions = {}): Pool {
  const config: pg.PoolConfig = {};
  if (options.ssl !== undefined) config.ssl = options.ssl;
  if (options.max !== undefined) config.max = options.max;
  if (options.database !== undefined) config.database = options.database;
  return new pg.Pool(config);
}

/** Run `fn` in a transaction on a dedicated connection; rolls back on throw. */
export async function withTransaction<T>(pool: Pool, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } finally {
    client.release();
  }
}

/** Open a transaction when given a Pool; reuse the caller's transaction when given a client. */
export async function inTransaction<T>(db: Queryable | Pool, fn: (tx: Queryable) => Promise<T>): Promise<T> {
  if (db instanceof pg.Pool) return withTransaction(db, fn);
  return fn(db);
}

export class StorageError extends Error {
  constructor(
    readonly code: "INVALID_EMBEDDING" | "RELEASE_NOT_FOUND" | "INVALID_ARGUMENT",
    message: string,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

export function isPgError(err: unknown, code: string): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === code;
}

/** Outcome of a guarded state change. */
export type GuardedResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "not_found" | "invalid_transition" | "lost_race"; current?: string };
