/* ============================================================
   Background jobs — extracted so BOTH runtimes drive them:
     • Railway: index.ts setInterval loops (long-lived process).
     • Vercel: /api/cron/* endpoints hit by Vercel Cron (no long-lived process).
   Each tick is idempotent + self-contained (safe to run from either, at any cadence).
   ============================================================ */
import { store } from "./db/store.js";
import { reconcileStuckPayouts, reconcileStuckInbounds, reconcileStuckRefunds, reconcileFailedPayouts } from "./core/stateMachine.js";
import { reconcilePendingCashins } from "./core/momoOps.js";
import { scanCompliance } from "./core/compliance.js";
import { ibexConfigured, blinkConfigured } from "./config.js";
import { rate as ibexRate } from "./adapters/ibex.js";
import { setRates, CCY } from "./core/rates.js";
import { fetchPublicRates } from "./core/publicRates.js";

/** Reconcile backstops (payouts / cashins / inbounds / refunds / failed-payouts) +
 *  the AML compliance scan + quote pruning. One idempotent tick. */
export async function reconcileTick(): Promise<void> {
  await reconcileStuckPayouts().catch((e) => console.error("reconcile payouts", e));
  await reconcilePendingCashins().catch((e) => console.error("reconcile cashins", e));
  // Inbound reconcile applies to any crypto rail with authoritative re-query (IBEX/Blink);
  // refund reconcile is IBEX-specific (refunds pay out via IBEX).
  if (ibexConfigured() || blinkConfigured()) await reconcileStuckInbounds().catch((e) => console.error("reconcile inbounds", e));
  if (ibexConfigured()) await reconcileStuckRefunds().catch((e) => console.error("reconcile refunds", e));
  await reconcileFailedPayouts().catch((e) => console.error("reconcile failed-payouts", e));
  try { await scanCompliance(); } catch (e) { console.error("compliance scan", e); }
  try { await store().pruneExpiredQuotes(); } catch (e) { console.error("prune quotes", e); }
}

let fxIbexDegraded = false; // log the IBEX→public fallback only on state change
/** Refresh the FX rate cache: IBEX preferred, public (Coinbase) fallback on throw/null. */
export async function fxTick(): Promise<void> {
  if (ibexConfigured()) {
    try {
      const [btc, usdt, usdc, eur] = await Promise.all([
        ibexRate(CCY.BTC, CCY.USD), ibexRate(CCY.USDT, CCY.USD), ibexRate(CCY.USDC, CCY.USD), ibexRate(CCY.EUR, CCY.USD),
      ]);
      if (btc != null) {
        if (fxIbexDegraded) { console.log("IBEX FX recovered — pricing from IBEX again"); fxIbexDegraded = false; }
        setRates({ btcUsd: btc, usdtUsd: usdt, usdcUsd: usdc, eurUsd: eur }, "IBEX");
        return;
      }
    } catch (e) {
      if (!fxIbexDegraded) { console.warn("IBEX FX pull failed — falling back to public rates:", e instanceof Error ? e.message : e); fxIbexDegraded = true; }
    }
  }
  const pub = await fetchPublicRates();
  if (pub) setRates(pub, "public");
}
