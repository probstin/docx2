import { randomBytes } from "node:crypto";
import pg from "pg";
import { createPool, type Pool } from "./db.js";

export const hasPg = Boolean(process.env.PGHOST);

/** Create a uniquely named scratch database; returns a pool on it and a cleanup function. */
export async function createTestDatabase(): Promise<{ pool: Pool; name: string; drop: () => Promise<void> }> {
  const name = `storage_test_${randomBytes(6).toString("hex")}`;
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
