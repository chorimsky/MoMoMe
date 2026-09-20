/* Internal ledger references, metrics and reconciliation for the UPI layer.
   Money is booked by the engines that move it (core/ledger for V1, network_ledger for
   the network saga); this layer does not book a second time. What it adds is the thread
   through them: every intent carries correlation_id, payment_intent_id, quote_id, route_id,
   settlement_id, provider_reference, blockchain_txid, mobile_money_reference — and a
   reconciliation that compares what the intent expected with what the V1 record says. */
import type { PaymentIntentV2, LedgerRefs } from "../../../../shared/upi.js";
import { store } from "../../db/store.js";
import { getTx, getQuote } from "../network/saga.js";
import { ledgerBalanced } from "../network/saga.js";

export const metrics = {
  payment_total: 0, payment_success: 0, payment_failed: 0, settlement_success: 0, settlement_failed: 0,
  route_selection_total: 0, route_failure_total: 0, liquidity_reservation_total: 0, liquidity_failure_total: 0,
  stablecoin_transaction_total: 0, lightning_payment_total: 0, mobile_money_payment_total: 0, identity_resolution_total: 0,
};
export const metricsSnapshot = () => ({ ...metrics });

export async function refsOf(intent: PaymentIntentV2): Promise<LedgerRefs> {
  const refs: LedgerRefs = { ...intent.refs };
  if (refs.v1PaymentId) {
    const p = await store().getPayment(refs.v1PaymentId);
    if (p) { refs.providerReference = p.payInstruction?.providerRef ?? refs.providerReference; refs.mobileMoneyReference = p.payoutRef ?? refs.mobileMoneyReference; refs.settlementId = p.payoutRef ?? refs.settlementId; const evt = p.events.find((e) => /txid|tx hash|0x[0-9a-f]{64}/i.test(e.note ?? "")); const m = evt?.note?.match(/0x[0-9a-fA-F]{64}/); if (m) refs.blockchainTxid = m[0]; }
  }
  return refs;
}
/** expected vs actual, per intent. A mismatch becomes RECONCILIATION_REQUIRED, never silence. */
export async function reconcileIntent(intent: PaymentIntentV2): Promise<{ ok: boolean; expected: number; actual: number | null; variance: number | null; notes: string[] }> {
  const notes: string[] = [];
  if (intent.refs.v1PaymentId) {
    const p = await store().getPayment(intent.refs.v1PaymentId);
    if (!p) return { ok: false, expected: intent.amount.value, actual: null, variance: null, notes: ["V1 payment record missing"] };
    const actual = p.xaf;
    const variance = actual - intent.amount.value;
    if (Math.abs(variance) > 0 && !p.repricedFromXaf) notes.push(`delivered ${actual} vs intended ${intent.amount.value}`);
    if (p.state === "MANUAL_REVIEW") notes.push("V1 payment held for review");
    return { ok: notes.length === 0, expected: intent.amount.value, actual, variance, notes };
  }
  if (intent.refs.networkTxId) {
    const t = getTx(intent.refs.networkTxId);
    if (!t) return { ok: false, expected: intent.amount.value, actual: null, variance: null, notes: ["network transaction missing"] };
    if (!ledgerBalanced(t.id) && ["COMPLETED", "REFUNDED"].includes(t.state)) notes.push("network ledger does not balance");
    return { ok: notes.length === 0, expected: intent.amount.value, actual: getQuote(t.quoteId)?.destinationAmount ?? null, variance: null, notes };
  }
  return { ok: true, expected: intent.amount.value, actual: null, variance: null, notes: ["nothing executed"] };
}
