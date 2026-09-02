/* ============================================================
   Crypto-inbound rail REGISTRY test — IBEX (the one real rail) configured.
   Asserts priority ordering (IBEX 0 → sandbox catch-all), per-method routing, and the
   generalised trusted() mapping that keeps the rest of the codebase free of
   `provider === "ibex"` couplings. No network: only pure selection is exercised.
   Run: pnpm --filter @momome/server test:registry:cfg
   ============================================================ */
import assert from "node:assert/strict";

// Configure the crypto rail BEFORE importing config/registry (env is read at load).
process.env.IBEX_CLIENT_ID = "ibx_id";
process.env.IBEX_CLIENT_SECRET = "ibx_secret";
process.env.IBEX_ACCOUNT_ID = "ibx_acct";
process.env.IBEX_ENV = "production"; // → IBEX live → trusted
delete process.env.IBEX_USDT_ACCOUNT_ID; // no stablecoin account → USDT falls through
delete process.env.IBEX_USDC_ACCOUNT_ID;

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const reg = await import("../src/adapters/index.js");

  console.log("\nRail registry — IBEX configured");
  ok("activeRails ordered ibex → sandbox", reg.activeRails().map((r) => r.name).join(",") === "ibex,sandbox");

  ok("LIGHTNING → ibex (base, priority 0)", reg.adapterFor("LIGHTNING").name === "ibex");
  ok("ONCHAIN → ibex", reg.adapterFor("ONCHAIN").name === "ibex");
  // IBEX is account-per-currency and doesn't advertise USDT without its stablecoin
  // account, so USDT falls through to the sandbox catch-all.
  ok("USDT → sandbox (no IBEX stablecoin account configured)", reg.adapterFor("USDT").name === "sandbox");

  ok("providerFor(LIGHTNING) = ibex", reg.providerFor("LIGHTNING") === "ibex");

  // Generalised trust mapping (replaces provider === "ibex" && ibexInboundTrusted()).
  ok("railTrusted('ibex') = true (production)", reg.railTrusted("ibex") === true);
  ok("railTrusted('sandbox') = false", reg.railTrusted("sandbox") === false);
  ok("an unknown rail name is not trusted", reg.railTrusted("no-such-rail") === false);

  // The real rail exposes an authoritative re-query; the simulator does not.
  ok("ibex exposes confirmSettlement", typeof reg.adapterByName("ibex")?.confirmSettlement === "function");
  ok("sandbox has NO confirmSettlement", reg.adapterByName("sandbox")?.confirmSettlement === undefined);

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
