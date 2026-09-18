/* The platform fee, in one place. A percentage with a floor: at the 500 XAF minimum a
   flat 2.5% is 12 XAF, and the aggregator alone charged 8.5 XAF on a real 500 XAF
   movement — small tickets were carried at a loss. Partners may carry their own rate
   (a key's feePct) instead of the public one; the floor still applies. */
import { getSettings } from "./settings.js";

export function platformFee(xaf: number, pctOverride?: number | null): number {
  const pr = getSettings().pricing;
  const pct = typeof pctOverride === "number" && pctOverride >= 0 && pctOverride <= 0.2 ? pctOverride : pr.feePct;
  return Math.max(Math.round(xaf * pct), Math.min(pr.minFeeXaf ?? 0, xaf));
}

/** The contracted disbursement fee for an aggregator × operator, when the operator has
 *  entered the signed schedule (settings.pricing.contracts). null = not contracted. */
export function contractedPayoutFee(aggregator: string, provider: string): { pct: number; fixedXaf: number } | null {
  const c = getSettings().pricing.contracts?.[aggregator]?.[provider as "MTN" | "ORANGE" | "AIRTEL"];
  return c && Number.isFinite(c.pct) && c.pct >= 0 && c.pct <= 0.2 ? { pct: c.pct, fixedXaf: Number.isFinite(c.fixedXaf) ? c.fixedXaf : 0 } : null;
}
/** Payout cost of `xaf` on a rail: contract → published → assumption, with its source. */
export async function payoutCostXaf(aggregator: string, provider: string, xaf: number, published?: number | null): Promise<{ cost: number; pct: number; source: "contract" | "rail" | "assumed" }> {
  const c = contractedPayoutFee(aggregator, provider);
  if (c) return { cost: Math.round(xaf * c.pct + c.fixedXaf), pct: c.pct, source: "contract" };
  if (published != null && Number.isFinite(published)) return { cost: Math.round(xaf * published), pct: published, source: "rail" };
  const a = getSettings().pricing.costs.payoutPct;
  return { cost: Math.round(xaf * a + getSettings().pricing.costs.fixedXaf), pct: a, source: "assumed" };
}

/** ONE cost model for a delivered payment, used by the revenue report, the capital
 *  intelligence engine and the mix lens alike (they used to each apply the flat
 *  assumption, so a real invoice never reached a margin figure):
 *    payout  = railCostXaf recorded at delivery (invoice → contract → published → assumed)
 *    rail    = crypto-in cost (railPct × total billed)
 *    fixed   = per-transaction overhead
 *  `published` is the rail's API fee when the caller has it (Peexit); optional. */
export function paymentCost(p: { xaf: number; totalXaf: number; aggregator?: string; recipient: { provider: string }; railCostXaf?: number; railCostSource?: "invoice" | "contract" | "published" | "assumed" }, published?: number | null): { payout: number; rail: number; fixed: number; total: number; source: "invoice" | "contract" | "published" | "assumed" } {
  const c = getSettings().pricing.costs;
  let payout: number, source: "invoice" | "contract" | "published" | "assumed";
  if (typeof p.railCostXaf === "number" && Number.isFinite(p.railCostXaf) && p.railCostSource) { payout = p.railCostXaf; source = p.railCostSource; }
  else {
    const ct = contractedPayoutFee(p.aggregator ?? "", p.recipient.provider);
    if (ct) { payout = Math.round(p.xaf * ct.pct + ct.fixedXaf); source = "contract"; }
    else if (published != null && Number.isFinite(published)) { payout = Math.round(p.xaf * published); source = "published"; }
    else { payout = Math.round(p.xaf * c.payoutPct); source = "assumed"; }
  }
  const rail = Math.round(p.totalXaf * c.railPct);
  const fixed = Math.round(c.fixedXaf);
  return { payout, rail, fixed, total: payout + rail + fixed, source };
}
