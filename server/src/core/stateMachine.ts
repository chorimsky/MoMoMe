/* ============================================================
   Payment lifecycle state machine (BACKEND_DESIGN §1)
   Drives a payment from confirmed inbound to delivered Mobile Money,
   writing balanced ledger entries and paying out exactly once.

   Two entry points, one money path:
   - sandbox `settle()` simulates rail latency with timers
   - live webhooks call markDetected() / confirmInbound() directly
   Both converge on confirmInbound(), which is idempotent.
   ============================================================ */
import type { Payment, PaymentState, DisplayStatus } from "../../../shared/types.js";
import { putPayment, listPayments, findPaymentByRef } from "./store.js";
import { recordTxn, reversePayment, hasDelivered, balance } from "./ledger.js";
import { PROVIDER_PAYOUT_MAX, XAF_FLOAT_BASE } from "../../../shared/domain.js";
import { isLive, ibexInboundTrusted, aggregatorLive } from "../config.js";
import { selectAggregator, selectFundedAggregator, aggregatorByName, recordExecution } from "./routing.js";
import { recordSuccessfulPayout, payoutBlocked } from "./merchant.js";
import type { PayoutStatus } from "../adapters/pawapay.js";
import { transactionStatus } from "../adapters/ibex.js";

/** Available XAF payout float = base treasury − everything already paid out. */
function availableFloatXaf(): number {
  return XAF_FLOAT_BASE + balance("external_recipient", "XAF"); // balance is negative (credits)
}

const SEQ: PaymentState[] = [
  "QUOTED", "AWAITING_INBOUND", "INBOUND_DETECTED", "INBOUND_CONFIRMED",
  "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED",
];
const rank = (s: PaymentState) => {
  const i = SEQ.indexOf(s);
  return i === -1 ? -1 : i;
};

const DISPLAY: Partial<Record<PaymentState, DisplayStatus>> = {
  DELIVERED: "Completed",
  PAYOUT_CONFIRMED: "Completed",
  FAILED: "Failed",
  REFUNDED: "Failed",
  MANUAL_REVIEW: "Pending",
};

function transition(p: Payment, state: PaymentState, note?: string) {
  p.state = state;
  p.displayStatus = DISPLAY[state] ?? "Pending";
  p.updatedAt = new Date().toISOString();
  p.events.push({ at: p.updatedAt, state, note });
  putPayment(p);
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Inbound seen in mempool / HTLC held. Idempotent, only moves forward. */
export function markDetected(p: Payment) {
  if (rank(p.state) >= rank("INBOUND_DETECTED")) return;
  transition(p, "INBOUND_DETECTED");
}

/**
 * The money path: inbound confirmed → FX lock → exactly-once payout → delivered.
 * Idempotent — safe to call from a re-delivered webhook. `actualAmount` (asset
 * units) lets us guard against underpayment before paying out.
 */
export async function confirmInbound(p: Payment, actualAmount?: number): Promise<void> {
  if (rank(p.state) >= rank("INBOUND_CONFIRMED")) return; // already settling/settled
  // Compare against the amount LOCKED at quote time (carried on the instruction),
  // never a freshly-recomputed rate — spot drifts, and the customer paid the locked
  // invoice amount. Recomputing here would falsely trip the guard on a good payment.
  const asset = p.payInstruction.asset;
  const expected = p.payInstruction.amount;

  // Lightning invoices settle in full or not at all — a confirmed LN webhook
  // means the locked amount arrived, so we credit the locked amount and never
  // depend on the webhook's amount/units. On-chain can be partial, so verify
  // the (correctly-scaled) received amount against the lock.
  let received: number;
  if (p.payInstruction.method === "LIGHTNING") {
    received = expected;
  } else {
    // A confirmed inbound with no verified amount is untrusted — hold for review.
    if (actualAmount == null) {
      transition(p, "MANUAL_REVIEW", "inbound amount unverified");
      return;
    }
    received = actualAmount;
    // Underpayment guard: never auto-pay a short inbound (BACKEND_DESIGN §1).
    if (received < expected * 0.999) {
      transition(p, "MANUAL_REVIEW", `underpaid: got ${received}, expected ${expected}`);
      return;
    }
  }

  transition(p, "INBOUND_CONFIRMED");
  recordTxn(p.id, [
    { account: "inbound_clearing", direction: "debit", amount: received, currency: asset },
    { account: "customer_wallet", direction: "credit", amount: received, currency: asset },
  ]);

  // FX lock: asset → XAF, reserve float, take fee.
  transition(p, "FX_LOCKED");
  recordTxn(p.id, [
    { account: "customer_wallet", direction: "debit", amount: received, currency: asset },
    { account: "fx_position", direction: "credit", amount: received, currency: asset },
  ]);
  recordTxn(p.id, [
    { account: "fx_position", direction: "debit", amount: p.totalXaf, currency: "XAF" },
    { account: "payout_float_XAF", direction: "credit", amount: p.xaf, currency: "XAF" },
    { account: "fee_revenue", direction: "credit", amount: p.feeXaf, currency: "XAF" },
  ]);

  // Pre-payout guards: corridor limit + available float.
  if (p.xaf > PROVIDER_PAYOUT_MAX[p.recipient.provider]) {
    transition(p, "MANUAL_REVIEW", `exceeds ${p.recipient.provider} payout limit`);
    return;
  }
  if (availableFloatXaf() < p.xaf) {
    transition(p, "MANUAL_REVIEW", "insufficient XAF float");
    return;
  }
  // Trust gate: a flagged / very-low-trust merchant needs manual confirmation.
  if (payoutBlocked(p.recipient.phone)) {
    transition(p, "MANUAL_REVIEW", "low-trust merchant — manual confirmation required");
    return;
  }

  // Route to a FUNDED aggregator (PawaPay / Peexit) — the API with wallet
  // balance picks up the payout. Invisible to the user.
  const agg = await selectFundedAggregator(p.recipient.provider, p.recipient.country, p.xaf);
  if (!agg) {
    transition(p, "MANUAL_REVIEW", "no payout aggregator with sufficient balance");
    return;
  }
  // SAFETY: never move REAL Mobile Money funds unless THIS payment's crypto
  // inbound is real. Real = a settled IBEX inbound (production, or sandbox when
  // IBEX_ALLOW_SANDBOX_PAYOUT is set — sandbox LN invoices take real mainnet
  // sats). A simulated inbound (provider "sandbox", e.g. USDT) never qualifies,
  // so a fake settlement can't trigger a real payout even with the opt-in on.
  const cryptoReal = p.payInstruction.provider === "ibex" && ibexInboundTrusted();
  if (aggregatorLive(agg.name) && !cryptoReal) {
    transition(p, "MANUAL_REVIEW", "live payout blocked — crypto inbound is not real");
    return;
  }
  p.aggregator = agg.name;

  // SUBMIT the payout — exactly once, keyed on the payment ref.
  transition(p, "PAYOUT_REQUESTED");
  let res;
  try {
    res = await agg.disburse({ idempotencyKey: p.ref, provider: p.recipient.provider, country: p.recipient.country, phone: p.recipient.phone, xaf: p.xaf, name: p.recipient.name });
  } catch (e) {
    transition(p, "MANUAL_REVIEW", `payout submit failed: ${e instanceof Error ? e.message : "error"}`);
    return;
  }
  if (res.status === "duplicate") {
    transition(p, "MANUAL_REVIEW", "duplicate payout key");
    return;
  }
  p.payoutRef = res.providerRef;
  putPayment(p);

  // CONFIRMATION is async. Real payout: settle on the FIRST of — the provider's
  // /webhooks/{aggregator} callback, this active status poll, or the slower
  // reconcile backstop. All idempotent. Simulated: fake the callback inline.
  if (!res.simulated) { void pollPayout(p.ref); return; }
  await wait(900);
  await onPayoutResult(p.ref, "COMPLETED", res.providerRef);
}

/** Actively poll a real payout's status for fast settlement when the dashboard
 *  callback isn't (yet) configured. Stops the moment the payment leaves
 *  PAYOUT_REQUESTED (e.g. a callback already settled it). Idempotent. */
async function pollPayout(ref: string): Promise<void> {
  for (const delay of [3000, 5000, 8000, 15000, 30000]) {
    await wait(delay);
    const p = findPaymentByRef(ref);
    if (!p || p.state !== "PAYOUT_REQUESTED") return; // already resolved
    try {
      const status = await aggregatorByName(p.aggregator ?? "pawapay").queryStatus(ref);
      if (status === "COMPLETED" || status === "FAILED") { await onPayoutResult(ref, status, p.payoutRef); return; }
    } catch (e) { console.error("poll payout", ref, e); }
  }
}

/**
 * Async payout result (from the PawaPay callback, the reconciliation backstop,
 * or the sandbox simulation). Completes delivery, or refunds on failure.
 * Idempotent: only acts on a payment still awaiting its payout result.
 */
export async function onPayoutResult(ref: string, status: PayoutStatus, providerRef?: string): Promise<void> {
  const p = findPaymentByRef(ref);
  if (!p || p.state !== "PAYOUT_REQUESTED") return; // already resolved / unknown

  // Feed the route-selection engine: success rate, latency, availability.
  if (status === "COMPLETED" || status === "FAILED") {
    const reqAt = [...p.events].reverse().find((e) => e.state === "PAYOUT_REQUESTED")?.at;
    recordExecution({
      at: new Date().toISOString(), aggregator: p.aggregator ?? "pawapay", ref: p.ref,
      provider: p.recipient.provider, status, latencyMs: reqAt ? Math.max(0, Date.now() - Date.parse(reqAt)) : 0,
    });
  }

  if (status === "COMPLETED") {
    transition(p, "PAYOUT_CONFIRMED", providerRef ?? p.payoutRef);
    recordTxn(p.id, [
      { account: "payout_float_XAF", direction: "debit", amount: p.xaf, currency: "XAF" },
      { account: "external_recipient", direction: "credit", amount: p.xaf, currency: "XAF" },
    ]);
    transition(p, "DELIVERED");
    // Learning loop: a successful payout teaches/strengthens the merchant identity.
    recordSuccessfulPayout({
      phone: p.recipient.phone, name: p.recipient.name, provider: p.recipient.provider,
      country: p.recipient.country, aggregatorRef: p.aggregator ? `${p.aggregator}:${p.payoutRef ?? ""}` : null,
    });
  } else if (status === "FAILED") {
    // The operator rejected the payout → return the funds to the sender.
    reversePayment(p.id);
    transition(p, "REFUND_PENDING", "payout failed at provider");
    transition(p, "REFUNDED", "auto-refunded after payout failure");
  }
  // PENDING → leave as-is; reconciliation will re-check.
}

/** Backstop for lost callbacks: re-query payouts stuck in PAYOUT_REQUESTED. */
export async function reconcileStuckPayouts(maxAgeMs = 60_000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const p of listPayments()) {
    if (p.state !== "PAYOUT_REQUESTED" || Date.parse(p.updatedAt) > cutoff) continue;
    const status = await aggregatorByName(p.aggregator ?? "pawapay").queryStatus(p.ref);
    if (status === "COMPLETED" || status === "FAILED") await onPayoutResult(p.ref, status);
  }
}

/** Backstop for a lost inbound webhook: poll IBEX for Lightning payments still
 *  awaiting inbound and settle any that IBEX reports paid. Idempotent — only
 *  ever advances a genuinely-settled payment. (On-chain settles by address via
 *  the account webhook; it isn't pollable by transaction id here.) */
export async function reconcileStuckInbounds(maxAgeMs = 90_000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const p of listPayments()) {
    if (p.payInstruction.provider !== "ibex" || p.payInstruction.method !== "LIGHTNING") continue;
    // AWAITING/DETECTED settle; FAILED is re-checked to RECOVER an invoice that
    // was really paid but wrongly expired (a lost webhook we couldn't reconcile).
    const recoverable = p.state === "AWAITING_INBOUND" || p.state === "INBOUND_DETECTED" || p.state === "FAILED";
    if (!recoverable || !p.payInstruction.providerRef) continue;
    if (Date.parse(p.updatedAt) > cutoff) continue;
    if (p.state === "FAILED" && Date.now() - Date.parse(p.createdAt) > 72 * 3600_000) continue; // don't re-check ancient failures
    try {
      const s = await transactionStatus(p.payInstruction.providerRef);
      if (s?.settled) { await confirmInbound(p, p.payInstruction.amount); continue; } // settle / recover (LN = full lock)
      // Genuinely unpaid + past expiry → expire so it doesn't sit on "Waiting…"
      // forever. Only when NOT paid (settled check above ran first). No funds moved.
      const expiredAt = Date.parse(p.payInstruction.expiresAt);
      if ((s?.failed || (expiredAt && expiredAt < Date.now() - 120_000)) && p.state === "AWAITING_INBOUND") {
        transition(p, "FAILED", "invoice expired — not paid");
      }
    } catch (e) { console.error("reconcile inbound", p.id, e); }
  }
}

/** Admin: re-attempt delivery of a stuck/failed payment. Exactly-once: reuses the
 *  ORIGINAL idempotency key (a prior payout returns "duplicate" — no second pay)
 *  and posts the delivery ledger legs once. */
export async function adminRetry(p: Payment): Promise<boolean> {
  if (p.displayStatus === "Completed") return false;
  // Retry reuses the original aggregator (idempotent on the ref); if none was
  // chosen yet, pick a funded one now.
  const agg = p.aggregator ? aggregatorByName(p.aggregator) : await selectFundedAggregator(p.recipient.provider, p.recipient.country, p.xaf);
  if (!agg) return false;
  const res = await agg.disburse({ idempotencyKey: p.ref, provider: p.recipient.provider, country: p.recipient.country, phone: p.recipient.phone, xaf: p.xaf, name: p.recipient.name });
  if (!hasDelivered(p.id)) {
    recordTxn(p.id, [
      { account: "payout_float_XAF", direction: "debit", amount: p.xaf, currency: "XAF" },
      { account: "external_recipient", direction: "credit", amount: p.xaf, currency: "XAF" },
    ]);
  }
  transition(p, "PAYOUT_CONFIRMED", res.providerRef);
  transition(p, "DELIVERED", res.status === "duplicate" ? "delivery reconciled by admin" : "retried by admin");
  return true;
}

/** Admin: refund a payment that did not deliver — reverses its ledger entries so
 *  the books stay balanced and the customer's inbound is returned. */
export function adminRefund(p: Payment): boolean {
  if (p.displayStatus === "Completed") return false;
  reversePayment(p.id);
  transition(p, "REFUND_PENDING", "refund initiated by admin");
  transition(p, "REFUNDED", "refunded by admin");
  return true;
}

/** Sandbox driver: simulate rail confirmation latency, then settle. */
export async function settle(p: Payment): Promise<void> {
  if (p.state !== "AWAITING_INBOUND") return;
  const confirmMs = p.method === "ONCHAIN" ? 2600 : 1400;
  markDetected(p);
  await wait(confirmMs);
  // Sandbox: the simulated inbound matches the locked invoice amount.
  await confirmInbound(p, p.payInstruction.amount);
}
