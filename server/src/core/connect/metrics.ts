/* ============================================================
   MoMo›Me Connect — the network's own numbers (§49: optimise for REACHABILITY) and the
   treasury view over MPI balances (§22). Read-only over the domain stores and the ledger.
   ============================================================ */
import { listMpis, type Mpi } from "./identities.js";
import { balanceOf } from "./ledger.js";
import { allIntentsForMetrics } from "./intents.js";
import { allPayoutsForMetrics } from "./payouts.js";
import { allSettlementIntents } from "./settlements.js";
import { counterpartiesAll } from "./counterparties.js";
import { treasuryView } from "../platform/liquidity.js";
import { balance } from "../ledger.js";

const connected = (m: Mpi) => !!m.orgId || m.type === "merchant" || m.aliases.some((a) => a.verified && a.type !== "momome_id" && a.type !== "lightning_address");

export function networkMetrics(sinceMs = 30 * 86_400_000) {
  const since = Date.now() - sinceMs;
  const mpis = listMpis(); const conn = mpis.filter(connected);
  const intents = allIntentsForMetrics().filter((i) => Date.parse(i.createdAt) >= since);
  const done = intents.filter((i) => i.status === "completed");
  const byRoute: Record<string, number> = {}; for (const i of done) byRoute[i.route?.kind ?? "unknown"] = (byRoute[i.route?.kind ?? "unknown"] ?? 0) + 1;
  const latencies = done.map((i) => { const c = i.events.find((e) => e.status === "completed"); return c ? Date.parse(c.at) - Date.parse(i.createdAt) : NaN; }).filter((x) => Number.isFinite(x));
  const payouts = allPayoutsForMetrics().filter((p) => Date.parse(p.createdAt) >= since);
  const lightningVolume = done.filter((i) => i.route?.method === "lightning").reduce((s, i) => s + i.amount.value, 0) + payouts.filter((p) => p.status === "completed" && p.destination.type === "lightning").reduce((s, p) => s + p.amount.value, 0);
  const externalSettlement = allSettlementIntents(5000).filter((s) => s.status === "settled" && s.method !== "momo_me" && Date.parse(s.createdAt) >= since).reduce((s, x) => s + x.amountXaf, 0) + done.filter((i) => i.execution?.kind !== "internal_ledger").reduce((s, i) => s + i.amount.value, 0);
  const feeXaf = done.reduce((s, i) => s + Math.round(i.amount.value * 0.015), 0); // indicative: routing cost proxy is the platform fee at the developer rate
  return {
    window_days: Math.round(sinceMs / 86_400_000),
    connected_institutions: new Set(conn.map((m) => m.orgId).filter(Boolean)).size,
    connected_businesses: conn.filter((m) => m.type !== "individual").length,
    payment_identities: mpis.length,
    reachable_external_endpoints: mpis.filter((m) => !connected(m)).length + counterpartiesAll().filter((c) => !c.linkedMpi).length,
    successful_routes: done.length, routes_by_kind: byRoute,
    internal_transaction_pct: done.length ? Math.round((100 * (byRoute.internal ?? 0)) / done.length) : 0,
    lightning_volume_xaf: lightningVolume, external_settlement_volume_xaf: externalSettlement,
    average_payment_latency_ms: latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null,
    average_routing_cost_xaf: done.length ? Math.round(feeXaf / done.length) : null,
    intents: { created: intents.length, completed: done.length, failed: intents.filter((i) => i.status === "failed").length, expired: intents.filter((i) => i.status === "expired").length, reversed: intents.filter((i) => i.status === "reversed").length },
    payouts: { total: payouts.length, completed: payouts.filter((p) => p.status === "completed").length, lightning: payouts.filter((p) => p.destination.type === "lightning").length },
  };
}

/** Treasury over identity balances: what we owe (liabilities) versus what the float holds. */
export async function connectTreasury() {
  const mpis = listMpis().map((m) => ({ id: m.id, name: m.displayName, type: m.type, org: m.orgId ?? null, balance: balanceOf(m.id), settlement: m.settlement.preferred, frequency: m.settlement.frequency })).filter((x) => x.balance !== 0).sort((a, b) => b.balance - a.balance);
  const liabilities = mpis.reduce((s, x) => s + x.balance, 0);
  const float = await treasuryView();
  const pendingSettlements = allSettlementIntents(5000).filter((s) => ["pending", "processing", "submitted"].includes(s.status));
  return {
    identity_balances_total_xaf: liabilities, identities_with_balance: mpis.length, top: mpis.slice(0, 25),
    settlement_pending_xaf: pendingSettlements.reduce((s, x) => s + x.amountXaf, 0), settlement_pending_count: pendingSettlements.length, bank_queue: pendingSettlements.filter((s) => s.method === "bank_transfer").length,
    float, connect_clearing_xaf: Math.round(-balance("connect_clearing", "XAF")),
    coverage_pct: float.total ? Math.round((100 * float.total) / Math.max(1, liabilities)) : null,
  };
}
