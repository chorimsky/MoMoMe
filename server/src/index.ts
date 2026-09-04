import { createApp } from "./app.js";
import { runBootChecks, assertStoredAdminCredential } from "./boot.js";
import { config, ibexConfigured, liveMoney, peexitLive } from "./config.js";
import { flushAll } from "./core/persist.js";
import { egressStatus } from "./core/egress.js";
import { registerAccountWebhook, accountBalances } from "./adapters/ibex.js";
import { reconcileTick, fxTick } from "./jobs.js";
import { usingPostgres } from "./db/store.js";
import { applySchema } from "./db/pg.js";
import { hydrateSnapshots } from "./core/persist.js";
import { hydrateComplianceChain } from "./core/compliance.js";
import { releaseStrandedEarmarks, reconcileEarmarkAccount } from "./core/stateMachine.js";
import { store } from "./db/store.js";
import { getSettings, updateSettings, DEFAULT_METHODS } from "./core/settings.js";
import { ALL_METHODS } from "../../shared/domain.js";
import { forgetAllIdentities } from "./core/identity.js";
import { forgetAllMerchants } from "./core/merchant.js";

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
// createApp() seeds the first admin, so the boot-time check above ran before any account
// existed on a fresh store. Re-run it now that one does.
assertStoredAdminCredential();

/* ---------- one-shot maintenance: clear stranded payout earmarks ----------
   A deployment that ran the old code accumulated earmarks held by payments parked for
   review and never resolved — float committed to payouts that will never happen. The float
   no longer counts them, so this is not what unblocks a payout; it is bookkeeping, putting
   payout_float_XAF back to what it should always have been.

   Gated on an env flag and run once at boot because it MOVES THE LEDGER, and that should be
   a deliberate act with a name on it rather than something a restart does quietly. Safe to
   leave set — releaseStrandedEarmarks is idempotent and finds nothing on a clean book — but
   unset it once the log shows zero, so the intent stays explicit.

   Never touches a payout in flight: that delivery leg will debit its earmark. */
if ((process.env.RELEASE_STRANDED_EARMARKS ?? "").trim() === "1") {
  void (async () => {
    const before = await store().balance("payout_float_XAF", "XAF");
    const { released, xaf, skipped } = await releaseStrandedEarmarks();
    const after = await store().balance("payout_float_XAF", "XAF");
    console.warn(`[maintenance] RELEASE_STRANDED_EARMARKS: released ${released} earmark(s) worth ${xaf} XAF; skipped ${skipped} still in flight. payout_float_XAF ${before} → ${after}. Unset the flag now.`);
    // A NON-ZERO account after a clean sweep is worth saying out loud rather than leaving
    // for someone to find. Negative = earmarks still held (a payout in flight, which is
    // correct). POSITIVE = more was released historically than was ever reserved, which no
    // current code path can produce — it predates the fixes and is a bookkeeping artefact,
    // not money. The float does not read this account, so it has no operational effect.
    // Square the account. A POSITIVE balance means historic deliveries debited an earmark
    // that was never credited — residue no current path can produce. Booked as one named
    // reconciliation rather than left for someone to find.
    const rec = await reconcileEarmarkAccount();
    console.warn(rec.adjusted === 0
      ? `[maintenance] payout_float_XAF already square at ${rec.to} XAF. Unset RELEASE_STRANDED_EARMARKS.`
      : `[maintenance] reconciled payout_float_XAF ${rec.from} → ${rec.to} XAF (adjustment ${rec.adjusted}, booked against fx_position). Unset RELEASE_STRANDED_EARMARKS.`);
  })().catch((e) => console.error("[maintenance] stranded-earmark release failed", e));
}

/* ---------- one-shot: restore the crypto pay-in methods to the code's defaults ----------
   settings.methods is persisted, so a method switched off once stays off across every
   deploy — including through the clean sheet, which deliberately keeps operator settings.
   USDC shipped complete (its own IBEX account, its own address format, its own pay screen)
   and was sitting off in the stored settings, so customers were never offered it and no
   amount of deploying changed that.

   Only ever turns a method ON, and only to the code default. It cannot switch one off — an
   operator who deliberately disabled a rail keeps that decision unless they are also the
   one setting this flag. */
if ((process.env.RESTORE_DEFAULT_METHODS ?? "").trim() === "1") {
  const cur = getSettings().methods;
  const next = { ...cur };
  let changed: string[] = [];
  for (const m of ALL_METHODS) {
    if (DEFAULT_METHODS[m] && !cur[m]) { next[m] = true; changed.push(m); }
  }
  if (changed.length) {
    updateSettings({ methods: next });
    console.warn(`[maintenance] RESTORE_DEFAULT_METHODS: enabled ${changed.join(", ")}. Unset the flag.`);
  } else {
    console.warn("[maintenance] RESTORE_DEFAULT_METHODS: nothing to enable. Unset the flag.");
  }
}

/* ---------- one-shot maintenance: forget trust learned from simulated payouts ----------
   resolveRecipient answers with a name from the identity graph as "internal", verified,
   trustLevel 2 — the strongest claim the trust layer makes — and that graph is taught by
   ensureIdentity() on every delivery. A deployment whose deliveries were all SIMULATED has
   therefore learned confirmed-looking names for numbers nobody was ever paid at, and shows
   them to real senders on a live Lightning Address.

   In this market name confirmation IS the safeguard against paying the wrong number, so a
   name learned from fiction is worse than none: it turns "unknown — confirm manually" into
   false confidence. Clearing fails SAFE, and both graphs relearn from real payouts.

   Derived trust data only. No money record is touched. */
if ((process.env.RESET_DEMO_TRUST ?? "").trim() === "1") {
  const identities = forgetAllIdentities();
  const merchants = forgetAllMerchants();
  console.warn(`[maintenance] RESET_DEMO_TRUST: forgot ${identities} learned identit${identities === 1 ? "y" : "ies"} and ${merchants} merchant(s). Recipient names now resolve as "unknown — confirm manually" until real payouts teach them again. Unset the flag.`);
}

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
        // IBEX is account-per-currency, so the id alone is not enough — an operator has to
        // know WHICH of them is BTC vs USDT vs USDC to set the three vars correctly.
        const CCY: Record<number, string> = { 0: "MSAT", 1: "SATS", 2: "BTC", 3: "USD", 8: "EUR", 29: "USDT", 30: "USDC" };
        const accounts = await accountBalances();
        const rows = Object.entries(accounts).map(([id, a]) => `${CCY[a.currencyId] ?? `ccy${a.currencyId}`}=${id}`);
        if (rows.length) {
          // Only call it wrong if it actually IS absent. The first version of this message
          // asserted "is not an account" whenever registration failed, and printed that
          // beside a listing containing the very id it was rejecting — a confident, wrong
          // diagnosis is worse than none.
          const known = Object.keys(accounts).includes(config.ibex.accountId);
          console.error(known
            ? `[ibex] IBEX_ACCOUNT_ID="${config.ibex.accountId}" IS a valid account — the webhook registration failed for another reason (see above). Accounts: ${rows.join("  ")}`
            : `[ibex] IBEX_ACCOUNT_ID="${config.ibex.accountId}" is not an account on this organisation. Available: ${rows.join("  ")}`);
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
