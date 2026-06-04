import { createApp } from "./app.js";
import { config, assertLiveConfig, assertIbexConfig, ibexConfigured } from "./config.js";
import { flushAll } from "./core/persist.js";
import { reconcileStuckPayouts, reconcileStuckInbounds } from "./core/stateMachine.js";
import { registerAccountWebhook, rate as ibexRate } from "./adapters/ibex.js";
import { setRates, CCY } from "./core/rates.js";

assertLiveConfig();
assertIbexConfig();
const app = createApp();

// Backstop: re-query payouts AND inbounds stuck awaiting a (possibly lost) callback.
setInterval(() => {
  void reconcileStuckPayouts().catch((e) => console.error("reconcile payouts", e));
  if (ibexConfigured()) void reconcileStuckInbounds().catch((e) => console.error("reconcile inbounds", e));
}, 30_000).unref();

// FX feed: pull IBEX's live BTC/USD, USDT/USD and EUR/USD into the rate cache so
// quotes price at the same source that settles the inbound. Refreshed every 30s;
// quoting reads the cache synchronously and locks the rate at quote time.
if (ibexConfigured()) {
  const refreshFxRates = async () => {
    const [btc, usdt, eur] = await Promise.all([
      ibexRate(CCY.BTC, CCY.USD), ibexRate(CCY.USDT, CCY.USD), ibexRate(CCY.EUR, CCY.USD),
    ]);
    setRates({ btcUsd: btc, usdtUsd: usdt, eurUsd: eur });
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

const server = app.listen(config.port, () => {
  const crypto = ibexConfigured() ? `IBEX Hub (${config.ibex.env})` : "sandbox";
  console.log(`MoMo›Me settlement engine → http://localhost:${config.port}  [payout: ${config.railsMode}, crypto: ${crypto}]`);
});

// Flush any pending state to SQLite on graceful shutdown.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    flushAll();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 500).unref();
  });
}
