#!/usr/bin/env node
import { createPool } from "../db.js";
import { migrate } from "../migrate.js";

const pool = createPool({ max: 2 });
try {
  await migrate(pool, { log: (m) => console.log(`[migrate] ${m}`) });
} catch (err) {
  console.error(`[migrate] ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await pool.end();
}
