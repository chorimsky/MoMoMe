import { createApp } from "./app.js";
import { config, assertLiveConfig, assertIbexConfig, ibexConfigured } from "./config.js";
import { flushAll } from "./core/persist.js";
import { reconcileStuckPayouts, reconcileStuckInbounds } from "./core/stateMachine.js";
import { registerAccountWebhook } from "./adapters/ibex.js";

assertLiveConfig();
assertIbexConfig();
const app = createApp();

// Backstop: re-query payouts AND inbounds stuck awaiting a (possibly lost) callback.
setInterval(() => {
  void reconcileStuckPayouts().catch((e) => console.error("reconcile payouts", e));
  if (ibexConfigured()) void reconcileStuckInbounds().catch((e) => console.error("reconcile inbounds", e));
}, 30_000).unref();

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
