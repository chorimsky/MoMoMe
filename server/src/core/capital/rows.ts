/* ============================================================
   Per-row durability for the capital collections.

   The modules keep their working set in memory and snapshot it through the
   generic persist seam (SQLite locally; a whole-collection row on Postgres).
   That snapshot is last-writer-wins: two serverless instances editing two
   different investors would each overwrite the other's record. So on Postgres
   every mutation ALSO upserts just the changed rows into `capital_rows`, and
   boot restores the collection from those rows (the complete cross-instance
   set) rather than from the snapshot.

   Change detection is by per-row JSON — an in-process cache of what was last
   written — so a `touch(key)` after a mutation costs one stringify per row
   and one upsert per row that actually changed. Collections are hundreds of
   rows at most, so that is cheap, and the mutation code stays untouched.
   ============================================================ */
import { register as persistRegister, touch as persistTouch } from "../persist.js";
import { store, usingPostgres } from "../../db/store.js";
import { background } from "../background.js";

type Row = { id: string };
interface Coll { rows: () => Row[]; replace: (rows: Row[]) => void; last: Map<string, string> }
const colls = new Map<string, Coll>();

/** The durable backend — the store on Postgres, nothing in memory. Injectable for tests. */
export interface RowBackend { active: () => boolean; upsert: (c: string, id: string, body: unknown) => Promise<void>; remove: (c: string, id: string) => Promise<void>; all: (c: string) => Promise<unknown[]> }
let backend: RowBackend = { active: usingPostgres, upsert: (c, id, b) => store().upsertCapitalRow(c, id, b), remove: (c, id) => store().deleteCapitalRow(c, id), all: (c) => store().allCapitalRows(c) };
export function _setRowBackend(b: RowBackend | null): void { backend = b ?? { active: usingPostgres, upsert: (c, id, x) => store().upsertCapitalRow(c, id, x), remove: (c, id) => store().deleteCapitalRow(c, id), all: (c) => store().allCapitalRows(c) }; }
/** Pending background writes, awaitable by tests and the serverless flush. */
let inflight: Promise<unknown> = Promise.resolve();
export function rowsSettled(): Promise<unknown> { return inflight; }

/** Register a keyed collection: snapshot (as before) + per-row sync on Postgres. */
export function registerRows<T extends Row>(key: string, rows: () => T[], replace: (rows: T[]) => void): void {
  colls.set(key, { rows: rows as () => Row[], replace: replace as (rows: Row[]) => void, last: new Map() });
  persistRegister(key, rows, replace);
}
/** Snapshot the collection and, on Postgres, upsert changed rows / delete removed ones. */
export function touchRows(key: string): void {
  persistTouch(key);
  const c = colls.get(key);
  if (!c || !backend.active()) return;
  const seen = new Set<string>();
  const ops: Array<Promise<void>> = [];
  for (const r of c.rows()) {
    seen.add(r.id);
    const json = JSON.stringify(r);
    if (c.last.get(r.id) !== json) { c.last.set(r.id, json); ops.push(backend.upsert(key, r.id, r)); }
  }
  for (const id of [...c.last.keys()]) if (!seen.has(id)) { c.last.delete(id); ops.push(backend.remove(key, id)); }
  if (ops.length) { const p = Promise.all(ops).then(() => undefined).catch((e) => console.error(`[capital_rows] ${key}`, e)); inflight = inflight.then(() => p); background(p); }
}
/** Boot (Postgres only): rows win over the snapshot. Runs after hydrateSnapshots. */
export async function hydrateCapitalRows(): Promise<void> {
  if (!backend.active()) return;
  for (const [key, c] of colls) {
    try {
      const rows = (await backend.all(key)) as Row[];
      if (rows.length === 0) continue; // nothing per-row yet (first deploy) — keep the snapshot's content
      c.replace(rows);
      c.last = new Map(rows.map((r) => [r.id, JSON.stringify(r)]));
    } catch (e) { console.error(`[capital_rows] hydrate ${key}`, e); }
  }
}
