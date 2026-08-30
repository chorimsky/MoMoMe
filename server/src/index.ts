import { createApp } from "./app.js";
import { runBootChecks } from "./boot.js";
import { config, ibexConfigured, blinkConfigured, liveMoney } from "./config.js";
import { flushAll } from "./core/persist.js";
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

/* EGRESS IP — log it once at boot. Peexit PRODUCTION (server.peexit.com) is
   IP-allowlisted and 403s any non-allowlisted source REGARDLESS of the SECRETKEY, so the
   single most important operational fact about this host is which IP its outbound calls
   leave from — it is what Peexit has to whitelist. Discovering it previously meant asking
   the provider why they were 403ing us. Best-effort and fire-and-forget: a short timeout,
   never blocks the listen, never throws, and prints nothing sensitive.
   (When EGRESS_PROXY_URL/PEEXIT_PROXY_URL is set, Peexit leaves via THAT proxy's IP
   instead — allowlist the proxy, not this address.) */
void (async () => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch("https://api.ipify.org?format=json", { signal: ctrl.signal });
      const ip = ((await r.json()) as { ip?: string }).ip;
      if (ip) {
        const proxied = config.peexit.proxyUrl ? " (Peexit egresses via PEEXIT_PROXY_URL, not this IP)" : "";
        console.log(`[egress] outbound IP: ${ip}${proxied} — this is the address an IP-allowlisting rail (e.g. Peexit production) must whitelist.`);
      }
    } finally { clearTimeout(t); }
  } catch { /* never let a diagnostic affect startup */ }
})();

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
