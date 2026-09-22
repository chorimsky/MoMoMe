/* ============================================================
   API v1 — projections. The engine's Quote/Payment (shared/types) are the truth; these
   functions render them in the public v1 shape and vocabulary. The engine is never
   renamed for the API: the state map below is the only place both vocabularies meet.
   ============================================================ */
import type { Method, Payment, PaymentState, Quote } from "../../../../shared/types.js";
import { COUNTRIES } from "../../../../shared/domain.js";
import { metaOf } from "./paymentMeta.js";

export type PublicState = "CREATED" | "AWAITING_PAYMENT" | "PAYMENT_DETECTED" | "PAYMENT_CONFIRMED" | "CONVERSION_PROCESSING" | "PAYOUT_PROCESSING" | "PAYOUT_SUBMITTED" | "COMPLETED" | "EXPIRED" | "FAILED" | "CANCELLED" | "REFUNDED" | "MANUAL_REVIEW";

/** Source asset + network ⇄ the engine's funding method. */
export const METHOD_OF: Record<string, Method> = { "BTC/LIGHTNING": "LIGHTNING", "BTC/BITCOIN": "ONCHAIN", "USDT/ETHEREUM": "USDT", "USDC/ETHEREUM": "USDC" };
export const SOURCE_OF: Record<Method, { asset: string; network: string }> = { LIGHTNING: { asset: "BTC", network: "LIGHTNING" }, ONCHAIN: { asset: "BTC", network: "BITCOIN" }, USDT: { asset: "USDT", network: "ETHEREUM" }, USDC: { asset: "USDC", network: "ETHEREUM" } };

export function publicState(p: Payment, now = Date.now()): PublicState {
  const cancelled = p.events.some((e) => e.state === "FAILED" && /cancel/i.test(e.note ?? ""));
  switch (p.state as PaymentState) {
    case "QUOTED": return "CREATED";
    case "AWAITING_INBOUND": return p.payInstruction?.expiresAt && Date.parse(p.payInstruction.expiresAt) <= now && p.method === "LIGHTNING" ? "EXPIRED" : "AWAITING_PAYMENT";
    case "INBOUND_DETECTED": return "PAYMENT_DETECTED";
    case "INBOUND_CONFIRMED": return "PAYMENT_CONFIRMED";
    case "FX_LOCKED": return "CONVERSION_PROCESSING";
    case "PAYOUT_REQUESTED": return "PAYOUT_PROCESSING";
    case "PAYOUT_CONFIRMED": return "PAYOUT_SUBMITTED";
    case "DELIVERED": return "COMPLETED";
    case "REFUND_PENDING": case "REFUNDED": return "REFUNDED";
    case "FAILED": return cancelled ? "CANCELLED" : (p.events.some((e) => e.state === "FAILED" && /expired/i.test(e.note ?? "")) ? "EXPIRED" : "FAILED");
    case "MANUAL_REVIEW": return "MANUAL_REVIEW";
    default: return "FAILED";
  }
}
export const TERMINAL: PublicState[] = ["COMPLETED", "EXPIRED", "FAILED", "CANCELLED", "REFUNDED"];

const money = (amount: number, currency: string, decimals = 0) => ({ amount: decimals ? amount.toFixed(decimals) : String(Math.round(amount)), currency });
const cryptoDecimals = (m: Method) => (m === "LIGHTNING" || m === "ONCHAIN" ? 8 : 6);
const e164 = (country: string, local: string) => `${COUNTRIES[country as keyof typeof COUNTRIES]?.dial ?? ""}${local}`;

export function publicQuote(q: Quote, country: string, status: "active" | "expired" | "used" = "active") {
  const src = SOURCE_OF[q.method];
  const dec = cryptoDecimals(q.method);
  return {
    id: q.id, object: "quote", status: Date.parse(q.expiresAt) <= Date.now() && status === "active" ? "expired" : status,
    source: { asset: src.asset, network: src.network, amount: q.inboundAmount.toFixed(dec) },
    destination: { country, currency: "XAF", amount: String(q.xaf) },
    rate: { pair: `${src.asset}/XAF`, value: q.rate.toFixed(2), spread_bps: q.spreadBps, locked_until: q.expiresAt, estimate_only: q.estimateOnly },
    fees: {
      platform: money(q.feeXaf, "XAF"),
      network: { amount: "0", currency: src.asset, payer_pays: q.method !== "LIGHTNING", note: q.method === "LIGHTNING" ? "Routing fees are absorbed by MoMo›Me." : "The on-chain network fee is paid by the sender's wallet on top of the source amount." },
      payout: money(0, "XAF"), provider: money(0, "XAF"),
      total: money(q.feeXaf, "XAF"),
    },
    total_cost: { source: { asset: src.asset, network: src.network, amount: q.inboundAmount.toFixed(dec) }, destination_total: money(q.totalXaf, "XAF") },
    usd_equivalent: q.usd.toFixed(2),
    created_at: q.issuedAt, expires_at: q.expiresAt,
  };
}

function timeline(p: Payment) {
  const at = (s: PaymentState) => p.events.find((e) => e.state === s)?.at ?? null;
  const last = (s: PaymentState) => [...p.events].reverse().find((e) => e.state === s)?.at ?? null;
  return {
    created_at: p.createdAt, quote_created_at: p.events.find((e) => e.state === "QUOTED")?.at ?? p.createdAt,
    payment_detected_at: at("INBOUND_DETECTED"), payment_confirmed_at: at("INBOUND_CONFIRMED"), conversion_started_at: at("FX_LOCKED"),
    payout_started_at: at("PAYOUT_REQUESTED"), payout_submitted_at: last("PAYOUT_CONFIRMED"), payout_completed_at: at("DELIVERED"),
    completed_at: at("DELIVERED"), failed_at: at("FAILED"), refunded_at: at("REFUNDED"), review_at: at("MANUAL_REVIEW"),
  };
}

export function publicPayment(p: Payment) {
  const m = metaOf(p.id);
  const src = SOURCE_OF[p.method];
  const dec = cryptoDecimals(p.method);
  const state = publicState(p);
  const pi = p.payInstruction;
  const lastNote = [...p.events].reverse().find((e) => e.note)?.note;
  return {
    id: p.id, object: "payment", reference: m?.reference ?? null, status: state,
    quote_id: p.quoteId,
    source: { asset: src.asset, network: src.network, amount: pi ? pi.amount.toFixed(dec) : null },
    destination: { country: p.recipient.country, currency: "XAF", amount: String(p.xaf), ...(p.repricedFromXaf ? { quoted_amount: String(p.repricedFromXaf) } : {}) },
    recipient: { phone: e164(p.recipient.country, p.recipient.phone), operator: p.recipient.provider, name: p.recipient.name || null, name_verified: p.recipient.nameSource === "provider" || !!p.recipientIdentity },
    fees: { platform: money(p.feeXaf, "XAF"), total: money(p.feeXaf, "XAF") },
    payment_instructions: pi && !TERMINAL.includes(state) ? {
      method: p.method === "LIGHTNING" ? "lightning_invoice" : p.method === "ONCHAIN" ? "bitcoin_address" : "erc20_address",
      asset: pi.asset, network: src.network, amount: pi.amount.toFixed(dec), amount_label: pi.amountLabel,
      code: pi.code, uri: pi.qr, expires_at: pi.expiresAt,
      ...(pi.alt ? { alternative: { method: "lightning_invoice", asset: pi.alt.asset, amount: pi.alt.amount.toFixed(8), code: pi.alt.code, expires_at: pi.alt.expiresAt } } : {}),
    } : null,
    refund: p.state === "REFUND_PENDING" || p.state === "REFUNDED" ? { status: p.state === "REFUNDED" ? "settled" : (p.refundNeedsDestination ? "awaiting_destination" : "pending"), asset: "BTC", network: "LIGHTNING", ...(p.refundSats ? { amount_sats: p.refundSats } : {}), ...(p.refundTxId ? { transaction_id: p.refundTxId } : {}) } : null,
    failure: state === "FAILED" || state === "EXPIRED" ? { reason: lastNote ?? null } : null,
    metadata: m?.metadata ?? {},
    expires_at: pi?.expiresAt ?? null,
    timeline: timeline(p),
    created_at: p.createdAt, updated_at: p.updatedAt,
    livemode: m?.env === "live",
  };
}

/** The events a transition emits to webhooks, in the blueprint's vocabulary. */
export function eventTypeFor(state: PublicState): string {
  switch (state) {
    case "CREATED": return "payment.created";
    case "AWAITING_PAYMENT": return "payment.awaiting_payment";
    case "PAYMENT_DETECTED": return "payment.detected";
    case "PAYMENT_CONFIRMED": return "payment.confirmed";
    case "CONVERSION_PROCESSING": case "PAYOUT_PROCESSING": return "payment.processing";
    case "PAYOUT_SUBMITTED": return "payment.payout_submitted";
    case "COMPLETED": return "payment.completed";
    case "FAILED": return "payment.failed";
    case "EXPIRED": return "payment.expired";
    case "CANCELLED": return "payment.cancelled";
    case "REFUNDED": return "payment.refunded";
    case "MANUAL_REVIEW": return "payment.manual_review";
  }
}
export const EVENT_TYPES = ["payment.created", "payment.awaiting_payment", "payment.detected", "payment.confirmed", "payment.processing", "payment.payout_submitted", "payment.completed", "payment.failed", "payment.expired", "payment.cancelled", "payment.refunded", "payment.manual_review", "settlement.created", "settlement.completed", "settlement.failed",
  // MoMo›Me Connect (docs/connect §26): intents, invoices, payouts, identities, settlement statuses.
  "payment.authorized", "payment.pending", "payment.reversed", "settlement.pending", "settlement.processing", "settlement.reversed", "invoice.created", "invoice.paid", "invoice.expired", "payout.created", "payout.processing", "payout.completed", "payout.failed", "payout.reversed", "identity.created", "identity.updated"] as const;
