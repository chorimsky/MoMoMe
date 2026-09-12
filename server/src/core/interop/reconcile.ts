/* ============================================================
   Reconciliation report — our records against the provider's, for what the provider can
   list. Today that is IBEX's deposit list (USDT / USDC / on-chain BTC), the same list the
   deposit reconcile settles from; the report shows what it settled, what it could not
   attribute, and what does not add up. Payout-side reconciliation stays in
   reconcileStuckPayouts (per-payment authoritative re-query); a listable payout ledger
   from Peexit/PawaPay slots in here the same way.
   ============================================================ */
import type { ReconciliationRecord, ReconciliationReport } from "../../../../shared/interop.js";
import { activeRails } from "../../adapters/index.js";
import { store } from "../../db/store.js";
import { listUnattributed } from "../unattributed.js";

export async function reconciliationReport(windowDays = 3): Promise<ReconciliationReport> {
  const records: ReconciliationRecord[] = [];
  const payments = await store().listPayments();
  const unattributed = listUnattributed();
  for (const rail of activeRails()) {
    if (!rail.listDeposits || !rail.configured()) continue;
    let deposits;
    try { deposits = await rail.listDeposits(); } catch { continue; }
    for (const d of deposits) {
      const p = payments.find((x) => (x.inboundEventIds ?? []).includes(d.id));
      if (p) {
        const booked = (await store().entriesFor(p.id)).filter((e) => e.account === "inbound_clearing" && e.direction === "debit").reduce((a, e) => a + e.amount, 0);
        const ok = Math.abs(booked - d.amount) < Math.max(1e-9, d.amount * 0.001);
        records.push({ scope: "deposits", provider: rail.name, asset: d.asset, externalId: d.id, externalAmount: d.amount, internalPaymentRef: p.ref, internalAmount: booked, verdict: ok ? "matched" : "amount_mismatch", detail: ok ? undefined : `booked ${booked}, provider ${d.amount}` });
        continue;
      }
      const u = unattributed.find((x) => x.eventId === d.id);
      if (u) { records.push({ scope: "deposits", provider: rail.name, asset: d.asset, externalId: d.id, externalAmount: d.amount, internalPaymentRef: null, internalAmount: u.amount, verdict: "unattributed", detail: `held as liability ${u.id}` }); continue; }
      records.push({ scope: "deposits", provider: rail.name, asset: d.asset, externalId: d.id, externalAmount: d.amount, internalPaymentRef: null, internalAmount: null, verdict: Date.now() - Date.parse(d.settledAt) < 10 * 60_000 ? "pending" : "missing_internal", detail: d.txHash ? `tx ${d.txHash}` : "no tx hash" });
    }
  }
  const totals: ReconciliationReport["totals"] = { matched: 0, missing_internal: 0, amount_mismatch: 0, unattributed: 0, pending: 0 };
  for (const r of records) totals[r.verdict]++;
  return { generatedAt: new Date().toISOString(), windowDays, totals, records };
}
