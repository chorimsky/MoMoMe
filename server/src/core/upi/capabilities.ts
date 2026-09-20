/* Provider capability registry + health engine. What every provider and rail can do and
   whether it can do it RIGHT NOW — the routing engine reads only this, never a provider
   module. Built from the sources that already know: the payout rails (PAYOUTS), the crypto
   rails (RAILS), the identity chain (capabilityConfig), the market table, the asset table. */
import type { ProviderCapability, RailHealthState } from "../../../../shared/upi.js";
import { PAYOUTS } from "../../adapters/payouts.js";
import { activeRails, railHealth } from "../../adapters/index.js";
import { payoutHealth } from "../routing.js";
import { capabilityConfig, providersHealth, identityEnabled } from "../identityResolution/resolver.js";
import { MARKETS } from "../network/markets.js";
import { getSettings } from "../settings.js";
import { assets } from "./assets.js";
import { ratesFresh } from "../rates.js";
import { liveMoney } from "../../config.js";

const mmHealth = (name: string, live: boolean): { health: RailHealthState; reason?: string } => {
  const h = payoutHealth(name);
  if (!h.eligible) return { health: "UNAVAILABLE", reason: "rail marked down by health tracker" };
  if (h.successRate < 0.9 && h.successRate > 0) return { health: "DEGRADED", reason: `success rate ${Math.round(h.successRate * 100)} %` };
  return { health: live ? "HEALTHY" : "DEGRADED", reason: live ? undefined : "sandbox rail (simulated settlement)" };
};

export async function capabilityRegistry(): Promise<ProviderCapability[]> {
  const out: ProviderCapability[] = [];
  const idCaps = capabilityConfig();
  const disabled = getSettings().network.disabled ?? { markets: [], providers: [], aggregators: [], pools: [], lightningRoutes: [], partners: [] };
  // Mobile Money: one row per market × provider, health from the rails that can pay it.
  for (const m of Object.values(MARKETS)) {
    for (const p of m.providers) {
      const rails = PAYOUTS.filter((r) => r.configured() && (m.code !== "CM" || r.supports(p.id as never)));
      const live = rails.some((r) => r.live());
      const h = m.code === "CM" ? (rails.length ? mmHealth(rails[0].name, live) : liveMoney() ? { health: "UNAVAILABLE" as RailHealthState, reason: "no payout rail configured" } : { health: "DEGRADED" as RailHealthState, reason: "simulated payout rail (sandbox)" }) : { health: (p.payout ? "DEGRADED" : "UNAVAILABLE") as RailHealthState, reason: p.payout ? "multi-market rail (PawaPay v2) — corridor not activated" : "no payout capability" };
      const off = disabled.markets?.includes(m.code) || disabled.providers?.includes(`${m.code}:${p.id}`);
      out.push({
        kind: "MOBILE_MONEY", id: `${m.code}:${p.id}`, country: m.code, provider: p.id,
        capabilities: { collection: !!p.collect, payout: !!p.payout, identity_verification: !!idCaps[m.code]?.[p.id]?.identity_resolution && identityEnabled(), currency: [m.currency] },
        health: off ? "MAINTENANCE" : h.health, reason: off ? "switched off by the operator (settings.network.disabled)" : h.reason,
      });
    }
  }
  // Lightning: the configured crypto rails that can mint invoices.
  const ln = activeRails().filter((r) => r.name !== "sandbox");
  const lnH = ln.length ? (ln.some((r) => railHealth(r.name).eligible) ? "HEALTHY" : "UNAVAILABLE") : (liveMoney() ? "UNAVAILABLE" : "DEGRADED");
  out.push({ kind: "LIGHTNING", id: "BTC/LIGHTNING", asset: "BTC", network: "LIGHTNING", capabilities: { receive: true, send: ln.some((r) => !!r.payInvoice), settlement: true, currency: ["BTC"] }, health: ratesFresh() ? lnH : "DEGRADED", reason: ln.length ? (ratesFresh() ? undefined : "FX rates stale") : "no live Lightning rail — sandbox mints simulated invoices" });
  // Stablecoins: receive-only on Ethereum via IBEX today; everything else PLANNED.
  for (const a of assets().filter((x) => x.type === "STABLECOIN")) {
    const receive = a.network === "ETHEREUM" && ln.length > 0;
    out.push({ kind: "STABLECOIN", id: `${a.code}/${a.network}`, asset: a.code, network: a.network ?? undefined, capabilities: { receive, send: a.status === "ACTIVE", settlement: a.status === "ACTIVE", currency: ["USD"] }, health: a.status === "PLANNED" ? "UNAVAILABLE" : receive ? (a.status === "ACTIVE" ? "HEALTHY" : "DEGRADED") : "UNAVAILABLE", reason: a.status === "PLANNED" ? "no adapter / custody / liquidity for this network" : a.status === "RECEIVE_ONLY" ? "deposits reconciled by tx hash; outbound settlement not enabled (STABLECOIN_SETTLEMENT_ENABLED)" : undefined });
  }
  // Aggregators (the rails themselves) and the identity providers.
  for (const r of PAYOUTS) out.push({ kind: "AGGREGATOR", id: r.name, capabilities: { payout: true, collection: r.name === "peexit", currency: ["XAF"] }, ...(r.configured() ? mmHealth(r.name, r.live()) : { health: "UNAVAILABLE", reason: "not configured" }) });
  for (const p of await providersHealth()) if (p.configured) out.push({ kind: "AGGREGATOR", id: `identity:${p.name}`, capabilities: { identity_verification: true }, health: p.status === "OPERATIONAL" ? "HEALTHY" : p.status === "SANDBOX" ? "DEGRADED" : p.status === "DEGRADED" ? "DEGRADED" : "UNAVAILABLE", reason: p.lastError });
  out.push({ kind: "BANK", id: "BANK", capabilities: { payout: false, collection: false }, health: "UNAVAILABLE", reason: "no bank adapter" });
  return out;
}
export const healthOf = async (id: string): Promise<RailHealthState> => (await capabilityRegistry()).find((c) => c.id === id)?.health ?? "UNAVAILABLE";
