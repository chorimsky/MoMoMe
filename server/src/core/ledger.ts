/* ============================================================
   Double-entry, append-only ledger (BACKEND_DESIGN §2)
   Money is the sum of immutable journal entries, never a column.
   ============================================================ */
import type { LedgerEntry, LedgerAccount } from "../../../shared/types.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";

type Currency = LedgerEntry["currency"];

interface Leg {
  account: LedgerAccount;
  direction: "debit" | "credit";
  amount: number;
  currency: Currency;
}

const entries: LedgerEntry[] = [];

register(
  "ledger",
  () => entries,
  (d: LedgerEntry[]) => { entries.length = 0; entries.push(...d); },
);

/**
 * Append a balanced journal transaction. Throws if debits != credits
 * within any currency — the core invariant that keeps the books honest.
 */
export function recordTxn(paymentId: string, legs: Leg[]): void {
  const byCcy = new Map<Currency, number>();
  for (const leg of legs) {
    const sign = leg.direction === "debit" ? 1 : -1;
    byCcy.set(leg.currency, (byCcy.get(leg.currency) ?? 0) + sign * leg.amount);
  }
  for (const [ccy, net] of byCcy) {
    if (Math.abs(net) > 1e-9) {
      throw new Error(`Unbalanced ledger txn for ${paymentId}: ${ccy} nets ${net}`);
    }
  }
  const txnId = id("txn");
  const at = new Date().toISOString();
  for (const leg of legs) {
    entries.push({ id: id("le"), txnId, paymentId, at, ...leg });
  }
  touch("ledger");
}

export function entriesFor(paymentId: string): LedgerEntry[] {
  return entries.filter((e) => e.paymentId === paymentId);
}

/** Live balance of an account, derived (not stored). */
export function balance(account: LedgerAccount, currency: Currency): number {
  return entries
    .filter((e) => e.account === account && e.currency === currency)
    .reduce((sum, e) => sum + (e.direction === "debit" ? e.amount : -e.amount), 0);
}

export function allEntries(): LedgerEntry[] {
  return entries;
}

/** Has this payment's payout already hit the recipient (delivery posted)? */
export function hasDelivered(paymentId: string): boolean {
  return entries.some((e) => e.paymentId === paymentId && e.account === "external_recipient");
}

/**
 * Post the inverse of every entry for a payment — nets its ledger contribution
 * to zero (returns the customer's inbound, unwinds FX/float/fee). Used by refund.
 * The inverse of a set of balanced transactions is itself balanced.
 */
export function reversePayment(paymentId: string): void {
  const legs: Leg[] = entriesFor(paymentId).map((e) => ({
    account: e.account,
    direction: e.direction === "debit" ? "credit" : "debit",
    amount: e.amount,
    currency: e.currency,
  }));
  if (legs.length) recordTxn(paymentId, legs);
}
