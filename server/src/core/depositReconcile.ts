/* ============================================================
   DEPOSIT settlement (USDT/USDC and on-chain BTC) — from the rail's own deposit list,
   not the webhook.

   Why this exists (2026-09-10, MMM-2026-418893): a customer paid 1.81 USDC from Coinbase.
   The chain confirmed it in minutes and IBEX credited our USDC account three minutes after
   the block. Nothing settled. Two reasons, both structural:

     1. IBEX reports an ERC-20 deposit with the ACCOUNT and the TX HASH — never the receive
        address. Our payments are keyed by address, so even a delivered webhook could not
        match ("unmatched", captured as unattributed dust — the amount was also read as
        base units, 1.81 → 0.00000181).
     2. Lightning had a reconcile backstop (re-query the invoice); stablecoins had none.
        A missed webhook was a payment that waited forever.

   Now: every tick lists completed stablecoin deposits, reads each deposit's Ethereum
   receipt, and settles the open payment whose receive address the transfer paid — the
   exact amount from the chain, deduped by the rail's transaction id. A deposit that pays
   no open payment (address reused, payment pruned) is captured as unattributed with the
   right units, and the RPC being down simply means "next tick".
   ============================================================ */
import type { Payment } from "../../../shared/types.js";
import { OVERPAY_TOLERANCE, confirmInbound, markDetected, parkForReview, recordUnattributedInbound } from "./stateMachine.js";
import { activeRails } from "../adapters/index.js";
import { store } from "../db/store.js";
import { listUnattributed } from "./unattributed.js";
import { erc20TransfersInTx } from "./erc20.js";
import { btcOutputsInTx } from "./bitcoinTx.js";
import type { DepositAsset, RailDeposit } from "../adapters/types.js";

/** @deprecated name kept for older call sites */
export const reconcileStablecoinDeposits = (): Promise<void> => reconcileDeposits();

/** Deposits already handled in this process — a cheap pre-filter; the durable truth is
 *  Payment.inboundEventIds / the unattributed record's eventId, checked below. */
const done = new Set<string>();
let inflight: Promise<void> | null = null;

const isDepositMethod = (p: Payment): boolean => p.payInstruction.method === "USDT" || p.payInstruction.method === "USDC" || p.payInstruction.method === "ONCHAIN";
const methodOf = (a: DepositAsset): Payment["payInstruction"]["method"] => (a === "BTC" ? "ONCHAIN" : a);
const openForDeposit = (p: Payment): boolean =>
  (p.state === "AWAITING_INBOUND" || p.state === "INBOUND_DETECTED") && isDepositMethod(p);

/** Who did this deposit's chain transaction pay? ERC-20 transfers for stablecoins,
 *  outputs for BTC — one shape: (to, asset, amount). null = chain not readable yet. */
async function chainTransfers(d: RailDeposit): Promise<Array<{ to: string; asset: DepositAsset; amount: number }> | null> {
  if (!d.txHash) return [];
  if (d.asset === "BTC") {
    const outs = await btcOutputsInTx(d.txHash);
    return outs ? outs.map((o) => ({ to: o.to, asset: "BTC" as const, amount: o.amount })) : null;
  }
  return erc20TransfersInTx(d.txHash);
}

/** One pass over every rail that can list stablecoin deposits. Concurrent callers share a
 *  pass (the webhook handler, the 30 s tick and "I've paid" all call this). */
export function reconcileDeposits(): Promise<void> {
  if (!inflight) inflight = runPass().finally(() => { inflight = null; });
  return inflight;
}

async function runPass(): Promise<void> {
  for (const rail of activeRails()) {
    if (!rail.listDeposits || !rail.configured()) continue;
    let deposits;
    try { deposits = await rail.listDeposits(); }
    catch (e) { console.error(`[deposit] ${rail.name} deposit list failed`, e instanceof Error ? e.message : e); continue; }
    if (deposits.length === 0) continue;
    const payments = await store().listPayments();
    const seenIds = new Set<string>();
    for (const p of payments) for (const id of p.inboundEventIds ?? []) seenIds.add(id);
    for (const u of listUnattributed()) if (u.eventId) seenIds.add(u.eventId);
    for (const d of deposits) {
      if (done.has(d.id) || seenIds.has(d.id)) { done.add(d.id); continue; }
      const mine = payments.filter(isDepositMethod).filter((p) => p.payInstruction.provider === rail.name);
      const open = mine.filter(openForDeposit).filter((p) => p.payInstruction.method === methodOf(d.asset));
      // 1. The chain says which address was paid. Exact, and immune to batched withdrawals.
      const transfers = await chainTransfers(d);
      if (transfers === null) { console.warn(`[deposit] ${d.asset} ${d.amount} tx ${d.txHash} — chain not readable yet, retrying next tick`); continue; }
      // ANY of our stablecoin payments, not only the open ones: a second deposit to an
      // address that already settled belongs to that payment (confirmInbound books it as a
      // refund owed and says so on the payment), and a USDC transfer to a USDT address is
      // that payment's money too — held, not lost.
      const hit = mine.map((p) => ({ p, t: transfers.find((x) => x.to === p.payInstruction.code.toLowerCase()) })).find((h) => h.t);
      if (hit) {
        const { p, t } = hit as { p: Payment; t: NonNullable<typeof hit.t> };
        if (methodOf(t.asset) !== p.payInstruction.method) {
          // Same address, other token. IBEX keeps one account per currency, so the credit
          // may not even have landed where we can spend it. An operator settles this one.
          if (openForDeposit(p)) {
            console.warn(`[deposit] ${p.ref} ← ${t.amount} ${t.asset} sent to its ${p.payInstruction.method} address (tx ${d.txHash}) — holding for review`);
            p.inboundEventIds = [...(p.inboundEventIds ?? []), d.id];
            await store().putPayment(p);
            await parkForReview(p, `${t.amount} ${t.asset} was sent to this payment's ${p.payInstruction.method} address (tx ${d.txHash}) — wrong token; confirm the credit with the rail, then settle or refund`);
            done.add(d.id);
            continue;
          }
        } else {
          console.log(`[deposit] ${p.ref} ← ${t.amount} ${d.asset} (${rail.name} ${d.id}, tx ${d.txHash}) — ${openForDeposit(p) ? "settling" : "already settled: booking as a duplicate"}`);
          if (openForDeposit(p)) await markDetected(p);
          await confirmInbound(p, t.amount, d.id, p.payInstruction.providerRef);
          done.add(d.id);
          continue;
        }
      }
      // 2. No receipt to read (rail gave no hash) → the amount alone, ONLY when it names exactly
      //    one open payment on this asset. Two candidates is an operator's call, not a guess.
      if (!d.txHash) {
        const fits = open.filter((p) => d.amount >= p.payInstruction.amount * 0.999 && d.amount <= p.payInstruction.amount * OVERPAY_TOLERANCE);
        if (fits.length === 1) {
          const p = fits[0];
          console.log(`[deposit] ${p.ref} ← ${d.amount} ${d.asset} (${rail.name} ${d.id}, no tx hash; sole amount match) — settling`);
          await markDetected(p);
          await confirmInbound(p, d.amount, d.id, p.payInstruction.providerRef);
          done.add(d.id);
          continue;
        }
      }
      // 3. Real money with no home: hold it where an operator sees it, in the right units.
      await recordUnattributedInbound({ rail: rail.name, providerRef: d.txHash ?? d.id, eventId: d.id, amount: d.amount, ...(d.asset === "BTC" ? {} : { asset: d.asset }) });
      done.add(d.id);
    }
  }
}
