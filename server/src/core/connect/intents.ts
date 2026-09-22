/* ============================================================
   MoMo›Me Connect — the canonical Payment Intent (§7, §8, §20, §24).

   "Pay 100 000 XAF to Company A." Every surface — API, invoice, payment link, hosted
   checkout, QR, request-to-pay, Lightning Address — creates or references ONE intent.
   Payment status and settlement status are separate fields. Execution never moves money
   itself: the internal route is a ledger transaction (connect/ledger.ts); every external
   route mints a payment in the EXISTING engine (buildQuote + createPaymentCore) whose
   lifecycle drives this intent through the transition hook. Nothing is duplicated.
   ============================================================ */
import crypto from "node:crypto";
import type { Request } from "express";
import { register, touch } from "../persist.js";
import { getMpi, mpiForPhone, type Mpi, type PaymentMethodId, type SettlementMethodId } from "./identities.js";
import { getCounterparty } from "./counterparties.js";
import { decide, type RouteDecision } from "./routing.js";
import { internalTransfer } from "./ledger.js";
import { buildQuote, createPaymentCore } from "../../routes/api.js";
import type { Payment, Quote, Method, CountryCode } from "../../../../shared/types.js";
import { COUNTRIES, checkPhone, splitDialed } from "../../../../shared/domain.js";
import { enqueueEvent } from "../interop/outbound.js";
import { effectiveFeePct } from "../platform/billing.js";
import { putMeta, updateMeta } from "../platform/paymentMeta.js";
import { publicPayment } from "../platform/mapping.js";
import { store } from "../../db/store.js";
import { config } from "../../config.js";
import * as momoTransfer from "../momoTransfer.js";

export type PaymentStatus = "created" | "authorized" | "pending" | "processing" | "completed" | "failed" | "expired" | "reversed";
export type SettlementStatus = "not_applicable" | "pending" | "processing" | "settled" | "failed" | "reversed";
export type Surface = "api" | "invoice" | "payment_link" | "checkout" | "qr" | "request_to_pay" | "lightning_address" | "pos" | "sdk";
export interface PaymentIntent {
  id: string; orgId: string; env: "live" | "test"; surface: Surface;
  payee: { mpi: string }; payer: { mpi?: string; counterparty?: string; anonymous?: boolean; name?: string };
  amount: { value: number; currency: string };
  purpose: { type: "invoice" | "payment" | "request" | "checkout"; reference?: string; description?: string };
  permittedMethods: PaymentMethodId[]; settlement: { currency: string; method: SettlementMethodId };
  expiresAt: string; metadata: Record<string, string>; callbackUrl?: string;
  status: PaymentStatus; settlementStatus: SettlementStatus;
  route?: RouteDecision; execution?: { kind: "internal_ledger" | "external_payment" | "momo_collection"; method?: PaymentMethodId; paymentId?: string; ledgerRef?: string; instruction?: unknown };
  events: Array<{ at: string; status: PaymentStatus; note?: string }>; createdAt: string; updatedAt: string;
  /** Invoice / request this intent belongs to, when created by one. */ invoiceId?: string;
}
const intents = new Map<string, PaymentIntent>();
const byPayment = new Map<string, string>();
register("connect_intents", () => [...intents.values()].slice(-20_000), (d: PaymentIntent[]) => { for (const i of d) { intents.set(i.id, i); if (i.execution?.paymentId) byPayment.set(i.execution.paymentId, i.id); } });
const now = () => new Date().toISOString();
const TERMINAL: PaymentStatus[] = ["completed", "failed", "expired", "reversed"];

export class ConnectError extends Error { constructor(public code: string, message: string, public status = 400, public details: Record<string, unknown> = {}) { super(message); } }

export function getIntent(id: string): PaymentIntent | undefined { return intents.get(id); }
export const intentOfPayment = (paymentId: string) => { const id = byPayment.get(paymentId); return id ? intents.get(id) : undefined; };
export const intentsOf = (orgId: string, env: string, limit = 100) => [...intents.values()].filter((i) => i.orgId === orgId && i.env === env).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);

function move(i: PaymentIntent, status: PaymentStatus, note?: string): void {
  if (i.status === status) return;
  i.status = status; i.updatedAt = now(); i.events.push({ at: i.updatedAt, status, note }); touch("connect_intents");
  enqueueEvent(`org:${i.orgId}`, `payment.${status}`, publicIntent(i));
}
export function setSettlement(i: PaymentIntent, s: SettlementStatus, note?: string): void { if (i.settlementStatus === s) return; i.settlementStatus = s; i.updatedAt = now(); if (note) i.events.push({ at: i.updatedAt, status: i.status, note }); touch("connect_intents"); enqueueEvent(`org:${i.orgId}`, `settlement.${s === "settled" ? "completed" : s}`, publicIntent(i)); }

export interface CreateIntentInput {
  orgId: string; env: "live" | "test"; surface: Surface; payee: Mpi;
  payer?: { mpi?: string; counterparty?: string; name?: string; phone?: string };
  amountXaf: number; currency?: string; purpose?: PaymentIntent["purpose"];
  permittedMethods?: PaymentMethodId[]; settlement?: Partial<PaymentIntent["settlement"]>;
  ttlMs?: number; metadata?: Record<string, string>; callbackUrl?: string; invoiceId?: string;
}
export function createIntent(input: CreateIntentInput): PaymentIntent {
  if (!Number.isFinite(input.amountXaf) || input.amountXaf <= 0) throw new ConnectError("INVALID_REQUEST", "amount must be a positive number of XAF.", 422);
  const currency = (input.currency ?? "XAF").toUpperCase(); if (currency !== "XAF") throw new ConnectError("INVALID_REQUEST", "Only XAF intents are supported in this release.", 422);
  const payer: PaymentIntent["payer"] = { name: input.payer?.name };
  if (input.payer?.mpi) { if (!getMpi(input.payer.mpi)) throw new ConnectError("IDENTITY_NOT_FOUND", "Unknown payer identity.", 404); payer.mpi = input.payer.mpi; }
  else if (input.payer?.counterparty) { const cp = getCounterparty(input.payer.counterparty); if (!cp || cp.orgId !== input.orgId) throw new ConnectError("IDENTITY_NOT_FOUND", "Unknown counterparty.", 404); payer.counterparty = cp.id; if (cp.linkedMpi) payer.mpi = cp.linkedMpi; }
  else if (input.payer?.phone) { const m = mpiForPhone(input.payer.phone, input.payee.country, input.payer.name); if (m) payer.mpi = m.id; }
  else payer.anonymous = true;
  const permitted = (input.permittedMethods?.length ? input.permittedMethods : input.payee.payment.methods).filter((m) => input.payee.payment.methods.includes(m));
  const i: PaymentIntent = {
    id: `pi_${crypto.randomBytes(9).toString("hex")}`, orgId: input.orgId, env: input.env, surface: input.surface, payee: { mpi: input.payee.id }, payer,
    amount: { value: Math.round(input.amountXaf), currency }, purpose: input.purpose ?? { type: "payment" }, permittedMethods: permitted,
    settlement: { currency: input.payee.settlement.currency, method: input.payee.settlement.preferred, ...(input.settlement ?? {}) },
    expiresAt: new Date(Date.now() + (input.ttlMs ?? 24 * 3_600_000)).toISOString(), metadata: input.metadata ?? {}, callbackUrl: input.callbackUrl,
    status: "created", settlementStatus: "pending", events: [{ at: now(), status: "created" }], createdAt: now(), updatedAt: now(), invoiceId: input.invoiceId,
  };
  intents.set(i.id, i); touch("connect_intents");
  enqueueEvent(`org:${i.orgId}`, "payment.created", publicIntent(i));
  return i;
}

/** The route decision for a payer context (pure; also what the checkout shows). */
export function routeFor(i: PaymentIntent, opts: { wanted?: PaymentMethodId; payerMpi?: string } = {}) {
  const payee = getMpi(i.payee.mpi)!; const payer = (opts.payerMpi ?? i.payer.mpi) ? getMpi(opts.payerMpi ?? i.payer.mpi!) : undefined;
  return decide({ payee, payer, amountXaf: i.amount.value, permitted: i.permittedMethods, wanted: opts.wanted });
}

/** Execute: the internal ledger route, or mint the funding instruction on the existing engine. */
export async function executeIntent(i: PaymentIntent, opts: { req: Request; wanted?: PaymentMethodId; payerMpi?: string; payerPhone?: string; ownerForEngine: string }): Promise<PaymentIntent> {
  if (TERMINAL.includes(i.status)) throw new ConnectError("PAYMENT_FAILED", `This payment is ${i.status}.`, 409, { status: i.status });
  if (Date.parse(i.expiresAt) <= Date.now()) { move(i, "expired", "intent expired before execution"); throw new ConnectError("PAYMENT_EXPIRED", "This payment request has expired.", 410); }
  if (i.execution?.paymentId || i.execution?.kind === "internal_ledger") return i; // idempotent: already executing
  const payee = getMpi(i.payee.mpi); if (!payee || payee.status !== "active") throw new ConnectError("IDENTITY_NOT_FOUND", "Payee identity unavailable.", 404);
  const payerMpi = opts.payerMpi ?? i.payer.mpi;
  const d = routeFor(i, { wanted: opts.wanted, payerMpi });
  if ("error" in d) throw new ConnectError("ROUTE_UNAVAILABLE", "No payment route is available for this request right now.", 503, { explanation: d.explanation });
  i.route = d;
  const { feePct } = effectiveFeePct(i.orgId, i.env);
  if (d.kind === "internal") {
    const feeXaf = Math.round((i.amount.value * feePct) / 100);
    move(i, "processing", "internal ledger transfer");
    if (!internalTransfer(i.id, payerMpi!, payee.id, i.amount.value, feeXaf)) { move(i, "failed", "payer balance insufficient at execution"); throw new ConnectError("INSUFFICIENT_LIQUIDITY", "The payer's balance no longer covers this amount.", 409); }
    i.execution = { kind: "internal_ledger", method: "momo_me", ledgerRef: i.id };
    move(i, "completed", "settled on the MoMo›Me ledger");
    setSettlement(i, payee.settlement.preferred === "momo_me" ? "settled" : "pending", payee.settlement.preferred === "momo_me" ? "value is on the payee's MoMo›Me balance" : `payee settles by ${payee.settlement.preferred} — settlement intent opened`);
    return i;
  }
  // External funding: the payee's Mobile Money settlement destination receives the payout
  // through the engine exactly as a send-flow payment would (docs/connect: settlement to a
  // MoMo›Me balance is honoured on the internal route; external funding settles to Mobile Money).
  const dest = payee.settlement.destination;
  if (!dest?.phone) throw new ConnectError("ROUTE_UNAVAILABLE", "The payee has no Mobile Money settlement destination for externally funded payments.", 503, { explanation: [...d.explanation, "payee settlement profile lacks a mobile money destination"] });
  const sp = splitDialed(`+${dest.phone}`, dest.country ?? payee.country); const chk = checkPhone(sp.local, sp.country);
  if (!chk.ok || !chk.provider) throw new ConnectError("ROUTE_UNAVAILABLE", "The payee's settlement number is not valid.", 503);
  if (d.method === "mobile_money") {
    // Mobile Money as a PAYMENT METHOD: the payer approves a collection on their own network,
    // the payee is paid out on theirs (or over Lightning beyond our corridors) — the existing
    // MoMo→MoMo product, admin-gated (settings.features.momoTransfer).
    const payerPhone = opts.payerPhone ?? (payerMpi ? getMpi(payerMpi)?.aliases.find((a) => a.type === "phone")?.value : undefined);
    if (!payerPhone) throw new ConnectError("INVALID_IDENTITY", "Mobile Money funding needs the payer's number.", 422);
    if (!momoTransfer.enabled()) throw new ConnectError("PAYMENT_METHOD_UNAVAILABLE", "Mobile Money collection is not enabled on this deployment yet.", 503);
    const t = await momoTransfer.createTransfer({ owner: opts.ownerForEngine, fromPhone: payerPhone.startsWith("+") ? payerPhone : `+${payerPhone}`, toAddress: `+${dest.phone}`, xaf: i.amount.value, country: sp.country, toName: payee.displayName });
    if (!t.ok) throw new ConnectError(t.error === "compliance_blocked" ? "COMPLIANCE_REJECTED" : "PROVIDER_ERROR", t.message, t.status >= 500 ? 503 : t.status);
    i.execution = { kind: "momo_collection", method: "mobile_money", paymentId: t.transfer.id, instruction: { method: "mobile_money_collection", message: "Approve the payment request on your phone.", expires_at: t.transfer.expiresAt } };
    byPayment.set(t.transfer.id, i.id);
    move(i, "pending", "awaiting the payer's approval on their phone");
    return i;
  }
  const method: Method = d.method === "stablecoin" ? "USDT" : "LIGHTNING";
  const q = await buildQuote({ xaf: i.amount.value, method, country: sp.country, feePct });
  if (q.status !== 200) throw new ConnectError("TEMPORARY_UNAVAILABLE", (q.body as { message?: string }).message ?? "Could not price this payment.", 503);
  const quote = q.body as Quote;
  const r = await createPaymentCore(opts.req, { quoteId: quote.id, recipient: { phone: chk.local, country: sp.country, provider: chk.provider, name: "", nameSource: "unknown" } }, { owner: opts.ownerForEngine });
  if (r.status !== 201 && r.status !== 200) { const b = r.body as { error?: string; message?: string }; throw new ConnectError(b.error === "compliance_blocked" ? "COMPLIANCE_REJECTED" : b.error === "confirm_recipient" ? "INVALID_IDENTITY" : "PROVIDER_ERROR", b.message ?? "The payment could not be created.", r.status === 403 ? 403 : 503); }
  const p = r.body as Payment;
  i.execution = { kind: "external_payment", method: d.method, paymentId: p.id, instruction: publicPayment(p).payment_instructions };
  byPayment.set(p.id, i.id);
  putMeta({ paymentId: p.id, orgId: i.orgId, appId: "connect", credentialId: "connect", env: i.env, reference: i.purpose.reference ? `${i.purpose.reference}#${i.id.slice(-6)}` : undefined, metadata: { ...i.metadata, intent_id: i.id }, requestId: i.id, createdAt: p.createdAt, lastPublicState: "AWAITING_PAYMENT" });
  move(i, "pending", `awaiting ${d.method} funding`);
  touch("connect_intents");
  return i;
}

/** Engine transition → intent status (registered in hooks.ts). */
export function onEnginePayment(p: Payment): void {
  const i = intentOfPayment(p.id); if (!i) return;
  const s = p.state;
  if (s === "INBOUND_DETECTED") move(i, "authorized", "funds detected");
  else if (["INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED"].includes(s)) move(i, "processing", `engine ${s}`);
  else if (s === "DELIVERED") { move(i, "completed", "payout confirmed by the provider"); setSettlement(i, "settled", "delivered to the payee's Mobile Money"); updateMeta(p.id, { lastPublicState: "COMPLETED" }); }
  else if (s === "FAILED") { const expired = p.events.some((e) => e.state === "FAILED" && /expired|cancel/i.test(e.note ?? "")); move(i, expired ? "expired" : "failed", [...p.events].reverse().find((e) => e.note)?.note); setSettlement(i, "failed"); }
  else if (s === "REFUND_PENDING" || s === "REFUNDED") { move(i, "reversed", "funds are being returned to the payer"); setSettlement(i, "reversed"); }
  else if (s === "MANUAL_REVIEW") move(i, "processing", "held for review");
}
/** MoMo collections are not engine payments: their state is polled into the intent by the tick. */
export function syncCollections(): number {
  let n = 0;
  for (const i of intents.values()) {
    if (i.execution?.kind !== "momo_collection" || !i.execution.paymentId || TERMINAL.includes(i.status)) continue;
    const t = momoTransfer.getTransfer(i.execution.paymentId); if (!t) continue;
    const before = i.status;
    if (t.state === "COLLECTED" || t.state === "PAYING_OUT" || t.state === "HELD") move(i, "processing", `collection ${t.state}`);
    else if (t.state === "DELIVERED") { move(i, "completed", "paid out to the payee's Mobile Money"); setSettlement(i, "settled"); }
    else if (t.state === "EXPIRED" || t.state === "CANCELLED") move(i, "expired", `collection ${t.state}`);
    else if (t.state === "FAILED") { move(i, "failed", "collection failed"); setSettlement(i, "failed"); }
    else if (t.state === "REFUND_PENDING" || t.state === "REFUNDED") { move(i, "reversed", "collected then refunded"); setSettlement(i, "reversed"); }
    if (i.status !== before) n++;
  }
  return n;
}
export function expireIntents(now = Date.now()): number { let n = 0; for (const i of intents.values()) if (!TERMINAL.includes(i.status) && !i.execution?.paymentId && Date.parse(i.expiresAt) <= now) { move(i, "expired"); n++; } return n; }
export function cancelIntent(i: PaymentIntent, why: string): boolean { if (TERMINAL.includes(i.status) || i.execution?.paymentId) return false; move(i, "failed", `cancelled: ${why}`); return true; }

export const checkoutUrl = (i: PaymentIntent) => `${(process.env.CHECKOUT_BASE_URL ?? (config.publicUrl.includes("localhost") ? "http://localhost:5173" : "https://momome.xyz")).replace(/\/$/, "")}/p/${i.id}`;
export function publicIntent(i: PaymentIntent) {
  const payee = getMpi(i.payee.mpi);
  return {
    id: i.id, object: "payment_intent", status: i.status, settlement_status: i.settlementStatus, surface: i.surface,
    payee: { identity: i.payee.mpi, display_name: payee?.displayName ?? null },
    payer: { identity: i.payer.mpi ?? null, counterparty: i.payer.counterparty ?? null, anonymous: !!i.payer.anonymous, name: i.payer.name ?? null },
    amount: { value: String(i.amount.value), currency: i.amount.currency }, purpose: i.purpose, permitted_methods: i.permittedMethods,
    settlement: i.settlement, route: i.route ? { method: i.route.method, transport: i.route.transport } : null,
    execution: i.execution ? { kind: i.execution.kind, method: i.execution.method ?? null, payment_id: i.execution.paymentId ?? null, payment_instructions: i.execution.instruction ?? null } : null,
    checkout_url: checkoutUrl(i), invoice_id: i.invoiceId ?? null, metadata: i.metadata, expires_at: i.expiresAt, created_at: i.createdAt, updated_at: i.updatedAt, livemode: i.env === "live",
  };
}
export function _resetIntents(): void { intents.clear(); byPayment.clear(); }
