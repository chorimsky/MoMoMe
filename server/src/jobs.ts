/* ============================================================
   Background jobs — extracted so BOTH runtimes drive them:
     • Railway: index.ts setInterval loops (long-lived process).
     • Vercel: /api/cron/* endpoints hit by Vercel Cron (no long-lived process).
   Each tick is idempotent + self-contained (safe to run from either, at any cadence).
   ============================================================ */
import { store } from "./db/store.js";
import { reconcileStuckPayouts, reconcileStuckInbounds, reconcileStuckRefunds, reconcileFailedPayouts } from "./core/stateMachine.js";
import { reconcilePendingCashins } from "./core/momoOps.js";
import { reconcileDeposits } from "./core/depositReconcile.js";
import { reconciliationSweep } from "./core/interop/reconcile.js";
import { reconcileTransfers } from "./core/momoTransfer.js";
import { flush as flushOutbound } from "./core/interop/outbound.js";
import { shadowTick } from "./core/network/shadow.js";
import { refreshPublicFx, publicFxFresh } from "./core/network/fx.js";
import { networkTick } from "./core/network/monitor.js";
import { evaluateAlerts } from "./core/alerts.js";
import { backfillRailCosts } from "./core/railCosts.js";
import { usingPostgres } from "./db/store.js";
import { pgPool } from "./db/pg.js";
import { scanCompliance } from "./core/compliance.js";
import { ibexConfigured } from "./config.js";
import { rate as ibexRate, registerAccountWebhook } from "./adapters/ibex.js";
import { setRates, setDualBtc, CCY, ratesFresh, setRatesRefresher } from "./core/rates.js";
import { fetchEurUsd, fetchDualBtcUsd } from "./core/publicRates.js";

/** Reconcile backstops (payouts / cashins / inbounds / refunds / failed-payouts) +
 *  the AML compliance scan + quote pruning. One idempotent tick. */
/** IBEX's account webhook is registered at boot, but a registration can disappear (account
 *  operations on their side, a re-provisioned account). Re-assert it every 6 h — the call is
 *  idempotent (409 = already there) — so a lost registration costs at most 6 h of reconcile-
 *  only settlement rather than forever. */
let lastWebhookRegisterAt = Date.now(); // boot already registered it
async function keepWebhookRegistered(): Promise<void> {
  if (!ibexConfigured() || Date.now() - lastWebhookRegisterAt < 6 * 3600_000) return;
  lastWebhookRegisterAt = Date.now();
  await registerAccountWebhook().catch((e) => console.error("[ibex] webhook re-register failed", e instanceof Error ? e.message : e));
}

/** Which duties this process has (PROCESS_ROLE): `api` serves requests only, `worker` runs
 *  the timers only, `all` (default) does both — the single-container deployment. With two or
 *  more API replicas, run exactly ONE worker, or let `all` instances contend for the job
 *  lock below (Postgres advisory lock — SQLite deployments cannot run more than one). */
export type ProcessRole = "api" | "worker" | "all";
export const processRole = (): ProcessRole => { const r = (process.env.PROCESS_ROLE ?? "all").toLowerCase(); return r === "api" || r === "worker" ? r : "all"; };
export const runsJobs = () => processRole() !== "api";
export const servesHttp = () => processRole() !== "worker";

let lastTickAt: number | null = null, lastTickMs = 0, lastTickError: string | null = null;
/** For the deep health probe: when the money jobs last completed on THIS instance. */
export const jobsHealth = () => ({ role: processRole(), lastTickAt: lastTickAt ? new Date(lastTickAt).toISOString() : null, lastTickMs, lastTickError, stale: runsJobs() && (lastTickAt == null || Date.now() - lastTickAt > 3 * 60_000) });

/** Run `fn` only if this instance holds the cluster-wide job lock. On Postgres that is a
 *  session-level advisory lock held for the duration of the tick (a second instance sees
 *  it taken and skips — money jobs never double-run). Elsewhere there is one instance. */
async function withJobLock(fn: () => Promise<void>): Promise<boolean> {
  if (!usingPostgres()) { await fn(); return true; }
  const client = await pgPool().connect();
  try {
    const r = await client.query<{ ok: boolean }>("SELECT pg_try_advisory_lock(7331001) AS ok");
    if (!r.rows[0]?.ok) return false;
    try { await fn(); } finally { await client.query("SELECT pg_advisory_unlock(7331001)"); }
    return true;
  } finally { client.release(); }
}

let ticking = false;
export async function reconcileTick(): Promise<void> {
  if (!runsJobs()) return;
  // A slow tick (a rail timing out) must not be joined by the next timer firing on the
  // same instance — the cluster lock covers other instances, this covers this one.
  if (ticking) return;
  ticking = true;
  try { await reconcileTickLocked(); } finally { ticking = false; }
}
async function reconcileTickLocked(): Promise<void> {
  const t0 = Date.now();
  const ran = await withJobLock(reconcileOnce).catch((e) => { lastTickError = e instanceof Error ? e.message : String(e); throw e; });
  if (ran) { lastTickAt = Date.now(); lastTickMs = lastTickAt - t0; lastTickError = null; }
}

async function reconcileOnce(): Promise<void> {
  await reconcileStuckPayouts().catch((e) => console.error("reconcile payouts", e));
  await reconcilePendingCashins().catch((e) => console.error("reconcile cashins", e));
  // Inbound reconcile applies to any crypto rail with authoritative re-query (IBEX);
  // refund reconcile is IBEX-specific (refunds pay out via IBEX).
  if (ibexConfigured()) await reconcileStuckInbounds().catch((e) => console.error("reconcile inbounds", e));
  if (ibexConfigured()) await reconcileDeposits().catch((e) => console.error("reconcile deposits", e));
  await keepWebhookRegistered();
  await flushOutbound().catch((e) => console.error("outbound webhooks", e));
  await reconciliationSweep().catch((e) => console.error("reconciliation sweep", e));
  await reconcileTransfers().catch((e) => console.error("momo transfers", e));
  if (ibexConfigured()) await reconcileStuckRefunds().catch((e) => console.error("reconcile refunds", e));
  await reconcileFailedPayouts().catch((e) => console.error("reconcile failed-payouts", e));
  try { await scanCompliance(); } catch (e) { console.error("compliance scan", e); }
  // Shadow routing of production settlements (never moves funds; no-op unless SHADOW_ROUTING).
  try { await shadowTick(); } catch (e) { console.error("network shadow", e); }
  // Network transactions in flight: poll real rails, expire stale collections, refund.
  try { await networkTick(); } catch (e) { console.error("network tick", e); }
  // The network's public USD table (KES, GHS, NGN …): refresh when older than 30 min.
  try { if (!publicFxFresh(30 * 60_000)) await refreshPublicFx(); } catch (e) { console.error("network fx", e); }
  try { await store().pruneExpiredQuotes(); } catch (e) { console.error("prune quotes", e); }
  try { await store().pruneRateLimits(); } catch (e) { console.error("prune rate limits", e); }
  try { await backfillRailCosts(); } catch (e) { console.error("rail costs", e); }
  // Last: page the operator about anything the tick found (or could not fix).
  try { await evaluateAlerts(); } catch (e) { console.error("alerts", e); }
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
  // Public path (no IBEX, or IBEX degraded): price BTC from TWO independent venues with a
  // divergence guard (BACKEND_DESIGN §3), and take EUR (stables are pegged to 1) from
  // Coinbase in the SAME round-trip set — fetchEurUsd avoids re-fetching Coinbase's BTC
  // spot. setDualBtc caches the mean when the venues agree and REFUSES (marks the feed
  // divergent, so ratesFresh() → false) when they don't, rather than pricing off one number.
  const [dual, eurUsd] = await Promise.all([fetchDualBtcUsd(), fetchEurUsd()]);
  // A PEG IS NOT AN OBSERVATION. setRates() decides feed freshness from "did any leg come
  // back real?", and usdtUsd/usdcUsd here are hardcoded 1s — not something a venue told
  // us. Passing them unconditionally made that check true on EVERY tick, including ticks
  // where Coinbase AND Kraken were both unreachable: the cache timestamp was re-stamped,
  // ratesFresh() stayed true while the price was frozen, and live quotes then priced real
  // BTC off the hardcoded $65,000 FALLBACK — the precise failure setRates' own comment
  // says must not happen. Publish only when a venue actually answered; otherwise let the
  // cache age out so quoting refuses instead of inventing a price.
  if (eurUsd != null || dual.a != null || dual.b != null) {
    setRates({ usdtUsd: 1, usdcUsd: 1, eurUsd }, "public");
  }
  setDualBtc(dual.a, dual.b);
}

let fxEnsureInflight: Promise<void> | null = null;
/** Ensure the FX cache is fresh enough to price a LIVE quote. Serverless has no
 *  long-lived FX poller, so refresh ON-MISS here (deduped) — called from the quote
 *  path. A warm/fresh cache returns instantly; only a stale/empty cache triggers one
 *  pull even under a burst of concurrent quotes. */
export async function ensureFreshRates(): Promise<void> {
  if (ratesFresh()) return;
  if (!fxEnsureInflight) fxEnsureInflight = fxTick().finally(() => { fxEnsureInflight = null; });
  await fxEnsureInflight;
}

// Let any module that NEEDS a fresh rate pull one without importing jobs.ts (which imports
// stateMachine.ts — the reverse import would be a cycle). Registered at module load, so it
// is in place before the first request on either runtime.
setRatesRefresher(fxTick);
