import { createApp } from "./app.js";
import { runBootChecks } from "./boot.js";
import { config, ibexConfigured, blinkConfigured, liveMoney, peexitLive } from "./config.js";
import { flushAll } from "./core/persist.js";
import { egressStatus } from "./core/egress.js";
import { registerAccountWebhook } from "./adapters/ibex.js";
import { registerBlinkCallback, blinkBalances } from "./adapters/blink.js";
import { reconcileTick, fxTick } from "./jobs.js";
import { usingPostgres } from "./db/store.js";
import { applySchema } from "./db/pg.js";
import { hydrateSnapshots } from "./core/persist.js";
import { hydrateComplianceChain } from "./core/compliance.js";

runBootChecks(); // asserts + fail-closed durability/admin/peexit checks (shared with the Vercel handler)
// Postgres backend: ensure the schema exists + rehydrate the non-money snapshots AND the
// durable compliance chain before serving — parity with the Vercel handler (api/index.ts).
// Without hydrateComplianceChain, the import-time anchor re-heal runs on an empty chain and
// verifyIntegrity() reads as truncated/invalid on a Postgres-backed Railway deploy.
if (usingPostgres()) { await applySchema(); await hydrateSnapshots(); await hydrateComplianceChain(); }
const app = createApp();

// Railway (long-lived process) drives the background jobs on timers; on Vercel the SAME
// jobs run via /api/cron/* (routes/cron.ts) since serverless has no persistent process.
setInterval(() => void reconcileTick(), 30_000).unref();
if (ibexConfigured() || blinkConfigured() || liveMoney()) {
  void fxTick().catch((e) => console.error("fx rates", e)); // prime the cache at boot
  setInterval(() => void fxTick().catch((e) => console.error("fx rates", e)), 30_000).unref();
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

/* EGRESS IP — the address an IP-allowlisting rail must whitelist. Peexit production 403s
   any non-allowlisted source REGARDLESS of the SECRETKEY, so this is production config as
   load-bearing as a credential. egressStatus() also detects DRIFT (a redeploy onto new
   infrastructure is exactly how an allowlisted rail breaks) and says what to register.
   Best-effort and fire-and-forget: never blocks the listen, never throws. */
void egressStatus().then((e) => {
  if (!e.ip && !e.proxied) return;
  console.log(`[egress] ${e.note}`);
  if (e.previousIp) console.warn(`[egress] outbound IP moved from ${e.previousIp} — re-register it with any IP-allowlisting rail.`);
  if (e.matches === false && peexitLive()) {
    console.warn("[egress] Peexit is LIVE and the egress IP does not match the allowlisted address — expect nginx 403 on every Peexit call until this is fixed.");
  }
}).catch(() => {});

const server = app.listen(config.port, () => {
  const rails = [ibexConfigured() && `IBEX Hub (${config.ibex.env})`, blinkConfigured() && `Blink (${config.blink.env})`].filter(Boolean);
  const crypto = rails.length ? rails.join(" + ") : "sandbox";
  console.log(`MoMo›Me settlement engine → http://localhost:${config.port}  [payout: ${config.railsMode}, crypto: ${crypto}]`);
});

// Process-level guards are installed by runBootChecks() → installProcessGuards(), shared
// with the Vercel entrypoint so the two runtimes cannot drift.

// Flush any pending state on graceful shutdown. flushAll() is async on the Postgres
// backend (network snapshot writes), so AWAIT it before closing the server / exiting —
// otherwise the final snapshot can be lost to the 500ms exit timer.
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    void flushAll()
      .catch((e) => console.error("[shutdown] flushAll failed", e))
      .finally(() => server.close(() => process.exit(0)));
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
