import { randomBytes } from "node:crypto";
import { createPool, type Pool } from "@docs-platform/storage";
import pg from "pg";

/**
 * Same approach as `packages/storage/src/testing.ts` (which that package does not export):
 * a uniquely named scratch database, dropped by `drop()`. Test-only.
 */
export async function createTestDatabase(): Promise<{ pool: Pool; name: string; drop: () => Promise<void> }> {
  const name = `rag_test_${randomBytes(6).toString("hex")}`;
  const admin = new pg.Client();
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  await admin.end();
  const pool = createPool({ database: name, max: 10 });
  return {
    pool,
    name,
    drop: async () => {
      await pool.end();
      const a = new pg.Client();
      await a.connect();
      await a.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await a.end();
    },
  };
}
