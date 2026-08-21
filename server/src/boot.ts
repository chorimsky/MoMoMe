/* ============================================================
   One-time boot validation, shared by BOTH runtimes:
     • the always-on Railway server (src/index.ts), and
     • the Vercel serverless function handler (api/index.ts).
   Fails closed on unsafe config so neither runtime starts in a dangerous state.
   Kept separate from index.ts (which also owns the listen + background pollers,
   neither of which exists on serverless) so the checks can't drift between the two.
   ============================================================ */
import { config, assertLiveConfig, assertIbexConfig, assertBlinkConfig, assertAdminSecurity, assertCronSecurity, assertComplianceConfig, liveMoney, peexitLive } from "./config.js";
import { persistDurable } from "./core/persist.js";

/** Validate config + storage durability. Throws (fail-closed) when a real-money rail
 *  would run on an unsafe footing; warns on softer misconfigurations. */
export function runBootChecks(): void {
  assertLiveConfig();
  assertIbexConfig();
  assertBlinkConfig();
  assertAdminSecurity(); // fail closed on a default admin password in production
  assertCronSecurity(); // fail closed if the cron endpoint would be world-triggerable in production
  assertComplianceConfig(); // fail closed on an UNKEYED (forgeable) compliance chain in production

  // Never run a real-money rail on a non-durable store — payments, ledger and the
  // 10-year compliance chain would be silently lost. On serverless this is the guard
  // that keeps a sandbox deploy from ever masquerading as live before Phase 2 wires a
  // durable managed database (node:sqlite's local file is NOT durable on Vercel).
  if (liveMoney() && !persistDurable()) {
    throw new Error("Real-money rail is live but the database is NOT durable (node:sqlite unavailable or DB_PATH not writable) — refusing to start. Fix DB_PATH / the mounted volume (or a managed DB), or run fully in sandbox.");
  }
  if (config.admin.passwordIsDefault && (config.publicUrl.startsWith("https://") || liveMoney())) {
    console.warn("⚠️  ADMIN_PASSWORD is not set — the admin console is using the default password. Set ADMIN_PASSWORD in the environment.");
  }
  if (peexitLive() && !config.peexit.callbackPass) {
    console.warn("⚠️  PEEXIT is live but PEEXIT_CALLBACK_PASS is not set — payout callbacks will be REJECTED (settlement falls back to slower reconcile polling). Set PEEXIT_CALLBACK_USER/PEEXIT_CALLBACK_PASS and give them to Peexit with your callback URL.");
  }
}
