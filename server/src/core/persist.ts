/* ============================================================
   Durable persistence (node:sqlite). Each in-memory collection
   registers a (dump, restore) pair under a key; the working set stays
   in memory (no reader changes) and is snapshotted to SQLite on every
   mutation via touch(key). On boot, register() rehydrates from disk.

   DB_PATH defaults to data/momome.db; tests set it to ":memory:".

   Resilient by design: if node:sqlite is unavailable (older Node) or the
   database can't be opened (read-only filesystem, e.g. serverless), the
   layer degrades to a pure in-memory no-op — the app runs identically,
   state simply isn't persisted across process restarts. Set
   DB_PATH=:memory: to opt into in-memory explicitly.
   ============================================================ */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setSnapshot, allSnapshots, getSnapshot } from "../db/repo.js";
import { background } from "./background.js";

/** Resolve DB_PATH to an ABSOLUTE path off the server package root, not the cwd.
 *  A relative default resolved differently under `pnpm dev` (cwd = repo root) vs
 *  `pnpm --filter @momome/server dev` (cwd = server/), which silently created a
 *  SECOND database — a stray ledger in a settlement system. Anchoring to the package
 *  root (persist.ts is server/src/core/ → ../../.. = server/) makes the path stable
 *  regardless of where the process was launched. `:memory:` passes through untouched. */
const PKG_ROOT = fileURLToPath(new URL("../../", import.meta.url)); // → server/
const RAW_DB_PATH = process.env.DB_PATH ?? "data/momome.db";
const DB_PATH = RAW_DB_PATH === ":memory:" || isAbsolute(RAW_DB_PATH)
  ? RAW_DB_PATH
  : resolve(PKG_ROOT, RAW_DB_PATH);
/** Postgres snapshot backend (serverless): non-money collections persist to the
 *  `snapshots` table instead of local SQLite. Selected by STORE_BACKEND=postgres. */
const PG = (process.env.STORE_BACKEND ?? "").toLowerCase() === "postgres";

interface Stmt { get(key: string): unknown; run(key: string, json: string): void; }
interface Db { exec(sql: string): void; prepare(sql: string): Stmt; }

/** Run `fn` with node:sqlite's "experimental feature" ExperimentalWarning
 *  suppressed (it prints on every start) — all other warnings pass through. */
function withoutSqliteWarning<T>(fn: () => T): T {
  const orig = process.emitWarning.bind(process);
  process.emitWarning = ((w: unknown, ...rest: unknown[]) => {
    const msg = typeof w === "string" ? w : (w as { message?: string } | undefined)?.message;
    if (typeof msg === "string" && msg.includes("SQLite is an experimental feature")) return;
    return (orig as (...a: unknown[]) => void)(w as never, ...rest);
  }) as typeof process.emitWarning;
  try { return fn(); } finally { process.emitWarning = orig; }
}

/** Open SQLite if possible; otherwise return null and run in-memory. */
function openDb(): Db | null {
  try {
    // require() (not static import) so a missing/flag-gated node:sqlite is catchable.
    const require = createRequire(import.meta.url);
    if (DB_PATH !== ":memory:") {
      try { mkdirSync(dirname(DB_PATH), { recursive: true }); } catch { /* exists / read-only */ }
    }
    return withoutSqliteWarning(() => {
      const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (p: string) => Db };
      const db = new DatabaseSync(DB_PATH);
      db.exec("CREATE TABLE IF NOT EXISTS snapshot (key TEXT PRIMARY KEY, json TEXT NOT NULL)");
      return db;
    });
  } catch (e) {
    console.warn(`persist: SQLite unavailable, running in-memory (${e instanceof Error ? e.message : e})`);
    return null;
  }
}

const db = openDb();

/** True when a durable SQLite database is open (state survives restarts). False when
 *  the layer fell back to in-memory (node:sqlite missing / DB not writable) — in which
 *  case a restart loses everything. The boot sequence refuses to run a real-money rail
 *  in that state (see index.ts). */
export function persistDurable(): boolean { return db !== null || PG; }

const sel = db?.prepare("SELECT json FROM snapshot WHERE key = ?") ?? null;
const up = db?.prepare("INSERT INTO snapshot(key, json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json") ?? null;

const dumpers = new Map<string, () => unknown>();
const restorers = new Map<string, (data: unknown) => void>();

/** Register a collection for snapshotting. SQLite: rehydrate synchronously now.
 *  Postgres: restore is DEFERRED to hydrateSnapshots() at boot (a network DB can't be
 *  read synchronously at module-load time). */
export function register<T>(key: string, dump: () => T, restore: (data: T) => void): void {
  dumpers.set(key, dump as () => unknown);
  restorers.set(key, restore as (d: unknown) => void);
  if (!PG && sel) {
    const row = sel.get(key) as { json: string } | undefined;
    if (row) {
      try { restore(JSON.parse(row.json) as T); } catch (e) { console.error("persist restore", key, e); }
    }
  }
}

/** Snapshot one collection after a mutation. SQLite: synchronous write. Postgres:
 *  fire-and-forget write-through (on Vercel, wrap in waitUntil to guarantee it drains
 *  before the instance freezes — TODO for the deploy). No-op in pure in-memory. */
export function touch(key: string): void {
  const dump = dumpers.get(key);
  if (!dump) return;
  if (PG) {
    // waitUntil-backed so the write survives the serverless freeze after the response.
    background(setSnapshot(key, JSON.stringify(dump())));
    return;
  }
  if (!up) return;
  try { up.run(key, JSON.stringify(dump())); } catch (e) { console.error("persist write", key, e); }
}

/** Postgres only: load every snapshot row and restore it into the registered collections.
 *  MUST run at boot AFTER the schema is applied and BEFORE serving requests. No-op on
 *  SQLite (register() already restored synchronously). */
export async function hydrateSnapshots(): Promise<void> {
  if (!PG) return;
  try {
    for (const { key, json } of await allSnapshots()) {
      const restore = restorers.get(key);
      if (restore) { try { restore(json); } catch (e) { console.error("persist hydrate", key, e); } }
    }
  } catch (e) { console.error("persist hydrate all", e); }
}

/** Postgres only: re-read ONE snapshot key from the durable store and restore it into its
 *  registered collection. For CROSS-INSTANCE freshness of config-critical state (settings
 *  kill-switch / payout-approval threshold / watchlist) that a warm serverless instance
 *  would otherwise serve stale from its boot-time hydrate. No-op on SQLite/memory (a single
 *  process is always current). Callers throttle this (short TTL) at money-critical paths. */
export async function rehydrate(key: string): Promise<void> {
  if (!PG) return;
  const restore = restorers.get(key);
  if (!restore) return;
  const json = await getSnapshot(key);
  if (json !== undefined) { try { restore(json); } catch (e) { console.error("persist rehydrate", key, e); } }
}

/** Flush every collection (graceful shutdown / end of a serverless invocation). */
export async function flushAll(): Promise<void> {
  if (PG) {
    await Promise.all([...dumpers.keys()].map((k) => setSnapshot(k, JSON.stringify(dumpers.get(k)!())).catch(() => {})));
    return;
  }
  if (!up) return;
  for (const key of dumpers.keys()) {
    try { up.run(key, JSON.stringify(dumpers.get(key)!())); } catch (e) { console.error("persist write", key, e); }
  }
}
