/* ============================================================
   Routing engine — how a requested payment can SAFELY be completed (§15, §16, §34–§36, §40).

   Input: an intent (source market/provider/amount → destination market/provider). Output:
   every candidate route as data (steps, actors, score, reasons) and the best one. Routes
   are never hard-coded per corridor: they are assembled from the market registry, the
   adapters that can collect/pay, and the liquidity sources that can settle (§17).

   Route types (§40):
   · DIRECT_PARTNER_SETTLEMENT  — Lightning straight to a partner who pays the recipient.
   · MOMOME_LIQUIDITY_SETTLEMENT — Lightning to the network's own position; the destination
                                   pool pays from local fiat.
   · AGGREGATOR_SETTLEMENT      — same market both sides: pool → aggregator, no Lightning leg
                                   (this is what the production Cameroon engine does today).
   · HYBRID_SETTLEMENT          — partner Lightning + local aggregator payout.

   The score (§35) weighs liquidity, provider health, reliability, FX quality, speed, cost
   and risk with operator-configurable weights; lowest fee alone never wins (§34).
   Nothing in here moves money. The saga executes; this only decides.
   ============================================================ */
import type { Corridor, LiquiditySource, NetworkIntent, NetworkQuote, NetworkRoute, NetworkRouteStep, RouteType } from "../../../../shared/network.js";
import { getSettings } from "../settings.js";
import { liveMoney } from "../../config.js";
import { id } from "../ids.js";
import { MARKETS, corridorId, providerAvailable, corridors as allCorridors } from "./markets.js";
import { adaptersFor, type MobileMoneyProviderAdapter } from "./adapters.js";
import { canSettle, destinationSources, sourceById, sourceSideSource, sources } from "./liquidity.js";
import { fxLive, fxQuote, toSats } from "./fx.js";
import { feeBreakdown } from "./fees.js";

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const healthScore = (a: MobileMoneyProviderAdapter) => { const h = a.getProviderHealth(); return h.status === "OPERATIONAL" ? 100 : h.status === "SANDBOX" ? 70 : h.status === "DEGRADED" ? 45 : 0; };

interface Candidate { type: RouteType; collection: MobileMoneyProviderAdapter; payout: MobileMoneyProviderAdapter; src: LiquiditySource; ln: LiquiditySource; dst: LiquiditySource; steps: NetworkRouteStep[]; estimatedSeconds: number }

function candidates(intent: NetworkIntent): { cands: Candidate[]; reasons: string[] } {
  const reasons: string[] = [];
  const n = getSettings().network;
  const srcOk = providerAvailable(intent.sourceMarket, intent.sourceProvider, "collect");
  const dstOk = providerAvailable(intent.destinationMarket, intent.destinationProvider, "payout");
  if (!srcOk.ok) reasons.push(srcOk.reason!);
  if (!dstOk.ok) reasons.push(dstOk.reason!);
  const cid = corridorId(intent.sourceMarket, intent.destinationMarket);
  const domestic = intent.sourceMarket === intent.destinationMarket;
  if (!domestic && !n.corridors[cid]) reasons.push(`corridor ${cid} is not switched on`);
  if (!domestic && !n.flags.CROSS_BORDER_PAYMENTS) reasons.push("CROSS_BORDER_PAYMENTS is off");
  const collectors = adaptersFor(intent.sourceMarket).filter((a) => a.supports(intent.sourceProvider, "collect") && !n.disabled.aggregators.includes(a.aggregator));
  const payers = adaptersFor(intent.destinationMarket).filter((a) => a.supports(intent.destinationProvider, "payout") && !n.disabled.aggregators.includes(a.aggregator));
  if (!collectors.length) reasons.push(`no adapter can collect ${intent.sourceProvider} in ${intent.sourceMarket}`);
  if (!payers.length) reasons.push(`no adapter can pay ${intent.destinationProvider} in ${intent.destinationMarket}`);
  const src = sourceSideSource(intent.sourceMarket);
  if (!src) reasons.push(`no source-side pool in ${intent.sourceMarket}`);
  const ln = sources().find((s) => s.kind === "lightning" && s.status === "ACTIVE");
  if (!domestic && !ln) reasons.push("no Lightning position available");
  const dsts = destinationSources(intent.destinationMarket, intent.destinationProvider);
  if (!dsts.length) reasons.push(`no liquidity source pays ${intent.destinationProvider} in ${intent.destinationMarket}`);
  if (reasons.length || !src) return { cands: [], reasons };
  const cands: Candidate[] = [];
  const srcName = MARKETS[intent.sourceMarket].name, dstName = MARKETS[intent.destinationMarket].name;
  for (const c of collectors) for (const p of payers) {
    if (domestic) {
      // Same market: the pool pays the aggregator directly — this IS today's production flow.
      cands.push({ type: "AGGREGATOR_SETTLEMENT", collection: c, payout: p, src, ln: ln ?? src, dst: src, estimatedSeconds: 120, steps: [
        { kind: "collection", market: intent.sourceMarket, actor: c.id, detail: `${intent.sourceProvider} collection via ${c.aggregator}` },
        { kind: "source_liquidity", market: intent.sourceMarket, actor: src.id, detail: `${srcName} pool` },
        { kind: "payout", market: intent.destinationMarket, actor: p.id, detail: `${intent.destinationProvider} payout via ${p.aggregator}` },
      ] });
      continue;
    }
    if (!ln) continue;
    for (const d of dsts) {
      if (d.kind === "partner") {
        cands.push({ type: "DIRECT_PARTNER_SETTLEMENT", collection: c, payout: p, src, ln, dst: d, estimatedSeconds: 90, steps: [
          { kind: "collection", market: intent.sourceMarket, actor: c.id, detail: `${intent.sourceProvider} collection via ${c.aggregator}` },
          { kind: "source_liquidity", market: intent.sourceMarket, actor: src.id, detail: `${srcName} pool → Lightning` },
          { kind: "lightning_settlement", market: "*", actor: ln.id, detail: `Lightning to ${d.name}` },
          { kind: "payout", market: intent.destinationMarket, actor: d.id, detail: `${d.name} pays ${intent.destinationProvider}` },
        ] });
      } else {
        cands.push({ type: "MOMOME_LIQUIDITY_SETTLEMENT", collection: c, payout: p, src, ln, dst: d, estimatedSeconds: 150, steps: [
          { kind: "collection", market: intent.sourceMarket, actor: c.id, detail: `${intent.sourceProvider} collection via ${c.aggregator}` },
          { kind: "source_liquidity", market: intent.sourceMarket, actor: src.id, detail: `${srcName} pool → Lightning` },
          { kind: "lightning_settlement", market: "*", actor: ln.id, detail: "Lightning to the network's position" },
          { kind: "destination_liquidity", market: intent.destinationMarket, actor: d.id, detail: `${dstName} pool absorbs the settlement` },
          { kind: "payout", market: intent.destinationMarket, actor: p.id, detail: `${intent.destinationProvider} payout via ${p.aggregator}` },
        ] });
      }
    }
  }
  return { cands, reasons };
}

/** Discover, price and score every route; the best available one first. */
export async function discover(intent: NetworkIntent): Promise<{ routes: NetworkRoute[]; quotes: NetworkQuote[]; reasons: string[] }> {
  const n = getSettings().network;
  const w = n.weights;
  const { cands, reasons } = candidates(intent);
  const fx = fxQuote(intent.sourceCurrency, intent.destinationCurrency);
  if (!fx) reasons.push(`no FX for ${intent.sourceCurrency}→${intent.destinationCurrency}`);
  const live = fxLive(intent.sourceCurrency, intent.destinationCurrency);
  const routes: NetworkRoute[] = [], quotes: NetworkQuote[] = [];
  if (!fx) return { routes, quotes, reasons };
  const cid = corridorId(intent.sourceMarket, intent.destinationMarket);
  for (const c of cands) {
    const rs: string[] = [];
    const fees = await feeBreakdown({ sourceAmount: intent.sourceAmount, sourceCurrency: intent.sourceCurrency, collection: c.collection, payout: c.payout, payoutProvider: intent.destinationProvider, destinationSource: c.dst, lightningSource: c.ln, fx, settlementSats: 0, domestic: c.type === "AGGREGATOR_SETTLEMENT" });
    // The spread is one of the itemised fees, so the conversion is at MID — charging it in
    // the rate as well would take it twice.
    const netSource = intent.sourceAmount - fees.total;
    const destinationAmount = Math.floor(netSource * fx.mid);
    // What crosses: the recipient's amount plus the payout aggregator's fee (charged to the
    // destination pool). Every other fee is retained on the source side as revenue.
    const settlementSource = netSource + fees.providerPayout;
    const sats = c.type === "AGGREGATOR_SETTLEMENT" ? 0 : (toSats(settlementSource, intent.sourceCurrency) ?? 0);
    // Liquidity: the destination must be able to pay the recipient; the Lightning position
    // must carry the settlement value (BTC).
    const dl = await canSettle(c.dst.id, destinationAmount);
    if (!dl.ok) rs.push(dl.reason!);
    const ll = c.type === "AGGREGATOR_SETTLEMENT" ? { ok: true, available: null } : await canSettle(c.ln.id, sats / 1e8);
    if (!ll.ok) rs.push(`Lightning: ${(ll as { reason?: string }).reason}`);
    const mkt = MARKETS[intent.destinationMarket];
    if (destinationAmount < mkt.limits.minPerTx) rs.push(`below ${mkt.name} minimum (${mkt.limits.minPerTx} ${mkt.currency})`);
    const lim = c.payout.getLimits(intent.destinationProvider);
    if (destinationAmount > lim.maxPerTx) rs.push(`above ${intent.destinationProvider} per-transaction limit (${lim.maxPerTx} ${mkt.currency})`);
    // A configured (non-feed) rate can never price REAL money; in the sandbox it prices the
    // rehearsal and the readiness view still names it.
    if (!live.live && c.type !== "AGGREGATOR_SETTLEMENT" && liveMoney()) rs.push(...live.reasons);
    const liquidity = dl.ok ? (dl.available != null ? clamp(50 + 50 * Math.min(1, dl.available / (destinationAmount * 10))) : 60) : 0;
    const providerHealth = Math.min(healthScore(c.collection), healthScore(c.payout));
    const reliability = clamp(100 * Math.min(c.collection.getProviderHealth().successRate, c.payout.getProviderHealth().successRate));
    const fxQuality = live.live ? 100 : c.type === "AGGREGATOR_SETTLEMENT" ? 100 : 40;
    const speed = clamp(100 - c.estimatedSeconds / 6);
    const cost = clamp(100 - (fees.total / intent.sourceAmount) * 1000);
    const risk = c.dst.kind === "partner" ? 70 : 90;
    const sumW = w.liquidity + w.providerHealth + w.reliability + w.fxQuality + w.speed + w.cost + w.risk || 1;
    const total = Math.round((liquidity * w.liquidity + providerHealth * w.providerHealth + reliability * w.reliability + fxQuality * w.fxQuality + speed * w.speed + cost * w.cost + risk * w.risk) / sumW);
    const route: NetworkRoute = {
      id: id("nrt"), intentId: intent.id, corridor: cid, type: c.type, steps: c.steps,
      sourceSourceId: c.src.id, lightningSourceId: c.ln.id, destinationSourceId: c.dst.id, collectionAdapter: c.collection.id, payoutAdapter: c.payout.id,
      score: { liquidity, providerHealth, reliability, fxQuality, speed, cost, risk, total }, estimatedSeconds: c.estimatedSeconds,
      available: rs.length === 0, reasons: rs,
    };
    routes.push(route);
    const at = Date.now();
    quotes.push({ id: id("nq"), intentId: intent.id, corridor: cid, sourceAmount: intent.sourceAmount, sourceCurrency: intent.sourceCurrency, destinationAmount, destinationCurrency: intent.destinationCurrency, fx, fees, totalSource: intent.sourceAmount, settlementSats: sats, settlementSource, routeId: route.id, createdAt: new Date(at).toISOString(), expiresAt: fx.expiresAt });
  }
  routes.sort((a, b) => Number(b.available) - Number(a.available) || b.score.total - a.score.total);
  return { routes, quotes, reasons };
}

/** Corridor readiness for the registry view — the router's own view of each corridor. */
export async function corridorStatus(): Promise<Corridor[]> {
  const n = getSettings().network;
  const list = allCorridors(() => ({ status: "INACTIVE", reasons: [] }));
  for (const c of list) {
    const reasons: string[] = [];
    const domestic = c.source === c.destination;
    if (!c.enabled && !domestic) reasons.push("switched off");
    if (!c.sourceProviders.length) reasons.push("no collecting provider");
    if (!c.destinationProviders.length) reasons.push("no paying provider");
    if (!domestic) {
      const l = fxLive(c.sourceCurrency, c.destinationCurrency); if (!l.live && liveMoney()) reasons.push(...l.reasons);
      if (!sources().some((s) => s.kind === "lightning" && s.status === "ACTIVE")) reasons.push("no Lightning position");
      if (!n.flags.CROSS_BORDER_PAYMENTS) reasons.push("CROSS_BORDER_PAYMENTS off");
    }
    const dst = c.destinationProviders.flatMap((p) => destinationSources(c.destination, p));
    if (!dst.length) reasons.push("no destination liquidity");
    else if (!(await Promise.all(dst.map((s) => canSettle(s.id, MARKETS[c.destination].limits.minPerTx)))).some((r) => r.ok)) reasons.push("destination liquidity unavailable");
    c.reasons = reasons;
    c.status = reasons.length === 0 ? "ACTIVE" : reasons.length <= 1 && (c.enabled || domestic) ? "DEGRADED" : "INACTIVE";
  }
  return list;
}
export const routeSource = sourceById;
