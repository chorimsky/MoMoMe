/* ============================================================
   Postgres connection + transaction helpers for the serverless backend.
   The pool is lazy (first use) and reads DATABASE_URL from the environment — the
   value is never in code. `withTx` runs a function inside a single BEGIN/COMMIT so
   multi-row money mutations (ledger legs) are all-or-nothing.
   Used by the repositories in ./repo.ts. On serverless, Neon's pooled endpoint keeps
   connection counts sane; PG_POOL_MAX bounds this instance.
   ============================================================ */
import pkg from "pg";
import type { Pool as PoolType, PoolClient } from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const { Pool } = pkg;

let pool: PoolType | null = null;

export function pgPool(): PoolType {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set — Postgres store unavailable");
    pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || "10") });
  }
  return pool;
}

/** Run a parameterised query, returning the rows. */
export async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await pgPool().query(sql, params);
  return res.rows as T[];
}

/** Run `fn` inside a single transaction (BEGIN…COMMIT / ROLLBACK on throw). */
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pgPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* already broken */ }
    throw e;
  } finally {
    client.release();
  }
}

/** Apply schema.sql (idempotent — all CREATE ... IF NOT EXISTS). Run at setup/migrate. */
export async function applySchema(): Promise<void> {
  const sql = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "schema.sql"), "utf8");
  await pgPool().query(sql);
}

/** Close the pool (tests / graceful shutdown). */
export async function pgClose(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
