/* ============================================================
   Crypto-OUTBOUND (refund) abstraction — proves "Blink without IBEX" refunds.
   Configures Blink ALONE in production (no IBEX creds) and asserts the outbound rail
   resolves to Blink, plus the pure BOLT11 decoders the refund flow depends on.
   Run: pnpm --filter @momome/server test:outbound
   ============================================================ */
import assert from "node:assert/strict";

// Blink ONLY, production → trusted → eligible for outbound. No IBEX creds set.
process.env.BLINK_API_KEY = "blink_test_key";
process.env.BLINK_WALLET_ID = "wallet_btc_test";
process.env.BLINK_USD_WALLET_ID = "wallet_usd_test";
process.env.BLINK_WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
process.env.BLINK_ENV = "production";
process.env.PUBLIC_URL = "https://example.test";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

// Canonical BOLT11 test vector (BOLT #11 spec) — 2500µBTC, known payment hash.
const INV_2500U =
  "lnbc2500u1pvjluezpp5qqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqqqsyqcyq5rqwzqfqypqdq5xysxxatsyp3k7enxv4jsxqzpuaztrnwngzn3kdzw5hydlzf03qdgm2hdq27cqv3agm2awhz5se903vruatfhq77w3ls4evs3ch9zw97j25emudupq63nyw24cg27h2rspfj9srp";
const KNOWN_HASH = "0001020304050607080900010203040506070809000102030405060708090102";

async function main() {
  const { bolt11PaymentHash, bolt11AmountMsat } = await import("../src/core/bolt11.js");
  const { outboundRail, refundStatus } = await import("../src/adapters/index.js");
  const { blinkAdapter } = await import("../src/adapters/blink.js");
  const { ibexConfigured, blinkLive } = await import("../src/config.js");

  console.log("\nBOLT11 decoders (pure)");
  ok("payment hash decoded from bech32", bolt11PaymentHash(INV_2500U) === KNOWN_HASH, bolt11PaymentHash(INV_2500U) ?? "null");
  ok("amount decoded (2500µBTC → 250000000 msat)", bolt11AmountMsat(INV_2500U) === 250_000_000, String(bolt11AmountMsat(INV_2500U)));
  ok("amount-less invoice → 0", bolt11AmountMsat("lnbc1pvjluezpp5") === 0, String(bolt11AmountMsat("lnbc1pvjluezpp5")));
  ok("garbage → null hash", bolt11PaymentHash("not-an-invoice") === null);

  console.log("\nOutbound rail selection — Blink standalone (no IBEX)");
  ok("IBEX is NOT configured", !ibexConfigured());
  ok("Blink is live (production)", blinkLive());
  ok("Blink adapter exposes payInvoice + outboundStatus", typeof blinkAdapter.payInvoice === "function" && typeof blinkAdapter.outboundStatus === "function");
  const rail = outboundRail();
  ok("outboundRail() resolves to Blink (Blink-without-IBEX refunds)", rail?.name === "blink", rail?.name ?? "none");

  console.log("\nrefundStatus routing");
  ok("unknown provider → null (no crash)", (await refundStatus("does-not-exist", KNOWN_HASH)) === null);

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
