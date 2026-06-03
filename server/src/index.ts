import { createApp } from "./app.js";
import { config, assertLiveConfig, assertIbexConfig, ibexConfigured } from "./config.js";
import { flushAll } from "./core/persist.js";
import { reconcileStuckPayouts } from "./core/stateMachine.js";

assertLiveConfig();
assertIbexConfig();
const app = createApp();

// Backstop: re-query payouts stuck awaiting a (possibly lost) callback.
setInterval(() => { void reconcileStuckPayouts().catch((e) => console.error("reconcile", e)); }, 30_000).unref();

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
