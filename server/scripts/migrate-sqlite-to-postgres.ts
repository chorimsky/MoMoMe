/* ============================================================
   One-time cutover: SQLite (the single-container live store) → Postgres.

   What moves:
   · every key→JSON snapshot (settings, identities, devices, merchants, routing health,
     network state, …) → the `snapshots` table, so hydrateSnapshots() restores it at boot;
   · the money collections that Postgres keeps PER ROW: payments (+ provider-ref index),
     the ledger (regrouped by journal txn), the compliance chain, network ledger legs and
     transactions. All writes are upserts / ON CONFLICT DO NOTHING — re-runnable.

   Run with the SAME code version on both sides, with the live server STOPPED (or in
   maintenance: settings.ops.acceptingPayments = false) so nothing lands in SQLite after the
   copy:
     DATABASE_URL=postgres://… node --import tsx scripts/migrate-sqlite-to-postgres.ts data/momome.db [--dry-run]
   Then start the server with STORE_BACKEND=postgres and check /health/deep + Admin → Ops.
   ============================================================ */
import { DatabaseSync } from "node:sqlite";
import type { Payment, LedgerEntry } from "../../shared/types.js";
import type { NetworkLedgerEntry, NetworkTransaction } from "../../shared/network.js";

const file = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!file) { console.error("usage: migrate-sqlite-to-postgres.ts <path/to/momome.db> [--dry-run]"); process.exit(2); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL is required"); process.exit(2); }
process.env.STORE_BACKEND = "postgres";

async function main() {
  const repo = await import("../src/db/repo.js");
  const { applySchema } = await import("../src/db/pg.js");
  const db = new DatabaseSync(file, { readOnly: true });
  const rows = db.prepare("SELECT key, json FROM snapshot").all() as Array<{ key: string; json: string }>;
  console.log(`${rows.length} snapshot key(s) in ${file}${dry ? " — DRY RUN" : ""}`);
  if (!dry) await applySchema();
  const counts: Record<string, number> = {};
  const bump = (k: string, n = 1) => { counts[k] = (counts[k] ?? 0) + n; };

  for (const r of rows) {
    // 1. The snapshot itself (settings and every non-money collection live here).
    if (!dry) await repo.setSnapshot(r.key, r.json);
    bump("snapshots");
    const d = JSON.parse(r.json) as unknown;
    // 2. Per-row money data.
    if (r.key === "store") {
      const s = d as { payments?: [string, Payment][]; refs?: [string, string][] };
      for (const [, p] of s.payments ?? []) { if (!dry) await repo.putPayment(p); bump("payments"); }
      for (const [ref, pid] of s.refs ?? []) { if (!dry) await repo.indexProviderRef(ref, pid).catch(() => {}); bump("provider_refs"); }
    }
    if (r.key === "ledger") {
      const entries = d as LedgerEntry[];
      const byTxn = new Map<string, LedgerEntry[]>();
      for (const e of entries) { const arr = byTxn.get(e.txnId) ?? []; arr.push(e); byTxn.set(e.txnId, arr); }
      for (const [txnId, legs] of byTxn) {
        if (!dry) await repo.recordTxn(legs[0].paymentId, legs.map((l) => ({ account: l.account, direction: l.direction, amount: l.amount, currency: l.currency })), legs[0].at, txnId).catch((e) => { if (!String(e).includes("duplicate")) throw e; });
        bump("ledger_txns");
      }
    }
    if (r.key === "compliance") {
      const c = d as { events?: Array<{ hash: string; prevHash: string; action: string }> };
      for (const ev of c.events ?? []) { if (!dry) await repo.appendComplianceEvent({ id: ev.hash, kind: ev.action, prevHash: ev.prevHash, hash: ev.hash, body: ev }); bump("compliance_events"); }
    }
    if (r.key === "momoops") { for (const op of d as Array<{ id: string; kind: string; status: string; transferId?: string; at: string }>) { if (!dry) await repo.upsertMomoOp(op); bump("momo_ops"); } }
    if (r.key === "network_ledger") { for (const e of d as NetworkLedgerEntry[]) { if (!dry) await repo.appendNetworkLedger(e); bump("network_ledger"); } }
    if (r.key === "network_txs") { for (const t of d as NetworkTransaction[]) { if (!dry) await repo.upsertNetworkTx(t); bump("network_txs"); } }
  }
  console.table(counts);
  console.log(dry ? "Dry run — nothing written." : "Done. Start the server with STORE_BACKEND=postgres and check /health/deep.");
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
