/* ============================================================
   In-flight monitor (§31, §48, PHASE 6) — the part of the saga that time drives.

   Webhooks are a hint; the poll is the authority. Every tick:
   · COLLECTION_PENDING  → ask the collection rail; expire after collectionTimeoutMin
                           (a collection that lands after expiry becomes a refund);
   · PAYOUT_INITIATED    → ask the payout rail (real rails confirm asynchronously);
   · REFUND_PENDING      → with autoRefund, pay the payer back on the source rail and
                           confirm it; without it, wait for the operator.
   Simulated rails are driven by the sandbox/test callbacks and still expire. Nothing here
   runs for a shadow transaction. A provider callback for a network reference calls
   hint(providerRef) to poll that one transaction at once.
   ============================================================ */
import type { NetworkTransaction } from "../../../../shared/network.js";
import { getSettings } from "../settings.js";
import { adapterById } from "./adapters.js";
import * as saga from "./saga.js";
import { lowLiquidity } from "./liquidity.js";
import { networkLowLiquidity } from "./notify.js";

const poll = (t: NetworkTransaction, key: string, status: string) => `poll:${key}:${status}`;

async function tickOne(t: NetworkTransaction, now: number): Promise<void> {
  if (t.shadow) return;
  const n = getSettings().network;
  const route = saga.getRoute(t.routeId);
  if (t.state === "COLLECTION_PENDING") {
    const col = route ? adapterById(route.collectionAdapter) : undefined;
    const key = t.refs.sourceCollectionId ?? `${t.id}:collect`;
    if (col && !col.simulated) {
      const st = await col.getCollectionStatus(key).catch(() => null);
      if (st === "COMPLETED" || st === "FAILED") { await saga.onCollectionEvent(t.id, poll(t, key, st), st); return; }
    }
    const started = Date.parse(t.events.find((e) => e.state === "COLLECTION_PENDING")?.at ?? t.createdAt);
    if (now - started > n.collectionTimeoutMin * 60_000) saga.expireCollection(t, n.collectionTimeoutMin);
    return;
  }
  if (t.state === "PAYOUT_INITIATED") {
    const pay = route ? adapterById(route.payoutAdapter) : undefined;
    const key = t.refs.destinationPayoutId;
    if (pay && key && !pay.simulated) {
      const st = await pay.getPayoutStatus(key).catch(() => null);
      if (st === "COMPLETED" || st === "FAILED") await saga.onPayoutEvent(t.id, poll(t, key, st), st);
    }
    return;
  }
  if (t.state === "REFUND_PENDING") {
    if (t.refs.refundPayoutId) {
      // Submitted: confirm on the rail that sent it.
      const rail = (await import("./adapters.js")).adaptersFor(t.source.market).find((a) => a.supports(t.source.provider, "payout"));
      const st = rail ? await rail.getPayoutStatus(t.refs.refundPayoutId).catch(() => null) : null;
      if (st === "COMPLETED") saga.markRefunded(t.id, t.refs.refundProviderRef ?? t.refs.refundPayoutId, "auto");
      else if (st === "FAILED") saga.onRefundFailed(t, "rail reported FAILED");
      return;
    }
    if (n.autoRefund && t.recovery !== "manual") await saga.submitRefund(t);
  }
}

/** Advance every in-flight transaction; raise the liquidity alarm. Returns how many were looked at. */
export async function networkTick(now = Date.now()): Promise<number> {
  let n = 0;
  try { const low = await lowLiquidity(); if (low.length) await networkLowLiquidity(low); } catch (e) { console.error("[network] liquidity alarm", e); }
  for (const t of saga.allTx(2000)) {
    if (t.shadow || !["COLLECTION_PENDING", "PAYOUT_INITIATED", "REFUND_PENDING"].includes(t.state)) continue;
    n++;
    try { await tickOne(t, now); } catch (e) { console.error(`[network] tick ${t.ref}`, e); }
  }
  return n;
}

/** A provider callback named this reference: poll the transaction it belongs to now. */
export async function hint(providerRef: string): Promise<boolean> {
  const t = saga.allTx(2000).find((x) => x.refs.sourceProviderRef === providerRef || x.refs.destinationProviderRef === providerRef || x.refs.refundProviderRef === providerRef);
  if (!t) return false;
  await tickOne(t, Date.now());
  return true;
}
