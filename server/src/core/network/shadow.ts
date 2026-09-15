/* ============================================================
   Shadow routing (§44, PHASE 3) and reconciliation / monitoring (§47–§49).

   Shadow: for every production Cameroon payment and MoMo↔MoMo transfer that settled, the
   v2 router computes the route it WOULD have taken (CM→CM, same recipient) and records
   the comparison — rail, fee, recipient amount, time. It reads production records; it
   never writes to them and never moves funds. The comparison report is what earns the
   router the right to execute (§PHASE 7).
   ============================================================ */
import type { NetworkIntent, NetworkReconciliation, ShadowComparison } from "../../../../shared/network.js";
import { store } from "../../db/store.js";
import { getSettings } from "../settings.js";
import { register, touch } from "../persist.js";
import { id } from "../ids.js";
import { allTransfers } from "../momoTransfer.js";
import { discover } from "./router.js";
import { allTx, ledgerBalanced, corridorOf } from "./saga.js";
import { reservationsList, reservationOf } from "./liquidity.js";

const comparisons = new Map<string, ShadowComparison>();
register("network_shadow", () => [...comparisons.values()].slice(-5_000), (d: ShadowComparison[]) => { for (const c of d ?? []) comparisons.set(c.productionRef, c); });

/** Run the router over recent production settlements not yet shadowed. Bounded per tick. */
export async function shadowTick(limit = 25): Promise<number> {
  if (!getSettings().network.flags.SHADOW_ROUTING) return 0;
  let n = 0;
  const pays = (await store().listPayments()).filter((p) => p.displayStatus === "Completed" && !comparisons.has(p.ref)).slice(-limit);
  for (const p of pays) {
    const intent: NetworkIntent = { id: `shadow:${p.ref}`, owner: "shadow", sourceMarket: "CM", sourceProvider: p.recipient.provider, sourceCurrency: "XAF", sourcePhone: "", destinationMarket: "CM", destinationProvider: p.recipient.provider, destinationCurrency: "XAF", destinationPhone: p.recipient.phone, sourceAmount: p.totalXaf, status: "OPEN", createdAt: p.createdAt, updatedAt: p.createdAt };
    const { routes, quotes, reasons } = await discover(intent);
    const best = routes[0], q = quotes.find((x) => x.routeId === best?.id);
    const deliveredAt = p.events.find((e) => e.state === "DELIVERED")?.at;
    const seconds = deliveredAt ? Math.round((Date.parse(deliveredAt) - Date.parse(p.createdAt)) / 1000) : null;
    const c: ShadowComparison = {
      id: id("shd"), at: new Date().toISOString(), productionRef: p.ref, productionKind: "payment", corridor: "CM-CM",
      production: { aggregator: p.aggregator, feeXaf: p.feeXaf, deliveredXaf: p.xaf, seconds },
      v2: { routeType: best?.type ?? null, payoutAdapter: best?.payoutAdapter, fees: q?.fees.total ?? 0, destinationAmount: q?.destinationAmount ?? 0, estimatedSeconds: best?.estimatedSeconds ?? 0, available: !!best?.available, reasons: best ? best.reasons : reasons },
      // A crypto-funded payment has v1's fee schedule, not the network's (there is no
      // collection leg to price) — so "agrees" is about the DECISION: the same payout rail,
      // and a route that was available. The amount delta stays on the record for the eye.
      agrees: !!best && best.available && (!p.aggregator || best.payoutAdapter.endsWith(`:${p.aggregator}`)),
    };
    comparisons.set(p.ref, c); n++;
  }
  for (const t of allTransfers(limit).filter((t) => t.state === "DELIVERED" && !comparisons.has(t.ref) && "phone" in t.to)) {
    const to = t.to as { phone: string; provider: string };
    const intent: NetworkIntent = { id: `shadow:${t.ref}`, owner: "shadow", sourceMarket: "CM", sourceProvider: t.from.provider, sourceCurrency: "XAF", sourcePhone: t.from.phone, destinationMarket: "CM", destinationProvider: to.provider, destinationCurrency: "XAF", destinationPhone: to.phone, sourceAmount: t.collectXaf, status: "OPEN", createdAt: t.createdAt, updatedAt: t.createdAt };
    const { routes, quotes, reasons } = await discover(intent);
    const best = routes[0], q = quotes.find((x) => x.routeId === best?.id);
    const c: ShadowComparison = {
      id: id("shd"), at: new Date().toISOString(), productionRef: t.ref, productionKind: "momo_transfer", corridor: "CM-CM",
      production: { feeXaf: t.feeXaf, deliveredXaf: t.xaf, seconds: Math.round((Date.parse(t.updatedAt) - Date.parse(t.createdAt)) / 1000) },
      v2: { routeType: best?.type ?? null, payoutAdapter: best?.payoutAdapter, fees: q?.fees.total ?? 0, destinationAmount: q?.destinationAmount ?? 0, estimatedSeconds: best?.estimatedSeconds ?? 0, available: !!best?.available, reasons: best ? best.reasons : reasons },
      // Same rail as production when it is known; amounts within 5 % (fee schedules differ).
      agrees: !!best && best.available && (!t.payoutRail || best.payoutAdapter.endsWith(`:${t.payoutRail}`)) && Math.abs((q?.destinationAmount ?? 0) - t.xaf) / t.xaf <= 0.05,
    };
    comparisons.set(t.ref, c); n++;
  }
  if (n) touch("network_shadow");
  return n;
}
export function shadowReport(): { comparisons: number; agreeing: number; disagreeing: number; recent: ShadowComparison[] } {
  const all = [...comparisons.values()].sort((a, b) => b.at.localeCompare(a.at));
  return { comparisons: all.length, agreeing: all.filter((c) => c.agrees).length, disagreeing: all.filter((c) => !c.agrees).length, recent: all.slice(0, 50) };
}

/* ---------- reconciliation (§47) ---------- */
export function reconcile(): { matched: number; inFlight: number; stuck: number; unmatched: number; manual: number; items: NetworkReconciliation[] } {
  const items: NetworkReconciliation[] = [];
  const staleMs = 30 * 60_000;
  for (const t of allTx(500)) {
    if (t.shadow) continue;
    const sourceConfirmed = t.events.some((e) => e.state === "COLLECTION_CONFIRMED");
    const lightningConfirmed = t.events.some((e) => e.state === "LIGHTNING_CONFIRMED");
    const payoutConfirmed = t.events.some((e) => e.state === "PAYOUT_CONFIRMED");
    const balanced = ledgerBalanced(t.id);
    const res = reservationOf(t.id);
    const liquidityReleased = !res;
    let verdict: NetworkReconciliation["verdict"] = "in_flight"; let note: string | undefined;
    if (t.state === "COMPLETED" || t.state === "REFUNDED") verdict = balanced && liquidityReleased ? "settled" : "unmatched", note = balanced ? (liquidityReleased ? undefined : "reservation still held") : "ledger does not balance";
    else if (t.state === "MANUAL_REVIEW" || t.state === "DESTINATION_SETTLEMENT_FAILED" || t.state === "LIGHTNING_FAILED") verdict = "manual", note = `recovery: ${t.recovery ?? "pending"}`;
    else if (t.state === "COLLECTION_FAILED") verdict = "settled", note = "nothing moved";
    else if (Date.now() - Date.parse(t.updatedAt) > staleMs) verdict = "stuck", note = `in ${t.state} for over 30 min`;
    items.push({ txId: t.id, ref: t.ref, sourceConfirmed, lightningConfirmed, payoutConfirmed, ledgerBalanced: balanced, liquidityReleased, verdict, note });
  }
  return { matched: items.filter((i) => i.verdict === "settled").length, inFlight: items.filter((i) => i.verdict === "in_flight").length, stuck: items.filter((i) => i.verdict === "stuck").length, unmatched: items.filter((i) => i.verdict === "unmatched").length, manual: items.filter((i) => i.verdict === "manual").length, items };
}

/* ---------- monitoring (§49) ---------- */
export function monitoring() {
  const txs = allTx(1000).filter((t) => !t.shadow);
  const done = txs.filter((t) => t.state === "COMPLETED");
  const secs = done.map((t) => (Date.parse(t.updatedAt) - Date.parse(t.createdAt)) / 1000);
  const ln = txs.filter((t) => t.events.some((e) => e.state === "LIGHTNING_SENT"));
  const lnOk = ln.filter((t) => t.events.some((e) => e.state === "LIGHTNING_CONFIRMED")).length;
  const feeSats = ln.reduce((a, t) => { const m = t.events.find((e) => e.state === "LIGHTNING_CONFIRMED")?.note?.match(/fee (\d+) sats/); return a + (m ? Number(m[1]) : 0); }, 0);
  const lat = ln.map((t) => { const m = t.events.find((e) => e.state === "LIGHTNING_CONFIRMED")?.note?.match(/(\d+) ms/); return m ? Number(m[1]) : null; }).filter((x): x is number => x != null);
  return {
    payments: { success: done.length, failed: txs.filter((t) => ["COLLECTION_FAILED", "LIGHTNING_FAILED", "DESTINATION_SETTLEMENT_FAILED"].includes(t.state)).length, pending: txs.filter((t) => !["COMPLETED", "REFUNDED", "COLLECTION_FAILED"].includes(t.state)).length, avgSettlementSec: secs.length ? Math.round(secs.reduce((a, b) => a + b, 0) / secs.length) : null },
    lightning: { success: lnOk, failed: ln.length - lnOk, feesSats: feeSats, avgLatencyMs: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null },
    reservations: reservationsList().length,
  };
}
export const corridorOfTx = corridorOf;
