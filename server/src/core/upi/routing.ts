/* RoutingEngine — every route from a funding rail to a destination, described the same way
   (fees, FX, latency, liquidity, availability, risk, limits, status) and ORDERED BY A
   CONFIGURED RULE, never a subjective score: cheapest total for the recipient first, then
   fastest p50, then the rail's own priority. Unavailable rails are excluded, never
   down-ranked. In SHADOW mode the engine records its choice beside what V1 did and executes
   nothing (docs/upi/MULTI_RAIL_ROUTING_ARCHITECTURE.md). */
import type { PaymentIntentV2, RouteV2, QuoteOption, RouteType } from "../../../../shared/upi.js";
import { domesticCapacity } from "./liquidity.js";
import { mobileMoneyRail } from "./rails.js";
import { MIN_XAF, MAX_XAF, PROVIDER_PAYOUT_MAX } from "../../../../shared/domain.js";
import { getSettings } from "../settings.js";
import { register, touch } from "../persist.js";
import { id } from "../ids.js";
import { routingMode } from "./flags.js";
import type { ProviderId } from "../../../../shared/types.js";

export interface RoutingRule { order: Array<"cost" | "latency" | "priority">; railPriority: string[] }
export function routingRule(): RoutingRule {
  const raw = (process.env.ROUTING_RULE ?? "cost,latency,priority").split(",").map((s) => s.trim()) as RoutingRule["order"];
  return { order: raw.filter((k) => ["cost", "latency", "priority"].includes(k)), railPriority: (process.env.ROUTING_RAIL_PRIORITY ?? "LIGHTNING,STABLECOIN,MOBILE_MONEY,AGGREGATOR,HYBRID").split(",").map((s) => s.trim()) };
}
const TYPE_OF = (o: QuoteOption, domestic: boolean): RouteType => o.sourceRail === "LIGHTNING" ? "LIGHTNING" : o.sourceRail === "STABLECOIN" ? "STABLECOIN" : domestic ? "DIRECT" : "HYBRID";

export async function routesFor(intent: PaymentIntentV2): Promise<RouteV2[]> {
  const mm = intent.recipient.destinations.find((d) => d.rail === "MOBILE_MONEY");
  const domestic = !!mm && mm.country === "CM";
  const options = intent.quote?.options ?? [];
  const cap = domestic && mm ? await domesticCapacity(mm.provider as ProviderId, "CM", intent.amount.value) : { ok: false, available: null, reason: "no domestic destination" };
  const health = domestic && mm ? await mobileMoneyRail("CM", mm.provider as ProviderId).health() : { state: "UNAVAILABLE" as const, reason: "no destination" };
  const routes: RouteV2[] = options.map((o) => {
    const type = TYPE_OF(o, domestic);
    const okLiq = domestic ? cap.ok : o.available;
    const available = o.available && okLiq && health.state !== "UNAVAILABLE";
    const maxProv = mm ? (PROVIDER_PAYOUT_MAX[mm.provider as ProviderId] ?? MAX_XAF) : MAX_XAF;
    return {
      id: id("rt2"), type, sourceRail: o.sourceRail, settlementRail: type === "LIGHTNING" ? "LIGHTNING" : type === "STABLECOIN" ? "STABLECOIN" : "MOBILE_MONEY", destinationRail: o.destinationRail,
      steps: type === "DIRECT" ? [{ kind: "collection", actor: mm?.provider ?? "MOBILE_MONEY", detail: "payer's Mobile Money is collected" }, { kind: "payout", actor: mm?.provider ?? "", detail: "recipient is paid" }]
        : [{ kind: "payment", actor: `${o.sourceAsset}/${o.sourceNetwork ?? ""}`, detail: `payer sends ${o.sourceAmountLabel}` }, { kind: "conversion", actor: "fx", detail: o.fx ? `${o.fx.pair} @ ${o.fx.rate.toFixed(2)} (${o.fx.source})` : "no rate" }, { kind: "payout", actor: mm?.provider ?? "", detail: `${o.destinationAmount.value} ${o.destinationAmount.currency} to the recipient` }],
      fees: o.fees, fx: o.fx, latencySec: o.latencySec,
      liquidity: { pool: domestic ? `cm:payout:${mm?.provider}` : "network", available: cap.available, required: intent.amount.value, ok: okLiq },
      providerAvailability: health.state, risk: type === "STABLECOIN" ? "MEDIUM" : "LOW",
      limits: { min: MIN_XAF, max: Math.min(MAX_XAF, maxProv), currency: "XAF" },
      // Liquidity is named first: a route that exists but cannot be funded is a different
      // fact from a rail that is off, and the intent's failure state depends on which.
      status: available ? "AVAILABLE" : "UNAVAILABLE", reason: available ? undefined : (domestic && !okLiq && o.available ? `LIQUIDITY_UNAVAILABLE: ${cap.reason ?? "insufficient"}` : (o.reason ?? (!okLiq ? `LIQUIDITY_UNAVAILABLE: ${cap.reason ?? "insufficient"}` : health.reason))), rank: 0,
    };
  });
  const rule = routingRule();
  const key = (r: RouteV2) => rule.order.map((k) => k === "cost" ? r.fees.total : k === "latency" ? r.latencySec.p50 : rule.railPriority.indexOf(r.type === "DIRECT" ? "MOBILE_MONEY" : r.type));
  routes.sort((a, b) => { const ka = key(a), kb = key(b); for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i]; return 0; });
  routes.forEach((r, i) => { r.rank = i + 1; });
  return routes;
}
/** The route the engine selects for an intent: the first AVAILABLE one under the rule that
 *  matches the payer's chosen funding rail when they chose one. */
export function selectRoute(routes: RouteV2[], want?: { rail: string; asset?: string }): RouteV2 | null {
  const avail = routes.filter((r) => r.status === "AVAILABLE");
  if (want) return avail.find((r) => r.sourceRail === want.rail && (!want.asset || r.steps[0]?.actor.startsWith(want.asset))) ?? null;
  return avail[0] ?? null;
}

/* ---------- shadow record: what the engine would do vs what V1 did ---------- */
export interface ShadowRecord { at: string; intentId: string; engineRoute: string; v1Route: string; agree: boolean; fees: number; fx: number | null; latencyP50: number; liquidityOk: boolean; mode: "SHADOW" | "EXECUTE" }
const shadow: ShadowRecord[] = [];
register("upi_shadow", () => shadow.slice(-2_000), (d: ShadowRecord[]) => { shadow.length = 0; shadow.push(...(d ?? [])); });
export function recordShadow(intent: PaymentIntentV2, engine: RouteV2 | null, v1Route: string): ShadowRecord {
  const rec: ShadowRecord = { at: new Date().toISOString(), intentId: intent.id, engineRoute: engine ? `${engine.type}:${engine.sourceRail}` : "none", v1Route, agree: !!engine && v1Route.startsWith(engine.sourceRail), fees: engine?.fees.total ?? 0, fx: engine?.fx?.rate ?? null, latencyP50: engine?.latencySec.p50 ?? 0, liquidityOk: !!engine?.liquidity.ok, mode: routingMode() };
  shadow.push(rec); if (shadow.length > 2_000) shadow.shift(); touch("upi_shadow");
  return rec;
}
export function shadowSummary() { const n = shadow.length; const agree = shadow.filter((s) => s.agree).length; return { comparisons: n, agreeing: agree, disagreeing: n - agree, recent: shadow.slice(-20).reverse(), weights: getSettings().network.weights }; }
