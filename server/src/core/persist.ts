/* ============================================================
   Durable persistence (node:sqlite). Each in-memory collection
   registers a (dump, restore) pair under a key; the working set stays
   in memory (no reader changes) and is snapshotted to SQLite on every
   mutation via touch(key). On boot, register() rehydrates from disk.

   DB_PATH defaults to data/momome.db; tests set it to ":memory:".
   ============================================================ */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const DB_PATH = process.env.DB_PATH ?? "data/momome.db";
if (DB_PATH !== ":memory:") {
  try { mkdirSync(dirname(DB_PATH), { recursive: true }); } catch { /* exists */ }
}

const db = new DatabaseSync(DB_PATH);
db.exec("CREATE TABLE IF NOT EXISTS snapshot (key TEXT PRIMARY KEY, json TEXT NOT NULL)");
const sel = db.prepare("SELECT json FROM snapshot WHERE key = ?");
const up = db.prepare("INSERT INTO snapshot(key, json) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json");

const dumpers = new Map<string, () => unknown>();

/** Restore a collection from disk (if present) and register it for snapshotting. */
export function register<T>(key: string, dump: () => T, restore: (data: T) => void): void {
  const row = sel.get(key) as { json: string } | undefined;
  if (row) {
    try { restore(JSON.parse(row.json) as T); } catch (e) { console.error("persist restore", key, e); }
  }
  dumpers.set(key, dump as () => unknown);
}

/** Snapshot one collection to disk. Called after each mutation. */
export function touch(key: string): void {
  const dump = dumpers.get(key);
  if (!dump) return;
  try { up.run(key, JSON.stringify(dump())); } catch (e) { console.error("persist write", key, e); }
}

/** Flush every collection (used on graceful shutdown). */
export function flushAll(): void {
  for (const key of dumpers.keys()) touch(key);
}
