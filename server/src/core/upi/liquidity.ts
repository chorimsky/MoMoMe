/* LiquidityEngine — one view of every pool value can be paid from, and reservations that
   make a route's promise real before anything moves. Pools come from what already tracks
   them: the payout rails' XAF balances (domestic), the network's liquidity sources and
   positions (cross-border), the crypto rails (Lightning / stablecoin positions are held
   at IBEX; reported, not managed, until settlement flags open). AVAILABLE / RESERVED /
   COMMITTED are the network layer's own states; this layer reuses its reservation table so
   a network transaction and a UPI intent can never double-book the same money. */
import { positions, reserve as netReserve, commit as netCommit, release as netRelease, sources } from "../network/liquidity.js";
import { aggregatorFloatXaf, payoutReady } from "../routing.js";
import { PAYOUTS } from "../../adapters/payouts.js";
import type { CountryCode, ProviderId } from "../../../../shared/types.js";
import { config } from "../../config.js";

export interface LiquidityPool {
  id: string; country: string; currency: string; asset: string; network: string | null; provider: string;
  available: number | null; reserved: number; committed: number; minimum: number | null; maximum: number | null;
  status: "AVAILABLE" | "LOW" | "RESERVED_OUT" | "UNAVAILABLE" | "UNKNOWN"; note?: string;
}
export async function pools(): Promise<LiquidityPool[]> {
  const out: LiquidityPool[] = [];
  // Domestic XAF: each configured payout rail is a pool (the money the payout debits).
  for (const r of PAYOUTS.filter((x) => x.configured())) {
    const bal = await r.balance("CM").catch(() => null);
    out.push({ id: `cm:payout:${r.name}`, country: "CM", currency: "XAF", asset: "XAF", network: null, provider: r.name, available: bal, reserved: 0, committed: 0, minimum: null, maximum: null, status: bal == null ? "UNKNOWN" : bal <= 0 ? "UNAVAILABLE" : "AVAILABLE", note: r.live() ? undefined : "sandbox rail" });
  }
  // Network sources (cross-border) with the engine's own reservation accounting.
  for (const p of await positions()) {
    const s = sources().find((x) => x.id === p.sourceId);
    out.push({ id: p.sourceId, country: p.market, currency: p.currency, asset: p.currency, network: s?.settlementMethod === "lightning" ? "LIGHTNING" : null, provider: s?.name ?? p.sourceId, available: p.available, reserved: p.reserved, committed: p.committed, minimum: null, maximum: null, status: p.state === "AVAILABLE" ? "AVAILABLE" : p.state === "DEGRADED" ? "LOW" : p.available == null ? "UNKNOWN" : "UNAVAILABLE", note: p.note });
  }
  return out;
}
/** Can this much be paid out to this operator right now? (domestic) */
export async function domesticCapacity(provider: ProviderId, country: CountryCode, amountXaf: number): Promise<{ ok: boolean; available: number | null; reason?: string }> {
  if (simFloat !== null && config.railsMode === "sandbox") return simFloat >= amountXaf ? { ok: true, available: simFloat } : { ok: false, available: simFloat, reason: `insufficient_rail_balance (simulated float ${simFloat} XAF)` };
  const r = await payoutReady(provider, country, amountXaf, false).catch(() => ({ ok: false, reason: "balance check failed" }));
  return { ok: r.ok, available: await aggregatorFloatXaf().catch(() => null), reason: r.ok ? undefined : r.reason };
}
/** Sandbox rehearsal only (like simulateLightningFailure): pretend the XAF float is this much. */
let simFloat: number | null = null;
export function simulateDomesticFloat(xaf: number | null): void { if (config.railsMode === "sandbox") simFloat = xaf; }
/** Reserve on a network source (cross-border). Domestic payouts are reserved by the V1 engine
 *  at payout time (selectFundedAggregator) — this layer does not double-book them. */
export const reserve = netReserve; export const commit = netCommit; export const release = netRelease;
