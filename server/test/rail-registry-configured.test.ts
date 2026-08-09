/* ============================================================
   Crypto-inbound rail REGISTRY test — IBEX (base) + Blink configured.
   Asserts priority ordering (IBEX 0 → Blink 10 → sandbox catch-all), per-method
   routing, and the generalised trusted() mapping that replaced the old
   `provider === "ibex"` couplings. No network: only pure selection is exercised.
   Run: pnpm --filter @momome/server test:registry:cfg
   ============================================================ */
import assert from "node:assert/strict";

// Configure BOTH crypto rails BEFORE importing config/registry (env read at load).
process.env.IBEX_CLIENT_ID = "ibx_id";
process.env.IBEX_CLIENT_SECRET = "ibx_secret";
process.env.IBEX_ACCOUNT_ID = "ibx_acct";
process.env.IBEX_ENV = "production"; // → IBEX live → trusted
delete process.env.IBEX_USDT_ACCOUNT_ID; // no stablecoin account → USDT falls through
delete process.env.IBEX_USDC_ACCOUNT_ID;
process.env.BLINK_API_KEY = "blink_key";
process.env.BLINK_WALLET_ID = "blink_wallet";
delete process.env.BLINK_ENV; // → Blink sandbox → configured but NOT trusted

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const reg = await import("../src/adapters/index.js");

  console.log("\nRail registry — IBEX (base) + Blink configured");
  ok("activeRails ordered ibex → blink → sandbox", reg.activeRails().map((r) => r.name).join(",") === "ibex,blink,sandbox");

  ok("LIGHTNING → ibex (base, priority 0)", reg.adapterFor("LIGHTNING").name === "ibex");
  ok("ONCHAIN → ibex", reg.adapterFor("ONCHAIN").name === "ibex");
  // IBEX doesn't advertise USDT without a stablecoin account, and Blink is BTC-only →
  // USDT falls through to the sandbox catch-all.
  ok("USDT → sandbox (no IBEX stablecoin acct, Blink is BTC-only)", reg.adapterFor("USDT").name === "sandbox");

  ok("providerFor(LIGHTNING) = ibex", reg.providerFor("LIGHTNING") === "ibex");

  // Generalised trust mapping (replaces provider === "ibex" && ibexInboundTrusted()).
  ok("railTrusted('ibex') = true (production)", reg.railTrusted("ibex") === true);
  ok("railTrusted('blink') = false (sandbox env)", reg.railTrusted("blink") === false);
  ok("railTrusted('sandbox') = false", reg.railTrusted("sandbox") === false);

  // Both real rails expose an authoritative re-query; sandbox does not.
  ok("ibex exposes confirmSettlement", typeof reg.adapterByName("ibex")?.confirmSettlement === "function");
  ok("blink exposes confirmSettlement", typeof reg.adapterByName("blink")?.confirmSettlement === "function");
  ok("sandbox has NO confirmSettlement", reg.adapterByName("sandbox")?.confirmSettlement === undefined);

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
