/* ============================================================
   MoMo›Me Connect — the internal rail on the existing journal (§12, §21).

   An MPI's balance is the ledger account `mpi_balance:<id>` (a liability of ours). It is
   NEVER a column: `balanceOf` sums the journal. The only ways it moves:
     • internal transfer   payer balance → payee balance (+ fee → fee_revenue)
     • credit from a completed payment whose payee settles to its MoMo›Me balance
       (connect_clearing → mpi_balance)
     • debit for a payout / a settlement to an external rail (mpi_balance → payout_float_XAF)
   Every function appends one balanced transaction through core/ledger.recordTxn.
   ============================================================ */
import { recordTxn, balance } from "../ledger.js";

const acct = (mpi: string) => `mpi_balance:${mpi}` as const;
export function balanceOf(mpi: string): number { return Math.round(-balance(acct(mpi), "XAF")); }

/** Payer → payee, instantly final. Returns false if the payer cannot cover amount + fee. */
export function internalTransfer(ref: string, payer: string, payee: string, xaf: number, feeXaf: number): boolean {
  if (xaf <= 0 || balanceOf(payer) < xaf) return false;
  recordTxn(ref, [
    { account: acct(payer), direction: "debit", amount: xaf, currency: "XAF" },
    { account: acct(payee), direction: "credit", amount: xaf - feeXaf, currency: "XAF" },
    ...(feeXaf > 0 ? [{ account: "fee_revenue" as const, direction: "credit" as const, amount: feeXaf, currency: "XAF" as const }] : []),
  ]);
  return true;
}
/** A completed external payment whose payee keeps the value on its MoMo›Me balance. The XAF
 *  came into the float from the conversion (the engine already booked that); here it is
 *  moved from the float into the payee's balance via the explicit clearing account. */
export function creditFromPayment(ref: string, payee: string, xaf: number): void {
  recordTxn(ref, [{ account: "payout_float_XAF", direction: "debit", amount: xaf, currency: "XAF" }, { account: "connect_clearing", direction: "credit", amount: xaf, currency: "XAF" }]);
  recordTxn(ref, [{ account: "connect_clearing", direction: "debit", amount: xaf, currency: "XAF" }, { account: acct(payee), direction: "credit", amount: xaf, currency: "XAF" }]);
}
/** A payout leaves the payer's balance and the float pays the external rail. */
export function debitForPayout(ref: string, payer: string, xaf: number, feeXaf: number): boolean {
  if (balanceOf(payer) < xaf + feeXaf) return false;
  recordTxn(ref, [
    { account: acct(payer), direction: "debit", amount: xaf + feeXaf, currency: "XAF" },
    { account: "payout_float_XAF", direction: "credit", amount: xaf, currency: "XAF" },
    ...(feeXaf > 0 ? [{ account: "fee_revenue" as const, direction: "credit" as const, amount: feeXaf, currency: "XAF" as const }] : []),
  ]);
  return true;
}
/** Compensating entry when a payout fails after the debit: the value returns to the balance. */
export function refundPayout(ref: string, payer: string, xaf: number, feeXaf: number): void {
  recordTxn(ref, [
    { account: "payout_float_XAF", direction: "debit", amount: xaf, currency: "XAF" },
    ...(feeXaf > 0 ? [{ account: "fee_revenue" as const, direction: "debit" as const, amount: feeXaf, currency: "XAF" as const }] : []),
    { account: acct(payer), direction: "credit", amount: xaf + feeXaf, currency: "XAF" },
  ]);
}
/** Sandbox / operator top-up of a balance (money that arrived by another product). */
export function creditBalance(ref: string, mpi: string, xaf: number, from: "momo_collect_clearing" | "payout_float_XAF" = "momo_collect_clearing"): void {
  recordTxn(ref, [{ account: from, direction: "debit", amount: xaf, currency: "XAF" }, { account: acct(mpi), direction: "credit", amount: xaf, currency: "XAF" }]);
}
