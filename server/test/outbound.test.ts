/* ============================================================
   Crypto-OUTBOUND (refund) abstraction. Asserts the outbound rail is selected through
   the registry — not hardwired — and covers the pure BOLT11 decoders the refund flow
   depends on. The selection stays generic so a future rail sends refunds without the
   state machine changing; today IBEX is the only rail that can.
   Run: pnpm --filter @momome/server test:outbound
   ============================================================ */
import assert from "node:assert/strict";

// IBEX in production → trusted → eligible for outbound.
process.env.IBEX_CLIENT_ID = "ibx_id";
process.env.IBEX_CLIENT_SECRET = "ibx_secret";
process.env.IBEX_ACCOUNT_ID = "ibx_acct";
process.env.IBEX_ENV = "production";
process.env.IBEX_WEBHOOK_SECRET = "ibx_webhook_secret";
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
  const { ibexAdapter } = await import("../src/adapters/ibex.js");
  const { ibexLive } = await import("../src/config.js");

  console.log("\nBOLT11 decoders (pure)");
  ok("payment hash decoded from bech32", bolt11PaymentHash(INV_2500U) === KNOWN_HASH, bolt11PaymentHash(INV_2500U) ?? "null");
  ok("amount decoded (2500µBTC → 250000000 msat)", bolt11AmountMsat(INV_2500U) === 250_000_000, String(bolt11AmountMsat(INV_2500U)));
  ok("amount-less invoice → 0", bolt11AmountMsat("lnbc1pvjluezpp5") === 0, String(bolt11AmountMsat("lnbc1pvjluezpp5")));
  ok("garbage → null hash", bolt11PaymentHash("not-an-invoice") === null);

  console.log("\nOutbound rail selection");
  ok("IBEX is live (production)", ibexLive());
  ok("IBEX exposes payInvoice + outboundStatus", typeof ibexAdapter.payInvoice === "function" && typeof ibexAdapter.outboundStatus === "function");
  const rail = outboundRail();
  ok("outboundRail() resolves through the registry to IBEX", rail?.name === "ibex", rail?.name ?? "none");
  // The selection is by capability (trusted + payInvoice), never by name — that is what
  // lets a rail be swapped without touching the refund path in the state machine.
  ok("the simulator is never an outbound rail (it holds no crypto)", rail?.name !== "sandbox");

  console.log("\nrefundStatus routing");
  ok("unknown provider → null (no crash)", (await refundStatus("does-not-exist", KNOWN_HASH)) === null);

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
