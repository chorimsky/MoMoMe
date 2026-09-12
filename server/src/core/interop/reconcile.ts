/* ============================================================
   Reconciliation report — our records against the provider's, for what the provider can
   list. Today that is IBEX's deposit list (USDT / USDC / on-chain BTC), the same list the
   deposit reconcile settles from; the report shows what it settled, what it could not
   attribute, and what does not add up.

   Payouts, the other direction: a provider with a statement (Peexit: every request of the
   last 3 days) is read as a list, so a payout WE have no record of shows up as
   missing_internal — money left the float without a payment behind it. A provider with
   only per-payout status (PawaPay) is re-queried for each of our payouts in the window.
   Either way the provider's final status is compared with our payment state; a
   disagreement is state_mismatch: we say DELIVERED and they say FAILED means a recipient
   we told "paid" was not, and the reverse means money went out for a payment we refunded.
   The report never changes a payment — reconcileStuckPayouts settles; this one tells.
   ============================================================ */
import type { ReconciliationRecord, ReconciliationReport } from "../../../../shared/interop.js";
import { activeRails } from "../../adapters/index.js";
import { store } from "../../db/store.js";
import { listUnattributed } from "../unattributed.js";
import { PAYOUTS } from "../../adapters/payouts.js";
import type { PayoutStatus } from "../../adapters/payouts.js";
import type { Payment } from "../../../../shared/types.js";
import { notify } from "../notifications.js";
import { register, touch } from "../persist.js";

/** What a provider's final payout status means against our payment state. Pure. */
export function payoutVerdict(state: Payment["state"], provider: PayoutStatus | null): { verdict: ReconciliationRecord["verdict"]; detail?: string } {
  if (provider === null) return { verdict: "pending", detail: "provider has no record yet" };
  const paidOut = state === "DELIVERED";
  const notPaid = state === "FAILED" || state === "REFUNDED" || state === "REFUND_PENDING";
  if (provider === "PENDING") return state === "PAYOUT_REQUESTED" ? { verdict: "pending" } : paidOut ? { verdict: "state_mismatch", detail: "we show DELIVERED, provider still pending" } : { verdict: "pending", detail: `provider pending, we show ${state}` };
  if (provider === "COMPLETED") return paidOut ? { verdict: "matched" } : notPaid ? { verdict: "state_mismatch", detail: `provider PAID but we show ${state} — recipient paid AND sender refunded?` } : { verdict: "pending", detail: `provider PAID, we show ${state} — settle pending` };
  // FAILED at the provider
  return paidOut ? { verdict: "state_mismatch", detail: "we show DELIVERED, provider says FAILED — recipient not paid" } : notPaid ? { verdict: "matched" } : { verdict: "pending", detail: `provider FAILED, we show ${state} — refund pending` };
}

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

  // ---- payouts: the provider's statement against our payments, then per-payment re-query
  // for providers without a statement. Only payments that reached a payout, in the window.
  const since = Date.now() - windowDays * 86_400_000;
  const paidWindow = payments.filter((p) => p.payoutRef && ["PAYOUT_REQUESTED", "DELIVERED", "FAILED", "REFUNDED", "REFUND_PENDING"].includes(p.state) && Date.parse(p.updatedAt) >= since);
  const byRef = new Map(payments.map((p) => [p.ref, p] as const));
  const seen = new Set<string>();
  for (const agg of PAYOUTS) {
    if (!agg.configured() || !agg.live()) continue; // a simulated rail has no statement worth a verdict
    if (agg.listPayouts) {
      let rows; try { rows = await agg.listPayouts(); } catch { continue; }
      for (const row of rows) {
        const p = byRef.get(row.ref);
        if (!p) { records.push({ scope: "payouts", provider: agg.name, asset: "XAF", externalId: row.providerRef ?? row.ref, externalAmount: row.amountXaf ?? 0, internalPaymentRef: null, internalAmount: null, verdict: "missing_internal", detail: `provider holds a payout ${row.ref} (${row.raw ?? row.status}) we have no payment for` }); continue; }
        seen.add(p.id);
        const v = payoutVerdict(p.state, row.status);
        const amountOff = row.amountXaf != null && Math.abs(row.amountXaf - p.xaf) >= 1;
        records.push({ scope: "payouts", provider: agg.name, asset: "XAF", externalId: row.providerRef ?? row.ref, externalAmount: row.amountXaf ?? p.xaf, internalPaymentRef: p.ref, internalAmount: p.xaf, verdict: v.verdict === "matched" && amountOff ? "amount_mismatch" : v.verdict, detail: amountOff ? `provider ${row.amountXaf}, ours ${p.xaf}${v.detail ? `; ${v.detail}` : ""}` : v.detail });
      }
    }
    // Re-query what the statement did not cover (or everything, for a rail without one).
    let budget = 200;
    for (const p of paidWindow) {
      if (seen.has(p.id) || (p.aggregator ?? "peexit") !== agg.name || budget-- <= 0) continue;
      let st: PayoutStatus | null = null;
      try { st = await agg.queryStatus(p.ref); } catch { st = null; }
      const v = payoutVerdict(p.state, st);
      records.push({ scope: "payouts", provider: agg.name, asset: "XAF", externalId: p.payoutRef ?? p.ref, externalAmount: p.xaf, internalPaymentRef: p.ref, internalAmount: p.xaf, verdict: v.verdict, detail: v.detail });
      seen.add(p.id);
    }
  }
  const totals: ReconciliationReport["totals"] = { matched: 0, missing_internal: 0, amount_mismatch: 0, unattributed: 0, pending: 0, state_mismatch: 0 };
  for (const r of records) totals[r.verdict]++;
  return { generatedAt: new Date().toISOString(), windowDays, totals, records };
}

/* ---------- the sweep: a mismatch is told to a person, once ---------- */
const alerted = new Set<string>();
register("recon_alerts", () => [...alerted].slice(-2000), (d: string[]) => { for (const k of d ?? []) alerted.add(k); });
let lastSweepAt = 0;
/** Run the payout/deposit report on a slow cadence and notify the operator of every NEW
 *  money-relevant verdict (state_mismatch, missing_internal, amount_mismatch). Each
 *  external id is alerted once; the report itself stays the source of truth. */
export async function reconciliationSweep(now = Date.now(), everyMs = 6 * 3600_000): Promise<number> {
  if (now - lastSweepAt < everyMs) return 0;
  lastSweepAt = now;
  const rep = await reconciliationReport(3);
  let sent = 0;
  for (const r of rep.records) {
    if (!["state_mismatch", "missing_internal", "amount_mismatch"].includes(r.verdict)) continue;
    const key = `${r.scope}:${r.provider}:${r.externalId}:${r.verdict}`;
    if (alerted.has(key)) continue;
    alerted.add(key); sent++;
    await notify({ kind: "reconciliation_mismatch", audience: "operator", body: `Reconciliation (${r.scope}, ${r.provider}): ${r.verdict.replace("_", " ")} on ${r.internalPaymentRef ?? r.externalId} — ${r.detail ?? `provider ${r.externalAmount} ${r.asset}, ours ${r.internalAmount ?? "none"}`}. Admin → Rails → Interoperability.` }).catch(() => {});
  }
  if (sent) touch("recon_alerts");
  return sent;
}
