/* ============================================================
   The cross-border transaction saga (§22–§31, §47).

   Local money in → Lightning settlement → local money out, as a DURABLE state machine.
   No stage assumes the previous one succeeded without the provider's confirmation; every
   external operation is idempotent on a key derived from the transaction id; provider
   callbacks are EVENTS (authenticated upstream, deduplicated here) that advance state,
   never commands that move money by themselves. A failure after money has moved never
   marks the transaction "failed and forgotten": it lands in a named failure state with a
   recovery path (§29), and the funds stay on the network ledger until they are resolved.

   Gates: a real transaction (shadow=false) requires INTEROPERABILITY_V2 + ROUTING_ENGINE +
   LIQUIDITY_ENGINE and the corridor switch; a cross-border one also CROSS_BORDER_PAYMENTS.
   In the sandbox everything runs against simulated rails.
   ============================================================ */
import type { NetworkIntent, NetworkLedgerEntry, NetworkQuote, NetworkRoute, NetworkTransaction, NetworkTxState, NetworkAccount } from "../../../../shared/network.js";
import { getSettings } from "../settings.js";
import { register, touch } from "../persist.js";
import { id } from "../ids.js";
import { adapterById, adaptersFor } from "./adapters.js";
import * as liquidity from "./liquidity.js";
import { settle as lightningSettle } from "./settlement.js";
import { fxExpired } from "./fx.js";
import { corridorId, MARKETS } from "./markets.js";
import * as notifyNet from "./notify.js";
import { store, usingPostgres } from "../../db/store.js";
import { background } from "../background.js";

/* ---------- durable state ---------- */
const intents = new Map<string, NetworkIntent>();
const quotes = new Map<string, NetworkQuote>();
const routes = new Map<string, NetworkRoute>();
const txs = new Map<string, NetworkTransaction>();
const ledger: NetworkLedgerEntry[] = [];
register("network_intents", () => [...intents.values()].slice(-20_000), (d: NetworkIntent[]) => { for (const x of d ?? []) intents.set(x.id, x); });
register("network_quotes", () => [...quotes.values()].slice(-20_000), (d: NetworkQuote[]) => { for (const x of d ?? []) quotes.set(x.id, x); });
register("network_routes", () => [...routes.values()].slice(-20_000), (d: NetworkRoute[]) => { for (const x of d ?? []) routes.set(x.id, x); });
register("network_txs", () => [...txs.values()].slice(-20_000), (d: NetworkTransaction[]) => { for (const x of d ?? []) txs.set(x.id, x); });
register("network_ledger", () => ledger.slice(-200_000), (d: NetworkLedgerEntry[]) => { ledger.length = 0; ledger.push(...(d ?? [])); });

const now = () => new Date().toISOString();

/** Postgres: the per-row tables are authoritative over the bounded snapshot. Runs at boot
 *  after hydrateSnapshots (index.ts / api/index.ts); no-op on memory. */
export async function hydrateNetwork(): Promise<void> {
  if (!usingPostgres()) return;
  try {
    const [rows, legs] = await Promise.all([store().allNetworkTxs(), store().allNetworkLedger()]);
    if (rows.length) { txs.clear(); for (const t of rows as NetworkTransaction[]) txs.set(t.id, t); }
    if (legs.length) { ledger.length = 0; ledger.push(...(legs as NetworkLedgerEntry[])); }
    console.log(`[network] hydrated ${rows.length} transaction(s), ${legs.length} ledger leg(s) from Postgres`);
  } catch (e) { console.error("network hydrate", e); }
}
export const saveIntent = (i: NetworkIntent) => { i.updatedAt = now(); intents.set(i.id, i); touch("network_intents"); };
export const saveQuote = (q: NetworkQuote) => { quotes.set(q.id, q); touch("network_quotes"); };
export const saveRoute = (r: NetworkRoute) => { routes.set(r.id, r); touch("network_routes"); };
export const getIntent = (i: string) => intents.get(i);
export const getQuote = (i: string) => quotes.get(i);
export const getRoute = (i: string) => routes.get(i);
export const getTx = (i: string) => txs.get(i);
export const txByRef = (ref: string) => [...txs.values()].find((t) => t.ref === ref);
export const txOfIntent = (intentId: string) => [...txs.values()].find((t) => t.intentId === intentId);
export const allTx = (limit = 200) => [...txs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
export const ledgerFor = (txId: string) => ledger.filter((e) => e.txId === txId);
export const ledgerAll = () => ledger;

/** Every mutation of a transaction goes through here: snapshot + per-row upsert (Postgres). */
function persistTx(t: NetworkTransaction): void { txs.set(t.id, t); touch("network_txs"); background(store().upsertNetworkTx(t)); }
function move(t: NetworkTransaction, state: NetworkTxState, note?: string, ref?: string): void {
  t.state = state; t.updatedAt = now();
  t.events.push({ at: t.updatedAt, state, ...(note ? { note } : {}), ...(ref ? { ref } : {}) });
  persistTx(t);
  console.log(`[network] ${t.ref} → ${state}${note ? ` · ${note}` : ""}`);
}

/** Balanced journal entry — throws if any currency does not balance (§27). */
function book(t: NetworkTransaction, legs: Array<{ account: NetworkAccount; direction: "debit" | "credit"; amount: number; currency: string; market?: string; memo?: string }>): void {
  if (t.shadow) return; // shadow never books
  const byCcy = new Map<string, number>();
  for (const l of legs) byCcy.set(l.currency, (byCcy.get(l.currency) ?? 0) + (l.direction === "debit" ? l.amount : -l.amount));
  for (const [c, v] of byCcy) if (Math.abs(v) > 1e-6) throw new Error(`network ledger unbalanced in ${c}: ${v}`);
  const at = now();
  for (const l of legs) {
    const e: NetworkLedgerEntry = { id: id("nle"), txId: t.id, at, account: l.account, market: l.market, direction: l.direction, amount: l.amount, currency: l.currency, memo: l.memo };
    ledger.push(e);
    background(store().appendNetworkLedger(e)); // per-row, append-only, idempotent on id
  }
  touch("network_ledger");
}

/* ---------- gates (§43, §45) + canary controls (PHASE 7) ---------- */
/** Stable 0–99 bucket for an owner id, so a rollout percentage admits the same devices
 *  every time (a device is either in the canary or not — never flapping). */
export function rolloutBucket(owner: string): number {
  let h = 2166136261;
  for (let i = 0; i < owner.length; i++) { h ^= owner.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % 100;
}
/** Source-currency volume executed (non-shadow, not failed before money moved) on a
 *  corridor in the last 24 h — what the daily canary cap counts. */
export function corridorVolume24h(corridor: string, now = Date.now()): number {
  const since = now - 24 * 60 * 60_000;
  let sum = 0;
  for (const t of txs.values()) {
    if (t.shadow || t.corridor !== corridor || Date.parse(t.createdAt) < since) continue;
    if (t.state === "COLLECTION_FAILED" || t.state === "REFUNDED") continue;
    sum += t.source.amount;
  }
  return sum;
}
export function executionGate(corridor: string, domestic: boolean, ctx: { owner?: string; amount?: number } = {}): { ok: boolean; reason?: string } {
  const n = getSettings().network;
  if (!n.flags.INTEROPERABILITY_V2) return { ok: false, reason: "INTEROPERABILITY_V2 is off" };
  if (!n.flags.ROUTING_ENGINE) return { ok: false, reason: "ROUTING_ENGINE is off" };
  if (!n.flags.LIQUIDITY_ENGINE) return { ok: false, reason: "LIQUIDITY_ENGINE is off" };
  if (!domestic && !n.flags.CROSS_BORDER_PAYMENTS) return { ok: false, reason: "CROSS_BORDER_PAYMENTS is off" };
  if (!domestic && !n.corridors[corridor]) return { ok: false, reason: `corridor ${corridor} is not switched on` };
  // Canary: who may execute (allowlist, then the rollout share) and how much (per
  // transaction, per rolling day) — per corridor, in source currency. The domestic
  // corridor is today's production flow and is not canaried by these controls.
  if (!domestic) {
    const c = n.canary;
    const owner = ctx.owner ?? "";
    const listed = c.allowlist.includes(owner);
    if (!listed && c.rolloutPct <= 0) return { ok: false, reason: "canary: no rollout yet — add the device to the allowlist or raise the rollout share" };
    if (!listed && c.rolloutPct < 100 && rolloutBucket(owner) >= c.rolloutPct) return { ok: false, reason: `canary: this device is outside the ${c.rolloutPct} % rollout` };
    const amount = ctx.amount ?? 0;
    const perTx = c.maxPerTx[corridor];
    if (typeof perTx === "number" && perTx > 0 && amount > perTx) return { ok: false, reason: `canary: above the ${corridor} per-transaction cap (${perTx})` };
    const perDay = c.maxPerDay[corridor];
    if (typeof perDay === "number" && perDay > 0 && corridorVolume24h(corridor) + amount > perDay) return { ok: false, reason: `canary: the ${corridor} daily cap (${perDay}) would be exceeded` };
  }
  return { ok: true };
}

/* ---------- create + execute ---------- */
const refOf = () => `MMX-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0")}`;

/** Confirm an intent on a quote: reserve destination liquidity FIRST (§11), then start
 *  collection. Returns the transaction in COLLECTION_PENDING, or the reason it was refused. */
export async function begin(intent: NetworkIntent, quote: NetworkQuote, route: NetworkRoute, opts: { shadow?: boolean } = {}): Promise<{ ok: true; tx: NetworkTransaction } | { ok: false; error: string; message: string }> {
  const existing = txOfIntent(intent.id);
  if (existing) return { ok: true, tx: existing }; // idempotent on the intent
  if (Date.parse(quote.expiresAt) < Date.now() || fxExpired(quote.fx)) return { ok: false, error: "quote_expired", message: "This quote has expired — please re-quote." };
  if (!route.available) return { ok: false, error: "route_unavailable", message: route.reasons.join("; ") || "No route can complete this payment right now." };
  const shadow = !!opts.shadow;
  const domestic = intent.sourceMarket === intent.destinationMarket;
  if (!shadow) { const g = executionGate(route.corridor, domestic, { owner: intent.owner, amount: intent.sourceAmount }); if (!g.ok) return { ok: false, error: g.reason?.startsWith("canary") ? "canary_refused" : "network_off", message: g.reason! }; }
  const t: NetworkTransaction = {
    id: id("ntx"), ref: refOf(), intentId: intent.id, quoteId: quote.id, routeId: route.id, corridor: route.corridor, routeType: route.type, state: "CREATED",
    source: { market: intent.sourceMarket, provider: intent.sourceProvider, currency: intent.sourceCurrency, phone: intent.sourcePhone, amount: intent.sourceAmount },
    destination: { market: intent.destinationMarket, provider: intent.destinationProvider, currency: intent.destinationCurrency, phone: intent.destinationPhone, name: intent.destinationName, amount: quote.destinationAmount },
    fees: quote.fees, fx: quote.fx, settlementSats: quote.settlementSats, refs: {}, appliedEvents: [], shadow, events: [], createdAt: now(), updatedAt: now(),
  };
  txs.set(t.id, t); move(t, "CREATED", shadow ? "shadow — no funds move" : `route ${route.type}`);
  intent.status = "CONFIRMED"; intent.txId = t.id; intent.routeId = route.id; intent.quoteId = quote.id; saveIntent(intent);
  if (shadow) return { ok: true, tx: t };

  // 1. Destination liquidity reservation — never accept what cannot be fulfilled (§11).
  const r = await liquidity.reserve(route.destinationSourceId, t.id, t.destination.amount);
  if (!r.ok) { move(t, "COLLECTION_FAILED", `liquidity not reservable: ${r.reason}`); return { ok: false, error: "liquidity_unavailable", message: "This corridor is temporarily unavailable — the destination cannot be funded right now." }; }
  t.refs.liquidityReservationId = r.reservation.id;
  move(t, "LIQUIDITY_RESERVED", `${t.destination.amount} ${t.destination.currency} reserved at ${route.destinationSourceId}`);

  // 2. Source collection — the payer approves on their phone; we wait for the provider.
  const col = adapterById(route.collectionAdapter);
  if (!col) { liquidity.release(r.reservation.id); move(t, "COLLECTION_FAILED", "collection adapter missing"); return { ok: false, error: "route_unavailable", message: "Collection is not available." }; }
  const res = await col.createCollection({ idempotencyKey: `${t.id}:collect`, market: t.source.market, provider: t.source.provider, phone: t.source.phone, amount: t.source.amount, currency: t.source.currency }).catch((e) => ({ accepted: false, providerRef: "", simulated: false, error: e instanceof Error ? e.message : "collect failed" }));
  if (!res.accepted) { liquidity.release(r.reservation.id); move(t, "COLLECTION_FAILED", res.error ?? "collection refused"); return { ok: false, error: "collection_failed", message: "The collection request could not be sent to the payer's phone." }; }
  t.refs.sourceCollectionId = `${t.id}:collect`; t.refs.sourceProviderRef = res.providerRef;
  move(t, "COLLECTION_PENDING", `collection ${res.providerRef} sent to +${t.source.phone}`);
  return { ok: true, tx: t };
}

/** The source pool owes the payer their money back (refund liability). */
function bookRefundOwed(t: NetworkTransaction): void {
  book(t, [
    { account: "src_pool", direction: "debit", amount: t.source.amount, currency: t.source.currency, market: t.source.market, memo: "refund owed" },
    { account: "refund_payable", direction: "credit", amount: t.source.amount, currency: t.source.currency, market: t.source.market, memo: `refund to +${t.source.phone}` },
  ]);
}

/** The payer did not approve in time: release the destination reservation and close the
 *  attempt. If the provider later reports the money collected anyway, onCollectionEvent
 *  books it and routes it to a refund — it is never left unaccounted. */
export function expireCollection(t: NetworkTransaction, minutes: number): void {
  if (t.shadow || t.state !== "COLLECTION_PENDING") return;
  if (t.refs.liquidityReservationId) liquidity.release(t.refs.liquidityReservationId);
  t.refs.liquidityReservationId = undefined;
  move(t, "COLLECTION_FAILED", `expired — the payer did not approve within ${minutes} min`);
}

/** Provider event for the collection leg (webhook or status poll). Deduplicated by event id. */
export async function onCollectionEvent(txId: string, eventId: string, status: "COMPLETED" | "FAILED" | "PENDING"): Promise<void> {
  const t = txs.get(txId); if (!t || t.shadow) return;
  if (t.appliedEvents.includes(eventId)) return; // duplicate webhook (§31)
  t.appliedEvents.push(eventId);
  if (t.state === "COLLECTION_FAILED" && status === "COMPLETED" && t.refs.sourceCollectionId && !t.events.some((e) => e.state === "COLLECTION_CONFIRMED")) {
    // Late collection after expiry: the money is IN with no leg in flight — owe it back.
    book(t, [
      { account: "src_collection_clearing", direction: "debit", amount: t.source.amount, currency: t.source.currency, market: t.source.market, memo: "collected from payer (late)" },
      { account: "src_pool", direction: "credit", amount: t.source.amount, currency: t.source.currency, market: t.source.market, memo: "owed onward" },
    ]);
    move(t, "COLLECTION_CONFIRMED", `${t.source.amount} ${t.source.currency} collected after expiry`, eventId);
    t.recovery = "refund"; bookRefundOwed(t); move(t, "REFUND_PENDING", "collected after expiry — refund the payer");
    void notifyNet.networkRefunding(t, "the payer approved after the request had expired");
    return;
  }
  if (t.state !== "COLLECTION_PENDING") { persistTx(t); return; } // late/duplicate after a transition
  if (status === "PENDING") { persistTx(t); return; }
  if (status === "FAILED") {
    if (t.refs.liquidityReservationId) liquidity.release(t.refs.liquidityReservationId);
    move(t, "COLLECTION_FAILED", "payer did not approve / provider declined", eventId);
    return;
  }
  // Money is IN: the source pool holds it, the platform owes the recipient.
  book(t, [
    { account: "src_collection_clearing", direction: "debit", amount: t.source.amount, currency: t.source.currency, market: t.source.market, memo: "collected from payer" },
    { account: "src_pool", direction: "credit", amount: t.source.amount, currency: t.source.currency, market: t.source.market, memo: "owed onward" },
  ]);
  move(t, "COLLECTION_CONFIRMED", `${t.source.amount} ${t.source.currency} collected`, eventId);
  await advance(t);
}

/** Drive the transaction from a confirmed collection to a confirmed payout. Re-entrant:
 *  each step is idempotent, so a crash and a retry pick up where it stopped. */
export async function advance(t: NetworkTransaction): Promise<void> {
  if (t.shadow) return;
  const route = routes.get(t.routeId)!;
  const domestic = t.source.market === t.destination.market;
  if (t.state === "COLLECTION_CONFIRMED") {
    if (domestic) {
      // Same-market: the pool pays the aggregator; no Lightning leg (this is production's flow).
      move(t, "LIGHTNING_CONFIRMED", "same-market route — no Lightning leg");
    } else {
      const ln = liquidity.sourceById(route.lightningSourceId)!, dst = liquidity.sourceById(route.destinationSourceId)!;
      move(t, "LIGHTNING_SENT", `${t.settlementSats} sats via ${ln.id}`);
      const s = await lightningSettle({ idempotencyKey: `${t.id}:ln`, sats: t.settlementSats, lightningSource: ln, destination: dst, memo: t.ref });
      if (!s.ok) {
        // The source money is in; nothing left the network. Refund path (§29).
        move(t, "LIGHTNING_FAILED", s.error ?? "settlement failed");
        if (t.refs.liquidityReservationId) liquidity.release(t.refs.liquidityReservationId);
        t.recovery = "refund"; bookRefundOwed(t); move(t, "REFUND_PENDING", "refund the payer — nothing reached the destination");
        void notifyNet.networkRefunding(t, s.error ?? "the settlement leg failed");
        return;
      }
      t.refs.lightningPaymentId = s.settlementId; t.refs.settlementId = s.settlementId;
      const btc = t.settlementSats / 1e8;
      // Source pool buys the settlement value (fiat → sats); the network's Lightning position
      // carries it; the destination pool absorbs it (sats → destination fiat).
      book(t, [
        { account: "src_pool", direction: "debit", amount: t.source.amount - t.fees.momome, currency: t.source.currency, market: t.source.market, memo: "converted to settlement value" },
        { account: "fx_pnl", direction: "credit", amount: t.source.amount - t.fees.momome, currency: t.source.currency, market: t.source.market, memo: "fiat leg of the conversion" },
        { account: "fee_revenue", direction: "credit", amount: t.fees.momome, currency: t.source.currency, market: t.source.market, memo: "platform fee" },
        { account: "src_pool", direction: "debit", amount: t.fees.momome, currency: t.source.currency, market: t.source.market, memo: "platform fee" },
      ]);
      book(t, [
        { account: "fx_pnl", direction: "debit", amount: btc, currency: "BTC", memo: "settlement value acquired" },
        { account: "lightning_position", direction: "credit", amount: btc, currency: "BTC", memo: "sent over Lightning" },
      ]);
      move(t, "LIGHTNING_CONFIRMED", `${s.method} · ${s.settlementId} · fee ${s.feesSats} sats · ${s.latencyMs} ms`, s.settlementId);
    }
  }
  if (t.state === "LIGHTNING_CONFIRMED") {
    const pay = adapterById(route.payoutAdapter);
    if (!pay) { move(t, "DESTINATION_SETTLEMENT_FAILED", "payout adapter missing"); t.recovery = "manual"; persistTx(t); return; }
    if (t.refs.liquidityReservationId) liquidity.commit(t.refs.liquidityReservationId);
    move(t, "PAYOUT_INITIATED", `${t.destination.amount} ${t.destination.currency} to ${t.destination.provider} via ${pay.aggregator}`);
    const r = await pay.createPayout({ idempotencyKey: `${t.id}:payout`, market: t.destination.market, provider: t.destination.provider, phone: t.destination.phone, amount: t.destination.amount, currency: t.destination.currency, name: t.destination.name }).catch((e) => ({ accepted: false, providerRef: "", simulated: false, error: e instanceof Error ? e.message : "payout failed" }));
    if (!r.accepted) { move(t, "DESTINATION_SETTLEMENT_FAILED", r.error ?? "payout refused"); t.recovery = "retry"; persistTx(t); void notifyNet.networkNeedsPerson(t, r.error ?? "the destination payout was refused"); return; }
    t.refs.destinationPayoutId = `${t.id}:payout`; t.refs.destinationProviderRef = r.providerRef; persistTx(t);
    if (r.simulated) await onPayoutEvent(t.id, `${r.providerRef}:sim`, (await pay.getPayoutStatus(`${t.id}:payout`)) ?? "PENDING");
  }
}

/** Provider event for the payout leg. Deduplicated; a second COMPLETED is a no-op. */
export async function onPayoutEvent(txId: string, eventId: string, status: "COMPLETED" | "FAILED" | "PENDING"): Promise<void> {
  const t = txs.get(txId); if (!t || t.shadow) return;
  if (t.appliedEvents.includes(eventId)) return;
  t.appliedEvents.push(eventId);
  if (t.state !== "PAYOUT_INITIATED") { persistTx(t); return; }
  if (status === "PENDING") { persistTx(t); return; }
  if (status === "FAILED") {
    move(t, "DESTINATION_SETTLEMENT_FAILED", "payout failed after settlement — funds are on the ledger", eventId);
    t.recovery = "retry"; persistTx(t);
    void notifyNet.networkNeedsPerson(t, "the destination payout failed after settlement");
    return;
  }
  const domestic = t.source.market === t.destination.market;
  if (domestic) {
    book(t, [
      { account: "src_pool", direction: "debit", amount: t.source.amount, currency: t.source.currency, market: t.source.market, memo: "paid out + fees" },
      { account: "dst_recipient", direction: "credit", amount: t.destination.amount, currency: t.destination.currency, market: t.destination.market, memo: "delivered" },
      { account: "fee_revenue", direction: "credit", amount: t.source.amount - t.destination.amount, currency: t.source.currency, market: t.source.market, memo: "fees + spread" },
    ]);
  } else {
    const btc = t.settlementSats / 1e8;
    book(t, [
      { account: "lightning_position", direction: "debit", amount: btc, currency: "BTC", memo: "absorbed by destination pool" },
      { account: "dst_pool", direction: "credit", amount: btc, currency: "BTC", market: t.destination.market, memo: "settlement value received" },
    ]);
    book(t, [
      { account: "dst_pool", direction: "debit", amount: t.destination.amount, currency: t.destination.currency, market: t.destination.market, memo: "paid from local liquidity" },
      { account: "dst_recipient", direction: "credit", amount: t.destination.amount, currency: t.destination.currency, market: t.destination.market, memo: "delivered" },
    ]);
  }
  if (t.refs.liquidityReservationId) liquidity.settle(t.refs.liquidityReservationId);
  move(t, "PAYOUT_CONFIRMED", `${t.destination.amount} ${t.destination.currency} delivered`, eventId);
  move(t, "COMPLETED", "source confirmed · settlement confirmed · payout confirmed · ledger balanced");
  void notifyNet.networkDelivered(t);
}

/* ---------- recovery (§29) ---------- */
export async function recover(txId: string, action: "retry" | "alternate_provider" | "manual" | "refund", by: string): Promise<{ ok: boolean; error?: string }> {
  const t = txs.get(txId);
  if (!t) return { ok: false, error: "not_found" };
  if (t.state !== "DESTINATION_SETTLEMENT_FAILED" && t.state !== "LIGHTNING_FAILED") return { ok: false, error: "not_recoverable" };
  t.recovery = action;
  if (action === "manual") { move(t, "MANUAL_REVIEW", `held for an operator by ${by}`); void notifyNet.networkNeedsPerson(t, `held by ${by}`); return { ok: true }; }
  if (action === "refund") {
    if (t.refs.liquidityReservationId) liquidity.release(t.refs.liquidityReservationId);
    bookRefundOwed(t);
    move(t, "REFUND_PENDING", `refund of ${t.source.amount} ${t.source.currency} to the payer, by ${by}`);
    void notifyNet.networkRefunding(t, `refund chosen by ${by}`);
    return { ok: true };
  }
  // retry / alternate provider: re-enter the payout step with a NEW idempotency key so the
  // provider does not return the failed attempt, but the same transaction and ledger.
  const route = routes.get(t.routeId)!;
  if (action === "alternate_provider") {
    const alt = adaptersFor(t.destination.market).find((a) => a.id !== route.payoutAdapter && a.supports(t.destination.provider, "payout"));
    if (!alt) return { ok: false, error: "no_alternate" };
    route.payoutAdapter = alt.id; saveRoute(route);
  }
  t.refs.destinationPayoutId = undefined;
  move(t, "LIGHTNING_CONFIRMED", `${action} by ${by}`);
  // A fresh key per attempt (attempt count in the key) — never re-submit the failed one.
  const attempt = t.events.filter((e) => e.state === "PAYOUT_INITIATED").length + 1;
  const pay = adapterById(route.payoutAdapter)!;
  move(t, "PAYOUT_INITIATED", `attempt ${attempt}`);
  const r = await pay.createPayout({ idempotencyKey: `${t.id}:payout:${attempt}`, market: t.destination.market, provider: t.destination.provider, phone: t.destination.phone, amount: t.destination.amount, currency: t.destination.currency, name: t.destination.name }).catch((e) => ({ accepted: false, providerRef: "", simulated: false, error: e instanceof Error ? e.message : "payout failed" }));
  if (!r.accepted) { move(t, "DESTINATION_SETTLEMENT_FAILED", r.error ?? "payout refused"); return { ok: true }; }
  t.refs.destinationPayoutId = `${t.id}:payout:${attempt}`; t.refs.destinationProviderRef = r.providerRef; persistTx(t);
  if (r.simulated) await onPayoutEvent(t.id, `${r.providerRef}:sim`, (await pay.getPayoutStatus(`${t.id}:payout:${attempt}`)) ?? "PENDING");
  return { ok: true };
}
/** Refund the payer over the source market's payout rail — idempotent on the transaction
 *  (one key, `${id}:refund`), so a tick that runs twice can never refund twice. The
 *  liability stays on the books until the rail confirms; markRefunded closes it. */
export async function submitRefund(t: NetworkTransaction): Promise<{ ok: boolean; error?: string }> {
  if (t.shadow || t.state !== "REFUND_PENDING") return { ok: false, error: "not_refund_pending" };
  if (t.refs.refundPayoutId) return { ok: true }; // already submitted — poll it
  const rail = adaptersFor(t.source.market).find((a) => a.supports(t.source.provider, "payout"));
  if (!rail) return { ok: false, error: `no payout rail for ${t.source.provider} in ${t.source.market}` };
  const key = `${t.id}:refund`;
  const r = await rail.createPayout({ idempotencyKey: key, market: t.source.market, provider: t.source.provider, phone: t.source.phone, amount: t.source.amount, currency: t.source.currency }).catch((e) => ({ accepted: false, providerRef: "", simulated: false, error: e instanceof Error ? e.message : "refund failed" }));
  if (!r.accepted) { t.events.push({ at: now(), state: t.state, note: `refund not accepted: ${r.error ?? "refused"}` }); persistTx(t); return { ok: false, error: r.error ?? "refused" }; }
  t.refs.refundPayoutId = key; t.refs.refundProviderRef = r.providerRef;
  t.events.push({ at: now(), state: t.state, note: `refund ${r.providerRef} sent to +${t.source.phone} via ${rail.aggregator}`, ref: r.providerRef });
  persistTx(t);
  if (r.simulated) { const st = await rail.getPayoutStatus(key); if (st === "COMPLETED") markRefunded(t.id, r.providerRef, "auto"); else if (st === "FAILED") onRefundFailed(t, "simulated failure"); }
  return { ok: true };
}
export function onRefundFailed(t: NetworkTransaction, why: string): void {
  if (t.state !== "REFUND_PENDING") return;
  t.refs.refundPayoutId = undefined; t.refs.refundProviderRef = undefined; t.recovery = "manual";
  t.events.push({ at: now(), state: t.state, note: `refund failed: ${why} — for an operator` }); persistTx(t);
  void notifyNet.networkNeedsPerson(t, `the automatic refund failed: ${why}`);
}
export function markRefunded(txId: string, refundRef: string, by: string): boolean {
  const t = txs.get(txId); if (!t || t.state !== "REFUND_PENDING") return false;
  t.refs.refundRef = refundRef;
  book(t, [
    { account: "refund_payable", direction: "debit", amount: t.source.amount, currency: t.source.currency, market: t.source.market, memo: "refunded" },
    { account: "src_collection_clearing", direction: "credit", amount: t.source.amount, currency: t.source.currency, market: t.source.market, memo: `returned to payer (${refundRef})` },
  ]);
  move(t, "REFUNDED", `refunded by ${by} · ${refundRef}`);
  void notifyNet.networkRefunded(t);
  return true;
}

/** Ledger balance per currency for a transaction — zero when the books balance. */
export function ledgerBalanced(txId: string): boolean {
  const by = new Map<string, number>();
  for (const e of ledgerFor(txId)) by.set(e.currency, (by.get(e.currency) ?? 0) + (e.direction === "debit" ? e.amount : -e.amount));
  return [...by.values()].every((v) => Math.abs(v) < 1e-6);
}
export const isDomestic = (t: NetworkTransaction) => t.source.market === t.destination.market;
export const corridorOf = (t: NetworkTransaction) => corridorId(t.source.market, t.destination.market);
export const marketName = (c: string) => MARKETS[c]?.name ?? c;
