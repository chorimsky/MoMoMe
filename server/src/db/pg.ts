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
import { SCHEMA_SQL } from "./schema.js";

const { Pool } = pkg;

let pool: PoolType | null = null;

export function pgPool(): PoolType {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set — Postgres store unavailable");
    // Managed serverless Postgres (Neon/Supabase/RDS/…) requires TLS; a plain local
    // Postgres does not (and would REJECT an SSL handshake). Enable TLS only when the URL
    // signals it, and don't verify the chain (Neon's pooler cert isn't in Node's default CA).
    const needsSsl = /sslmode=(require|verify)|channel_binding|neon\.tech|supabase\.co|amazonaws\.com|render\.com|\.tech\//.test(connectionString);
    pool = new Pool({
      connectionString,
      max: Number(process.env.PG_POOL_MAX || "10"),
      // Every one of these bounds a way the pool could HANG rather than fail. Without
      // connectionTimeoutMillis, pool.connect() waits forever when every connection is
      // checked out — a request that never answers, which is strictly worse than an error
      // because the caller cannot retry or report. statement_timeout bounds a single query;
      // idle_in_transaction_session_timeout reclaims a transaction whose holder died
      // mid-flight (lockPayment holds one across external rail calls, so this is the
      // difference between a transient failure and a permanently poisoned pool).
      connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS || "8000"),
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS || "15000"),
      idle_in_transaction_session_timeout: Number(process.env.PG_IDLE_TX_TIMEOUT_MS || "30000"),
      ...(needsSsl ? { ssl: { rejectUnauthorized: false } } : {}),
    });
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

/** Apply the schema (idempotent — all CREATE ... IF NOT EXISTS). Uses the inlined DDL
 *  (SCHEMA_SQL) so it works in a serverless bundle with no schema.sql file on disk. */
export async function applySchema(): Promise<void> {
  await pgPool().query(SCHEMA_SQL);
}

/** Close the pool (tests / graceful shutdown). */
export async function pgClose(): Promise<void> {
  if (pool) { await pool.end(); pool = null; }
}
