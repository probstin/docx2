import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "./db.js";

/** Fixed advisory-lock key for the migration runner. */
export const MIGRATION_LOCK_KEY = "7164390001";

/** Resolved relative to the package root so it works from both `src/` and `dist/`. */
export const DEFAULT_MIGRATIONS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "migrations",
);

export interface MigrateOptions {
  log?: (message: string) => void;
  /** Override the migrations directory (tests). */
  dir?: string;
}

export interface MigrateResult {
  applied: string[];
  alreadyApplied: number;
}

interface MigrationFile {
  version: number;
  name: string;
  file: string;
  sql: string;
  checksum: string;
}

export class MigrationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "MigrationError";
  }
}

async function loadMigrations(dir: string): Promise<MigrationFile[]> {
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const out: MigrationFile[] = [];
  for (const file of files) {
    const m = /^(\d{4})_([a-z0-9_]+)\.sql$/.exec(file);
    if (!m) throw new MigrationError(`invalid migration file name: ${file} (expected NNNN_name.sql)`);
    const sql = await readFile(path.join(dir, file), "utf8");
    out.push({
      version: Number(m[1]),
      name: m[2]!,
      file,
      sql,
      checksum: createHash("sha256").update(sql).digest("hex"),
    });
  }
  return out;
}

/**
 * Apply pending migrations in order. The whole run holds a session-level advisory lock, each
 * migration runs in its own transaction, and a changed checksum on an applied migration aborts.
 */
export async function migrate(pool: Pool, options: MigrateOptions = {}): Promise<MigrateResult> {
  const log = options.log ?? (() => undefined);
  const migrations = await loadMigrations(options.dir ?? DEFAULT_MIGRATIONS_DIR);
  const client = await pool.connect();
  try {
    log("waiting for migration lock");
    await client.query("SELECT pg_advisory_lock($1::bigint)", [MIGRATION_LOCK_KEY]);
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        version int PRIMARY KEY,
        name text NOT NULL,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
      const { rows } = await client.query<{ version: number; checksum: string }>(
        "SELECT version, checksum FROM schema_migrations",
      );
      const appliedByVersion = new Map(rows.map((r) => [r.version, r.checksum]));
      const known = new Set(migrations.map((m) => m.version));
      for (const v of appliedByVersion.keys()) {
        if (!known.has(v)) {
          throw new MigrationError(`applied migration ${v} has no matching file; refusing to continue`);
        }
      }
      const applied: string[] = [];
      for (const m of migrations) {
        const existing = appliedByVersion.get(m.version);
        if (existing !== undefined) {
          if (existing !== m.checksum) {
            throw new MigrationError(
              `checksum mismatch for applied migration ${m.file}; applied migrations must not be edited`,
            );
          }
          continue;
        }
        log(`applying ${m.file}`);
        try {
          await client.query("BEGIN");
          await client.query(m.sql);
          await client.query("INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)", [
            m.version,
            m.name,
            m.checksum,
          ]);
          await client.query("COMMIT");
        } catch (err) {
          await client.query("ROLLBACK").catch(() => undefined);
          const e = err as { code?: string; message?: string };
          if (e.code === "42501" || /extension "vector"/.test(e.message ?? "")) {
            throw new MigrationError(
              `migration ${m.file} failed: ${e.message}. The database role needs privileges to run ` +
                "CREATE EXTENSION vector (superuser or trusted extension), or a DBA must pre-install the " +
                "pgvector extension in this database.",
              { cause: err },
            );
          }
          throw new MigrationError(`migration ${m.file} failed: ${e.message}`, { cause: err });
        }
        applied.push(m.file);
      }
      log(applied.length ? `applied ${applied.length} migration(s)` : "schema up to date");
      return { applied, alreadyApplied: migrations.length - applied.length };
    } finally {
      await client
        .query("SELECT pg_advisory_unlock($1::bigint)", [MIGRATION_LOCK_KEY])
        .catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
