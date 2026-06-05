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
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH ?? "data/momome.db";

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
const sel = db?.prepare("SELECT json FROM snapshot WHERE key = ?") ?? null;
const up = db?.prepare("INSERT INTO snapshot(key, json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json") ?? null;

const dumpers = new Map<string, () => unknown>();

/** Restore a collection from disk (if present) and register it for snapshotting. */
export function register<T>(key: string, dump: () => T, restore: (data: T) => void): void {
  if (sel) {
    const row = sel.get(key) as { json: string } | undefined;
    if (row) {
      try { restore(JSON.parse(row.json) as T); } catch (e) { console.error("persist restore", key, e); }
    }
  }
  dumpers.set(key, dump as () => unknown);
}

/** Snapshot one collection to disk. Called after each mutation. No-op in-memory. */
export function touch(key: string): void {
  if (!up) return;
  const dump = dumpers.get(key);
  if (!dump) return;
  try { up.run(key, JSON.stringify(dump())); } catch (e) { console.error("persist write", key, e); }
}

/** Flush every collection (used on graceful shutdown). */
export function flushAll(): void {
  for (const key of dumpers.keys()) touch(key);
}
