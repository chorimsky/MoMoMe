/* ============================================================
   MoMo›Me Connect — Routing policy (§18, §19, Phase 4).

   Question: how can value move from the payer to the payee for THIS intent? The engine
   evaluates candidate routes in the configured policy order and returns an EXPLAINABLE
   decision (kept internal; the customer sees only the chosen payment method and status).

   Policy (CONNECT_ROUTE_POLICY, default "internal,direct,lightning,stablecoin,fallback"):
     internal   — both parties are MoMo›Me-connected and the payer's balance covers it → ledger
     direct     — a payment method the payer chose that a rail serves directly (Mobile Money
                  collection / Lightning / stablecoin funding → payee's settlement)
     lightning  — Lightning as the interoperability transport (payer funds over Lightning)
     stablecoin — stablecoin-assisted funding
     fallback   — the configured external fallback (a hosted checkout with every viable method)
   Nothing here moves money: `decide()` is pure over the profiles, the intent and the
   capabilities the existing engine reports.
   ============================================================ */
import type { Mpi, PaymentMethodId } from "./identities.js";
import { balanceOf } from "./ledger.js";
import { offeredMethods } from "../../routes/api.js";
import { config } from "../../config.js";

export type RouteKind = "internal" | "direct" | "lightning" | "stablecoin" | "fallback";
export interface RouteDecision {
  kind: RouteKind; method: PaymentMethodId; transport: "momo_me_internal" | "lightning" | "stablecoin" | "mobile_money" | "bank";
  settlement: Mpi["settlement"]["preferred"]; explanation: string[]; alternatives: Array<{ kind: RouteKind; method: PaymentMethodId; why_not?: string }>;
}
export const routePolicy = (): RouteKind[] => (process.env.CONNECT_ROUTE_POLICY ?? "internal,direct,lightning,stablecoin,fallback").split(",").map((s) => s.trim() as RouteKind).filter((k) => ["internal", "direct", "lightning", "stablecoin", "fallback"].includes(k));

export interface RouteContext { payee: Mpi; payer?: Mpi; amountXaf: number; permitted: PaymentMethodId[]; wanted?: PaymentMethodId; internalAllowed?: boolean }

/** Which funding methods the platform can take right now (engine switches + rails). */
export function fundingAvailable(): Record<PaymentMethodId, boolean> {
  const m = offeredMethods();
  return { momo_me: true, lightning: !!m.LIGHTNING, stablecoin: !!(m.USDT || m.USDC), mobile_money: config.railsMode === "sandbox" || (process.env.CONNECT_MOMO_COLLECT ?? "").toLowerCase() === "true", bank_transfer: false };
}

export function decide(ctx: RouteContext): RouteDecision | { error: "ROUTE_UNAVAILABLE"; explanation: string[] } {
  const explanation: string[] = []; const alternatives: RouteDecision["alternatives"] = [];
  const avail = fundingAvailable();
  const permitted = (m: PaymentMethodId) => ctx.permitted.includes(m) && ctx.payee.payment.methods.includes(m);
  for (const kind of routePolicy()) {
    if (kind === "internal") {
      if (!ctx.payer) { alternatives.push({ kind, method: "momo_me", why_not: "payer not identified" }); continue; }
      if (!ctx.payee.payment.momoBalance) { alternatives.push({ kind, method: "momo_me", why_not: "payee does not hold a MoMo›Me balance" }); continue; }
      if (ctx.internalAllowed === false || !permitted("momo_me")) { alternatives.push({ kind, method: "momo_me", why_not: "internal route not permitted for this intent" }); continue; }
      const bal = balanceOf(ctx.payer.id);
      if (bal < ctx.amountXaf) { alternatives.push({ kind, method: "momo_me", why_not: `payer balance ${bal} XAF < ${ctx.amountXaf} XAF` }); continue; }
      explanation.push("both parties are MoMo›Me-connected and the payer's balance covers the amount → internal ledger transfer (instant, no external rail)");
      return { kind, method: "momo_me", transport: "momo_me_internal", settlement: ctx.payee.settlement.preferred, explanation, alternatives };
    }
    if (kind === "direct") {
      const want = ctx.wanted && ctx.wanted !== "momo_me" ? ctx.wanted : undefined;
      if (want && permitted(want) && avail[want]) { explanation.push(`payer chose ${want}; the rail serves it directly`); return { kind, method: want, transport: want === "lightning" ? "lightning" : want === "stablecoin" ? "stablecoin" : "mobile_money", settlement: ctx.payee.settlement.preferred, explanation, alternatives }; }
      if (want) alternatives.push({ kind, method: want, why_not: !permitted(want) ? "method not permitted for this payee/intent" : "rail not available" });
      continue;
    }
    if (kind === "lightning" && permitted("lightning") && avail.lightning && ctx.payee.payment.lightningEnabled) { explanation.push("Lightning is the interoperability transport: the payer funds over Lightning, MoMo›Me converts and settles to the payee's profile"); return { kind, method: "lightning", transport: "lightning", settlement: ctx.payee.settlement.preferred, explanation, alternatives }; }
    if (kind === "lightning") alternatives.push({ kind, method: "lightning", why_not: !avail.lightning ? "Lightning rail not available" : "not permitted" });
    if (kind === "stablecoin" && permitted("stablecoin") && avail.stablecoin && ctx.payee.payment.stablecoinEnabled) { explanation.push("stablecoin-assisted: the payer funds in USDT/USDC, converted at confirmation"); return { kind, method: "stablecoin", transport: "stablecoin", settlement: ctx.payee.settlement.preferred, explanation, alternatives }; }
    if (kind === "stablecoin") alternatives.push({ kind, method: "stablecoin", why_not: !avail.stablecoin ? "stablecoin rail not available" : "not permitted" });
    if (kind === "fallback") {
      const first = (["lightning", "stablecoin", "mobile_money"] as PaymentMethodId[]).find((m) => permitted(m) && avail[m]);
      if (first) { explanation.push(`fallback: hosted checkout offering ${first} first`); return { kind, method: first, transport: first === "lightning" ? "lightning" : first === "stablecoin" ? "stablecoin" : "mobile_money", settlement: ctx.payee.settlement.preferred, explanation, alternatives }; }
    }
  }
  explanation.push("no candidate route: no permitted payment method is served by an available rail");
  return { error: "ROUTE_UNAVAILABLE", explanation };
}
