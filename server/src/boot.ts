/* ============================================================
   One-time boot validation, shared by BOTH runtimes:
     • the always-on Railway server (src/index.ts), and
     • the Vercel serverless function handler (api/index.ts).
   Fails closed on unsafe config so neither runtime starts in a dangerous state.
   Kept separate from index.ts (which also owns the listen + background pollers,
   neither of which exists on serverless) so the checks can't drift between the two.
   ============================================================ */
import { config, assertLiveConfig, assertIbexConfig, assertAdminSecurity, assertCronSecurity, assertComplianceConfig, assertRailsMode, assertDeployEnv, deployEnv, databaseHost, liveMoney, peexitLive, pawapayLive } from "./config.js";
import { persistDurable } from "./core/persist.js";
import { installProcessGuards } from "./core/processGuards.js";
import { storedAdminMatches } from "./core/adminUsers.js";

/** ADMIN_PASSWORD is read ONCE, when the first admin is seeded; after that the credential
 *  is a scrypt hash in the persisted store. assertAdminSecurity() therefore checks the env
 *  var, which can disagree with reality in both directions:
 *    • Seeded while ADMIN_PASSWORD was unset, then the var set later → the flag says
 *      "not default" while `admin` / the built-in default STILL LOGS IN. A false all-clear
 *      on the one credential guarding the treasury.
 *    • Rotated after seeding → the operator believes the password changed; the old one
 *      still works and the new one does not.
 *  Both are answered by hashing the candidate against the stored salt. */
export function assertStoredAdminCredential(): void {
  const DEFAULT_PW = "momome-admin";
  const isDefault = storedAdminMatches(DEFAULT_PW);
  // Nothing seeded yet. This is the normal state at BOOT-check time on a fresh store,
  // because seedAdminUsers() runs later inside createApp() — which is why index.ts calls
  // this again afterwards, when there is actually an account to check.
  if (isDefault === null) return;
  const inProd = process.env.NODE_ENV === "production" || liveMoney();
  if (isDefault && inProd) {
    throw new Error("Refusing to start: the admin console still accepts the DEFAULT password. Setting ADMIN_PASSWORD does not change an already-seeded account — reset it in the console, or via POST /admin/forgot with ADMIN_RECOVERY_KEY.");
  }
  if (isDefault) {
    console.warn("⚠️  The admin console still accepts the DEFAULT password. ADMIN_PASSWORD only applies when the first account is seeded — reset it before this deployment handles real money.");
    return;
  }
  // Not the default, but does it match what the operator currently has in the environment?
  if (process.env.ADMIN_PASSWORD && storedAdminMatches(process.env.ADMIN_PASSWORD) === false) {
    console.warn("⚠️  ADMIN_PASSWORD does not match the stored admin credential. It is only read when the first account is seeded, so changing it did NOT change the login password — the previous one still works. Change it in the console, or via POST /admin/forgot with ADMIN_RECOVERY_KEY.");
    return;
  }
  // Say so when it is FINE. Silence is indistinguishable from "never checked", and this is
  // the credential guarding the treasury — an operator asking "is my super-admin login
  // sound?" deserves an answer in the log, not the absence of a complaint.
  console.log(`[admin] super-admin credential OK — account "admin" is not using the default password${process.env.ADMIN_PASSWORD ? " and matches ADMIN_PASSWORD" : ""}.`);
}

/** Validate config + storage durability. Throws (fail-closed) when a real-money rail
 *  would run on an unsafe footing; warns on softer misconfigurations. */
export function runBootChecks(): void {
  // FIRST: an unhandled rejection must never be able to kill the process. On serverless
  // one instance serves many concurrent requests, so a single rejection took every
  // in-flight payment down with it — the 'concurrency' failure that was not one.
  installProcessGuards();
  assertRailsMode(); // an unrecognised RAILS_MODE must never quietly mean sandbox
  assertDeployEnv(); // a preview/branch deployment must never run a real-money rail
  assertLiveConfig();
  assertIbexConfig();
  assertAdminSecurity(); // fail closed on a default admin password in production
  assertStoredAdminCredential(); // …and on the STORED one, which the env var cannot see
  assertCronSecurity(); // fail closed if the cron endpoint would be world-triggerable in production
  assertComplianceConfig(); // fail closed on an UNKEYED (forgeable) compliance chain in production

  // Never run a real-money rail on a non-durable store — payments, ledger and the
  // 10-year compliance chain would be silently lost. On serverless this is the guard
  // that keeps a sandbox deploy from ever masquerading as live before Phase 2 wires a
  // durable managed database (node:sqlite's local file is NOT durable on Vercel).
  if (liveMoney() && !persistDurable()) {
    throw new Error("Real-money rail is live but the database is NOT durable (node:sqlite unavailable or DB_PATH not writable) — refusing to start. Fix DB_PATH / the mounted volume (or a managed DB), or run fully in sandbox.");
  }
  // One line naming what this instance actually is. The dangerous mistake with a sandbox
  // environment is not knowing which database you are pointed at; show the host (never the
  // URL, which carries the password).
  console.log(`[deploy] env=${deployEnv()} · rails=${config.railsMode} · liveMoney=${liveMoney()} · store=${process.env.STORE_BACKEND || "memory"} · db=${databaseHost()}`);
  if (config.admin.passwordIsDefault && (config.publicUrl.startsWith("https://") || liveMoney())) {
    console.warn("⚠️  ADMIN_PASSWORD is not set — the admin console is using the default password. Set ADMIN_PASSWORD in the environment.");
  }
  // PawaPay callbacks are UNVERIFIED (v2 uses RFC-9421 asymmetric signatures, not
  // implemented), so the endpoint fails closed on a live rail. Payouts still settle via
  // the authoritative queryStatus re-query — say so plainly rather than implying the
  // callback path works.
  if (pawapayLive()) {
    console.warn("⚠️  PawaPay is live but its callback signature (RFC-9421) is NOT verified — callbacks are REJECTED and payouts settle via status polling + reconcile (slower, still correct).");
  }
  if (peexitLive() && !config.peexit.callbackPass) {
    console.warn("⚠️  PEEXIT is live but PEEXIT_CALLBACK_PASS is not set — payout callbacks will be REJECTED (settlement falls back to slower reconcile polling). Set PEEXIT_CALLBACK_USER/PEEXIT_CALLBACK_PASS and give them to Peexit with your callback URL.");
  }
}
