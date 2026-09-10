/* ============================================================
   Stablecoin (USDT/USDC) settlement — from the rail's own deposit list, not the webhook.

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
import { OVERPAY_TOLERANCE, confirmInbound, markDetected, recordUnattributedInbound } from "./stateMachine.js";
import { activeRails } from "../adapters/index.js";
import { store } from "../db/store.js";
import { listUnattributed } from "./unattributed.js";
import { erc20TransfersInTx } from "./erc20.js";

/** Deposits already handled in this process — a cheap pre-filter; the durable truth is
 *  Payment.inboundEventIds / the unattributed record's eventId, checked below. */
const done = new Set<string>();
let inflight: Promise<void> | null = null;

const openForDeposit = (p: Payment): boolean =>
  (p.state === "AWAITING_INBOUND" || p.state === "INBOUND_DETECTED") &&
  (p.payInstruction.method === "USDT" || p.payInstruction.method === "USDC");

/** One pass over every rail that can list stablecoin deposits. Concurrent callers share a
 *  pass (the webhook handler, the 30 s tick and "I've paid" all call this). */
export function reconcileStablecoinDeposits(): Promise<void> {
  if (!inflight) inflight = runPass().finally(() => { inflight = null; });
  return inflight;
}

async function runPass(): Promise<void> {
  for (const rail of activeRails()) {
    if (!rail.listStablecoinDeposits || !rail.configured()) continue;
    let deposits;
    try { deposits = await rail.listStablecoinDeposits(); }
    catch (e) { console.error(`[stablecoin] ${rail.name} deposit list failed`, e instanceof Error ? e.message : e); continue; }
    if (deposits.length === 0) continue;
    const payments = await store().listPayments();
    const seenIds = new Set<string>();
    for (const p of payments) for (const id of p.inboundEventIds ?? []) seenIds.add(id);
    for (const u of listUnattributed()) if (u.eventId) seenIds.add(u.eventId);
    for (const d of deposits) {
      if (done.has(d.id) || seenIds.has(d.id)) { done.add(d.id); continue; }
      const open = payments.filter(openForDeposit).filter((p) => p.payInstruction.method === d.asset && p.payInstruction.provider === rail.name);
      // 1. The chain says which address was paid. Exact, and immune to batched withdrawals.
      const transfers = d.txHash ? await erc20TransfersInTx(d.txHash) : [];
      if (transfers === null) { console.warn(`[stablecoin] ${d.asset} ${d.amount} tx ${d.txHash} — receipt not readable yet, retrying next tick`); continue; }
      const byAddress = open.find((p) => transfers.some((t) => t.asset === d.asset && t.to === p.payInstruction.code.toLowerCase()));
      if (byAddress) {
        const t = transfers.find((x) => x.asset === d.asset && x.to === byAddress.payInstruction.code.toLowerCase())!;
        console.log(`[stablecoin] ${byAddress.ref} ← ${t.amount} ${d.asset} (${rail.name} ${d.id}, tx ${d.txHash}) — settling`);
        await markDetected(byAddress);
        await confirmInbound(byAddress, t.amount, d.id, byAddress.payInstruction.providerRef);
        done.add(d.id);
        continue;
      }
      // 2. No receipt to read (rail gave no hash) → the amount alone, ONLY when it names exactly
      //    one open payment on this asset. Two candidates is an operator's call, not a guess.
      if (!d.txHash) {
        const fits = open.filter((p) => d.amount >= p.payInstruction.amount * 0.999 && d.amount <= p.payInstruction.amount * OVERPAY_TOLERANCE);
        if (fits.length === 1) {
          const p = fits[0];
          console.log(`[stablecoin] ${p.ref} ← ${d.amount} ${d.asset} (${rail.name} ${d.id}, no tx hash; sole amount match) — settling`);
          await markDetected(p);
          await confirmInbound(p, d.amount, d.id, p.payInstruction.providerRef);
          done.add(d.id);
          continue;
        }
      }
      // 3. Real money with no home: hold it where an operator sees it, in the right units.
      await recordUnattributedInbound({ rail: rail.name, providerRef: d.txHash ?? d.id, eventId: d.id, amount: d.amount, asset: d.asset });
      done.add(d.id);
    }
  }
}
