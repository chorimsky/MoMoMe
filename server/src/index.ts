import { createApp } from "./app.js";
import { runBootChecks } from "./boot.js";
import { config, ibexConfigured, liveMoney, peexitLive } from "./config.js";
import { flushAll } from "./core/persist.js";
import { egressStatus } from "./core/egress.js";
import { registerAccountWebhook, accountBalances } from "./adapters/ibex.js";
import { reconcileTick, fxTick } from "./jobs.js";
import { usingPostgres } from "./db/store.js";
import { applySchema } from "./db/pg.js";
import { hydrateSnapshots } from "./core/persist.js";
import { hydrateComplianceChain } from "./core/compliance.js";

// Boot checks fail CLOSED, which is right — but on Railway's railpack runtime stderr is not
// captured, so a throw here left literally no trace: the container simply never answered its
// healthcheck, four deploys in a row, with an empty log. An unreadable failure is barely
// better than a silent one, so the reason goes to stdout before the throw propagates.
try {
  runBootChecks(); // asserts + fail-closed durability/admin/peexit checks (shared with the Vercel handler)
} catch (e) {
  console.log(`[boot] REFUSED TO START: ${e instanceof Error ? e.message : String(e)}`);
  throw e;
}
// Postgres backend: ensure the schema exists + rehydrate the non-money snapshots AND the
// durable compliance chain before serving — parity with the Vercel handler (api/index.ts).
// Without hydrateComplianceChain, the import-time anchor re-heal runs on an empty chain and
// verifyIntegrity() reads as truncated/invalid on a Postgres-backed Railway deploy.
if (usingPostgres()) { await applySchema(); await hydrateSnapshots(); await hydrateComplianceChain(); }
const app = createApp();

// Railway (long-lived process) drives the background jobs on timers; on Vercel the SAME
// jobs run via /api/cron/* (routes/cron.ts) since serverless has no persistent process.
setInterval(() => void reconcileTick(), 30_000).unref();
if (ibexConfigured() || liveMoney()) {
  void fxTick().catch((e) => console.error("fx rates", e)); // prime the cache at boot
  setInterval(() => void fxTick().catch((e) => console.error("fx rates", e)), 30_000).unref();
}

// Register the IBEX account-level webhook so on-chain deposits (and all account
// transactions) notify us. Needs a publicly-reachable https URL — skipped in
// local dev where IBEX can't call back.
if (ibexConfigured() && config.publicUrl.startsWith("https://")) {
  void registerAccountWebhook()
    .then(() => console.log(`IBEX account webhook → ${config.publicUrl}/webhooks/ibex`))
    .catch(async (e) => {
      console.error("IBEX register account webhook failed", e);
      // A wrong IBEX_ACCOUNT_ID is otherwise a dead end. IBEX answers "account not found" /
      // "incorrect account id" without saying which accounts DO exist, the id is a UUID
      // nobody can guess, and reading it means logging into their console. The credentials
      // we already hold can list them — so say what the valid options are instead of
      // leaving an operator to hunt. Account ids are identifiers, not secrets (the failing
      // one is already in the line above); best-effort and never fatal.
      try {
        const ids = Object.keys(await accountBalances());
        if (ids.length) {
          console.error(`[ibex] IBEX_ACCOUNT_ID="${config.ibex.accountId}" is not an account on this organisation. Available account ids: ${ids.join(", ")}`);
        }
      } catch { /* listing is a courtesy, not a requirement */ }
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
  const crypto = ibexConfigured() ? `IBEX Hub (${config.ibex.env})` : "sandbox";
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
