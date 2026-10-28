import { copyFile, mkdtemp, readdir, appendFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_MIGRATIONS_DIR, MigrationError, migrate } from "./migrate.js";
import { createTestDatabase, hasPg } from "./testing.js";

describe.skipIf(!hasPg)("migration runner", () => {
  let db: Awaited<ReturnType<typeof createTestDatabase>>;
  let tmp: string;

  beforeAll(async () => {
    db = await createTestDatabase();
    tmp = await mkdtemp(path.join(os.tmpdir(), "migrations-"));
    for (const f of await readdir(DEFAULT_MIGRATIONS_DIR)) {
      await copyFile(path.join(DEFAULT_MIGRATIONS_DIR, f), path.join(tmp, f));
    }
  });
  afterAll(async () => {
    await db?.drop();
    if (tmp) await rm(tmp, { recursive: true, force: true });
  });

  it("runs concurrently from two runners safely, then is idempotent", async () => {
    const [a, b] = await Promise.all([migrate(db.pool, { dir: tmp }), migrate(db.pool, { dir: tmp })]);
    expect(a.applied.length + b.applied.length).toBe((await readdir(tmp)).length);
    const again = await migrate(db.pool, { dir: tmp });
    expect(again.applied).toEqual([]);
    const { rows } = await db.pool.query("SELECT version FROM schema_migrations");
    expect(rows).toHaveLength(1);
  });

  it("detects a changed checksum on an applied migration", async () => {
    await appendFile(path.join(tmp, "0001_init.sql"), "\n-- tampered\n");
    await expect(migrate(db.pool, { dir: tmp })).rejects.toThrow(MigrationError);
    await expect(migrate(db.pool, { dir: tmp })).rejects.toThrow(/checksum mismatch/);
  });
});
