import { createApp } from "./app.js";
import { config, assertLiveConfig, assertIbexConfig, assertBlinkConfig, assertAdminSecurity, ibexConfigured, blinkConfigured, liveMoney, peexitLive } from "./config.js";
import { flushAll, persistDurable } from "./core/persist.js";
import { pruneExpiredQuotes } from "./core/store.js";
import { reconcileStuckPayouts, reconcileStuckInbounds, reconcileStuckRefunds, reconcileFailedPayouts } from "./core/stateMachine.js";
import { reconcilePendingCashins } from "./core/momoOps.js";
import { scanCompliance } from "./core/compliance.js";
import { registerAccountWebhook, rate as ibexRate } from "./adapters/ibex.js";
import { registerBlinkCallback, blinkBalances } from "./adapters/blink.js";
import { setRates, CCY } from "./core/rates.js";
import { fetchPublicRates } from "./core/publicRates.js";

assertLiveConfig();
assertIbexConfig();
assertBlinkConfig();
assertAdminSecurity(); // fail closed on a default admin password in production
// Fail closed: never run a real-money rail on a non-durable store (node:sqlite missing
// or DB_PATH not writable) — payments, ledger and the 10-year compliance chain would be
// silently lost on every restart. Sandbox may run in-memory.
if (liveMoney() && !persistDurable()) {
  throw new Error("Real-money rail is live but the database is NOT durable (node:sqlite unavailable or DB_PATH not writable) — refusing to start. Fix DB_PATH / the mounted volume, or run fully in sandbox.");
}
// Warn about the default admin password only on a real/reachable deployment
// (https public URL or a live-money rail) — it's a production reminder, not
// noise for local dev where the default password is fine.
if (config.admin.passwordIsDefault && (config.publicUrl.startsWith("https://") || liveMoney())) {
  console.warn("⚠️  ADMIN_PASSWORD is not set — the admin console is using the default password. Set ADMIN_PASSWORD in the environment.");
}
// Peexit's notification callback authenticates with HTTP Basic Auth using
// credentials we hand to Peexit. Without PEEXIT_CALLBACK_PASS set, a live rail
// rejects every callback (fail-closed) — the reconcile backstop still settles via
// the authoritative /disbursement/all_requests re-query, but callbacks won't.
if (peexitLive() && !config.peexit.callbackPass) {
  console.warn("⚠️  PEEXIT is live but PEEXIT_CALLBACK_PASS is not set — payout callbacks will be REJECTED (settlement falls back to slower reconcile polling). Set PEEXIT_CALLBACK_USER/PEEXIT_CALLBACK_PASS and give them to Peexit with your callback URL.");
}
const app = createApp();

// Backstop: re-query payouts AND inbounds stuck awaiting a (possibly lost) callback.
setInterval(() => {
  void reconcileStuckPayouts().catch((e) => console.error("reconcile payouts", e));
  void reconcilePendingCashins().catch((e) => console.error("reconcile cashins", e));
  // Inbound reconcile applies to any crypto rail with authoritative re-query
  // (IBEX or Blink). Refund reconcile is IBEX-specific (refunds pay out via IBEX).
  if (ibexConfigured() || blinkConfigured()) {
    void reconcileStuckInbounds().catch((e) => console.error("reconcile inbounds", e));
  }
  if (ibexConfigured()) {
    void reconcileStuckRefunds().catch((e) => console.error("reconcile refunds", e));
  }
  void reconcileFailedPayouts().catch((e) => console.error("reconcile failed-payouts", e));
  // AML/CFT detection — open compliance cases for reportable activity (CTR/CDD,
  // structuring, sanctions, high-risk). Read-only over payments; never blocks money.
  try { scanCompliance(); } catch (e) { console.error("compliance scan", e); }
}, 30_000).unref();

// Evict expired quotes so the in-memory quotes map can't grow without bound.
setInterval(() => { try { pruneExpiredQuotes(); } catch (e) { console.error("prune quotes", e); } }, 5 * 60_000).unref();

// FX feed: keep the rate cache fresh so live quotes can price. IBEX is the preferred
// source (same source that settles an IBEX inbound); when IBEX isn't configured (e.g.
// a Blink-only rail) OR an IBEX pull is degraded, fall back to a vendor-neutral public
// source so the feed still stands on its own — otherwise liveMoney() quotes would refuse
// forever (`rates_unavailable`). Refreshed every 30s; quoting reads the cache
// synchronously and locks the rate at quote time. Runs whenever any crypto rail is
// configured or real money can move; pure sandbox/demo stays on the built-in fallback.
if (ibexConfigured() || blinkConfigured() || liveMoney()) {
  const refreshFxRates = async () => {
    if (ibexConfigured()) {
      const [btc, usdt, usdc, eur] = await Promise.all([
        ibexRate(CCY.BTC, CCY.USD), ibexRate(CCY.USDT, CCY.USD), ibexRate(CCY.USDC, CCY.USD), ibexRate(CCY.EUR, CCY.USD),
      ]);
      if (btc != null) { setRates({ btcUsd: btc, usdtUsd: usdt, usdcUsd: usdc, eurUsd: eur }, "IBEX"); return; }
    }
    // No IBEX (or IBEX returned no BTC price) → public source, so a non-IBEX rail prices.
    const pub = await fetchPublicRates();
    if (pub) setRates(pub, "public");
  };
  void refreshFxRates().catch((e) => console.error("fx rates", e));
  setInterval(() => void refreshFxRates().catch((e) => console.error("fx rates", e)), 30_000).unref();
}

// Register the IBEX account-level webhook so on-chain deposits (and all account
// transactions) notify us. Needs a publicly-reachable https URL — skipped in
// local dev where IBEX can't call back.
if (ibexConfigured() && config.publicUrl.startsWith("https://")) {
  void registerAccountWebhook()
    .then(() => console.log(`IBEX account webhook → ${config.publicUrl}/webhooks/ibex`))
    .catch((e) => console.error("IBEX register account webhook failed", e));
}

// Blink (Galoy) callback endpoint — so Lightning/on-chain receives notify us.
// Same gate as IBEX: only when configured and PUBLIC_URL is publicly reachable.
if (blinkConfigured() && config.publicUrl.startsWith("https://")) {
  void registerBlinkCallback()
    .then((ok) => { if (ok) console.log(`Blink callback → ${config.publicUrl}/webhooks/blink`); })
    .catch((e) => console.error("Blink register callback failed", e));
  // Log receive routing + both wallet balances so ops can confirm the hedge is wired.
  const usd = config.blink.usdWalletId ? "USD wallet set" : "no USD wallet (BTC-only)";
  console.log(`Blink receive policy: ${config.blink.receivePolicy} (${usd})`);
  void blinkBalances().then((bals) => {
    if (bals?.length) console.log(`Blink balances: ${bals.map((b) => `${b.currency} ${b.balance}${b.currency === "BTC" ? " sat" : b.currency === "USD" ? "¢" : ""}`).join(", ")}`);
  });
}

const server = app.listen(config.port, () => {
  const rails = [ibexConfigured() && `IBEX Hub (${config.ibex.env})`, blinkConfigured() && `Blink (${config.blink.env})`].filter(Boolean);
  const crypto = rails.length ? rails.join(" + ") : "sandbox";
  console.log(`MoMo›Me settlement engine → http://localhost:${config.port}  [payout: ${config.railsMode}, crypto: ${crypto}]`);
});

// Safety net: an unhandled promise rejection in an async route (Express 4 does not
// forward it to the error middleware) would otherwise, under Node's default policy,
// crash the whole settlement engine → full outage. Log and keep serving instead;
// the offending request still fails, but every other in-flight payment survives.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason instanceof Error ? reason.stack : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err instanceof Error ? err.stack : err);
});

// Flush any pending state to SQLite on graceful shutdown.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    flushAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
