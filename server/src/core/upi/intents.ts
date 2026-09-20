/* PaymentIntent v2 — the saga: CREATED → IDENTITY_RESOLVED → QUOTED → ROUTE_SELECTED →
   LIQUIDITY_RESERVED → PAYMENT_PENDING → PAYMENT_DETECTED → PAYMENT_CONFIRMED →
   SETTLEMENT_* → COMPLETED, with every failure state explicit. Nothing external is atomic,
   so the money legs are NOT re-implemented: an executed intent hands the leg to the V1
   engine (a V1 quote + payment, whose idempotency, webhooks, polling, ledger, refund and
   review paths are production-proven) or to the network saga (cross-border), and mirrors
   their state into its own. Reading an intent re-syncs it. */
import type { PaymentIntentV2, IntentState, PaymentDestination, QuoteOption, RouteV2 } from "../../../../shared/upi.js";
import type { Payment, PaymentState } from "../../../../shared/types.js";
import { register, touch } from "../persist.js";
import { id, } from "../ids.js";
import { randomUUID } from "node:crypto";
import * as identity from "./identity.js";
import { quoteIntent } from "./quote.js";
import { routesFor, selectRoute, recordShadow } from "./routing.js";
import { routingMode, flag } from "./flags.js";
import { metrics, refsOf } from "./ledger.js";
import { store } from "../../db/store.js";
import { getTx } from "../network/saga.js";
import { IdentityError } from "../identityResolution/errors.js";
import { identityMode } from "../identityResolution/resolver.js";

const intents = new Map<string, PaymentIntentV2>();
register("upi_intents", () => [...intents.values()].slice(-10_000), (d: PaymentIntentV2[]) => { for (const i of d ?? []) intents.set(i.id, i); });
const now = () => new Date().toISOString();
const INTENT_TTL_MS = 15 * 60_000;
export const getIntent = (i: string) => intents.get(i);
export const intentsOf = (owner: string, limit = 50) => [...intents.values()].filter((i) => i.owner === owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
export const allIntents = (limit = 200) => [...intents.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
function move(i: PaymentIntentV2, state: IntentState, note?: string) { if (i.state === state) return; i.state = state; i.updatedAt = now(); i.events.push({ at: i.updatedAt, state, note }); touch("upi_intents"); }

export class IntentError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }

/** CREATED → IDENTITY_RESOLVED → QUOTED. Source/destination stay open until the payer picks. */
export async function createIntent(input: { owner: string; identity: string; amount: number; currency?: string; defaultCountry?: string; feePct?: number | null; correlationId?: string; source?: { rail: string; asset?: string; network?: string | null } }): Promise<PaymentIntentV2> {
  const at = now();
  const i: PaymentIntentV2 = {
    id: id("pi"), owner: input.owner, recipient: { identity: input.identity.trim(), destinations: [] }, amount: { value: Math.round(input.amount), currency: (input.currency ?? "XAF").toUpperCase() },
    state: "CREATED", events: [{ at, state: "CREATED" }], refs: { correlationId: input.correlationId ?? `cor_${randomUUID().slice(0, 12)}`, paymentIntentId: "" },
    createdAt: at, updatedAt: at, expiresAt: new Date(Date.now() + INTENT_TTL_MS).toISOString(),
  };
  i.refs.paymentIntentId = i.id;
  intents.set(i.id, i); touch("upi_intents"); metrics.payment_total++;
  // Identity
  try {
    const resolved = await identity.resolve(i.recipient.identity, { purpose: "PAYMENT_CREATION", actor: input.owner, defaultCountry: input.defaultCountry });
    i.recipient.resolved = resolved; i.recipient.identity = resolved.canonical;
    i.recipient.destinations = identity.getDestinations(resolved);
    metrics.identity_resolution_total++;
    move(i, "IDENTITY_RESOLVED", `${resolved.type} ${resolved.canonical}${resolved.verification ? ` · ${resolved.verification.status}` : ""}`);
    if (resolved.type === "MSISDN" && !resolved.operator) { move(i, "PROVIDER_UNAVAILABLE", "no operator serves this number"); return i; }
    if (resolved.native && i.recipient.destinations.every((d) => d.status === "UNSUPPORTED")) { move(i, "PROVIDER_UNAVAILABLE", "no configured rail reaches this identity"); return i; }
    // Test 10: an identity that cannot be verified is never silently continued in gate mode.
    const v = resolved.verification?.status;
    if (identityMode() === "gate" && (v === "NOT_FOUND" || v === "INACTIVE")) { move(i, "CANCELLED", `recipient ${v.toLowerCase().replace("_", " ")} — gate mode refuses`); return i; }
    if (resolved.currency && i.amount.currency === "XAF" && resolved.currency !== "XAF" && input.currency === undefined) i.amount.currency = resolved.currency; // amount is in the recipient's money unless the caller said otherwise
  } catch (e) {
    const code = e instanceof IdentityError ? e.code : "IDENTITY_INVALID_IDENTIFIER";
    move(i, "CANCELLED", `identity: ${code}`);
    throw new IntentError(code, e instanceof Error ? e.message : "Invalid recipient.", code === "IDENTITY_UNAUTHORIZED" ? 401 : 400);
  }
  // Quote
  const q = await quoteIntent(i, input.feePct);
  i.quote = q; i.refs.quoteId = q.id;
  if (input.source) i.source = { rail: input.source.rail as never, asset: input.source.asset ?? (input.source.rail === "LIGHTNING" ? "BTC" : "XAF"), network: input.source.network ?? (input.source.rail === "LIGHTNING" ? "LIGHTNING" : null) };
  move(i, q.options.some((o) => o.available) ? "QUOTED" : "PROVIDER_UNAVAILABLE", q.options.some((o) => o.available) ? `${q.options.filter((o) => o.available).length} funding option(s)` : q.options.map((o) => o.reason).filter(Boolean).join("; ") || "no available option");
  return i;
}

/** QUOTED → ROUTE_SELECTED. Deterministic; recorded in shadow beside what V1 would do. */
export async function selectRouteFor(i: PaymentIntentV2, want?: { rail: string; asset?: string }): Promise<{ route: RouteV2 | null; routes: RouteV2[]; option: QuoteOption | null }> {
  if (i.state !== "QUOTED" && i.state !== "ROUTE_SELECTED") throw new IntentError("intent_state", `Cannot route an intent in state ${i.state}.`, 409);
  if (Date.parse(i.quote?.expiresAt ?? "") < Date.now()) { move(i, "EXPIRED", "quote expired"); throw new IntentError("quote_expired", "The quote expired — start again.", 409); }
  const routes = await routesFor(i);
  const route = selectRoute(routes, want);
  metrics.route_selection_total++;
  const v1Route = want ? `${want.rail}${want.asset ? `:${want.asset}` : ""}` : "LIGHTNING"; // what V1 executes is the payer's pick; its default is Lightning
  i.shadow = { ...recordShadow(i, route, v1Route), at: now() } as never;
  if (!route) { metrics.route_failure_total++; const liq = routes.find((r) => /LIQUIDITY_UNAVAILABLE/.test(r.reason ?? "")); move(i, liq ? "LIQUIDITY_FAILED" : "PROVIDER_UNAVAILABLE", liq ? "LIQUIDITY_UNAVAILABLE" : (routes[0]?.reason ?? "no available route")); return { route: null, routes, option: null }; }
  const option = i.quote!.options.find((o) => o.sourceRail === route.sourceRail && (!want?.asset || o.sourceAsset === want.asset)) ?? null;
  i.route = route; i.refs.routeId = route.id; i.source = { rail: route.sourceRail, asset: option?.sourceAsset ?? "BTC", network: option?.sourceNetwork ?? null };
  i.destination = { rail: route.destinationRail, provider: (i.recipient.destinations.find((d) => d.rail === "MOBILE_MONEY") as Extract<PaymentDestination, { rail: "MOBILE_MONEY" }> | undefined)?.provider, currency: i.amount.currency, country: i.recipient.resolved?.country };
  move(i, "ROUTE_SELECTED", `${route.type} rank ${route.rank}`);
  return { route, routes, option };
}

/** ROUTE_SELECTED → PAYMENT_PENDING, by handing the money leg to the engine that owns it.
 *  `mintV1` is the V1 quote+payment path (createPaymentCore behind a caller-supplied
 *  closure so this module never imports a route). Executes only when the flags allow. */
export async function executeIntent(i: PaymentIntentV2, mintV1: (x: { method: "LIGHTNING" | "USDT" | "USDC"; xaf: number; recipient: { phone: string; country: string; provider: string; name: string } }) => Promise<{ status: number; body: Payment | { error?: string; message?: string; code?: string } }>): Promise<PaymentIntentV2> {
  if (i.state !== "ROUTE_SELECTED" || !i.route) throw new IntentError("intent_state", `Cannot execute an intent in state ${i.state}.`, 409);
  if (!flag("PAYMENT_INTENT_V2_ENABLED")) throw new IntentError("flag_off", "PAYMENT_INTENT_V2_ENABLED is off — intents can be quoted and routed, not executed.", 403);
  if (routingMode() !== "EXECUTE") throw new IntentError("shadow_mode", "Routing is in SHADOW mode: the route was recorded, nothing was executed. Pay through the V1 flow.", 403);
  const mm = i.recipient.destinations.find((d) => d.rail === "MOBILE_MONEY") as Extract<PaymentDestination, { rail: "MOBILE_MONEY" }> | undefined;
  if (!mm || mm.country !== "CM") throw new IntentError("unsupported", "Only domestic (Cameroon) execution goes through this layer today; cross-border uses /api/network.", 400);
  const method = i.source?.rail === "LIGHTNING" ? "LIGHTNING" : i.source?.asset === "USDC" ? "USDC" : i.source?.asset === "USDT" ? "USDT" : null;
  if (!method) throw new IntentError("unsupported", "Only Lightning / USDT / USDC funding is executed here.", 400);
  if (method !== "LIGHTNING" && !(flag("STABLECOIN_SETTLEMENT_ENABLED") && flag(method === "USDT" ? "STABLECOIN_USDT_ENABLED" : "STABLECOIN_USDC_ENABLED"))) throw new IntentError("flag_off", `${method} funding through intents needs STABLECOIN_SETTLEMENT_ENABLED + STABLECOIN_${method}_ENABLED (V1 still accepts it directly).`, 403);
  move(i, "LIQUIDITY_RESERVED", "domestic payout capacity checked at route selection; V1 reserves at payout");
  metrics.liquidity_reservation_total++;
  const r = await mintV1({ method, xaf: i.amount.value, recipient: { phone: mm.identifier.replace(/^\+237/, ""), country: "CM", provider: mm.provider, name: i.recipient.resolved?.verification?.displayName ?? "" } });
  if (r.status !== 200 || !("id" in r.body)) { const b = r.body as { error?: string; message?: string; code?: string }; move(i, "PAYMENT_FAILED", `${b.error ?? r.status}: ${b.message ?? ""}`); metrics.payment_failed++; throw new IntentError(b.error ?? "v1_refused", b.message ?? "The payment could not be created.", r.status); }
  const p = r.body;
  i.refs.v1PaymentId = p.id; i.refs.settlementId = undefined;
  i.request = { id: id("pr"), intentId: i.id, protocol: method === "LIGHTNING" ? "BOLT11" : "ERC20_TRANSFER", sourceAsset: i.source!.asset, sourceNetwork: i.source!.network, sourceAmount: p.payInstruction.amount, instruction: p.payInstruction, expiresAt: p.payInstruction.expiresAt, refs: { ...i.refs } };
  if (method === "LIGHTNING") metrics.lightning_payment_total++; else metrics.stablecoin_transaction_total++;
  move(i, "PAYMENT_PENDING", p.ref);
  return i;
}

const V1_TO_V2: Partial<Record<PaymentState, IntentState>> = { QUOTED: "PAYMENT_PENDING", AWAITING_INBOUND: "PAYMENT_PENDING", INBOUND_DETECTED: "PAYMENT_DETECTED", INBOUND_CONFIRMED: "PAYMENT_CONFIRMED", FX_LOCKED: "SETTLEMENT_PENDING", PAYOUT_REQUESTED: "SETTLEMENT_PROCESSING", PAYOUT_CONFIRMED: "SETTLEMENT_COMPLETED", DELIVERED: "COMPLETED", REFUND_PENDING: "SETTLEMENT_FAILED", REFUNDED: "SETTLEMENT_FAILED", FAILED: "SETTLEMENT_FAILED", MANUAL_REVIEW: "RECONCILIATION_REQUIRED" };
/** Mirror the engine that holds the money. Called on every read. */
export async function syncIntent(i: PaymentIntentV2): Promise<PaymentIntentV2> {
  if (i.refs.v1PaymentId) {
    const p = await store().getPayment(i.refs.v1PaymentId);
    if (p) {
      const s = V1_TO_V2[p.state];
      if (p.state === "FAILED" && !p.events.some((e) => e.state === "INBOUND_CONFIRMED")) { move(i, p.events.some((e) => /expired/i.test(e.note ?? "")) ? "EXPIRED" : "PAYMENT_FAILED", p.events.at(-1)?.note); }
      else if (s) { const before = i.state; move(i, s, p.events.at(-1)?.note); if (s === "COMPLETED" && before !== "COMPLETED") { metrics.payment_success++; metrics.settlement_success++; metrics.mobile_money_payment_total++; } if (s === "SETTLEMENT_FAILED" && before !== "SETTLEMENT_FAILED") metrics.settlement_failed++; }
      i.refs = await refsOf(i);
    }
  } else if (i.refs.networkTxId) {
    const t = getTx(i.refs.networkTxId);
    if (t) { const map: Record<string, IntentState> = { CREATED: "PAYMENT_PENDING", LIQUIDITY_RESERVED: "LIQUIDITY_RESERVED", COLLECTION_PENDING: "PAYMENT_PENDING", COLLECTION_CONFIRMED: "PAYMENT_CONFIRMED", COLLECTION_FAILED: "PAYMENT_FAILED", LIGHTNING_SENT: "SETTLEMENT_PROCESSING", LIGHTNING_CONFIRMED: "SETTLEMENT_PROCESSING", LIGHTNING_FAILED: "SETTLEMENT_FAILED", PAYOUT_INITIATED: "SETTLEMENT_PROCESSING", PAYOUT_CONFIRMED: "SETTLEMENT_COMPLETED", DESTINATION_SETTLEMENT_FAILED: "SETTLEMENT_FAILED", COMPLETED: "COMPLETED", REFUND_PENDING: "SETTLEMENT_FAILED", REFUNDED: "SETTLEMENT_FAILED", MANUAL_REVIEW: "RECONCILIATION_REQUIRED" }; move(i, map[t.state] ?? i.state); }
  } else if (["CREATED", "IDENTITY_RESOLVED", "QUOTED", "ROUTE_SELECTED"].includes(i.state) && Date.parse(i.expiresAt) < Date.now()) move(i, "EXPIRED", "intent expired unexecuted");
  return i;
}
export function cancelIntent(i: PaymentIntentV2, why: string): boolean { if (["CREATED", "IDENTITY_RESOLVED", "QUOTED", "ROUTE_SELECTED"].includes(i.state)) { move(i, "CANCELLED", why); return true; } return false; }
export function _resetIntents(): void { intents.clear(); }
