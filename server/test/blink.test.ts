/* ============================================================
   Blink (Galoy) rail adapter — pure-logic test (no network).
   Covers parseEvent (webhook → normalised RailEvent), verifyWebhook (HMAC /
   svix signature), and the sats↔BTC amount conversion. The GraphQL calls
   (createInstruction / confirmSettlement) require live creds and aren't run
   here; real settlement is guarded by confirmSettlement at the webhook layer.
   Run: pnpm --filter @momome/server test:blink
   ============================================================ */
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Configure Blink BEFORE importing config/adapter (config reads env at load).
process.env.BLINK_API_KEY = "blink_test_key";
process.env.BLINK_WALLET_ID = "wallet_test";
process.env.BLINK_WEBHOOK_SECRET = "shh-secret";
// BLINK_ENV unset → sandbox → not trusted (verifyWebhook still uses the secret).

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { blinkAdapter } = await import("../src/adapters/blink.js");
  const { blinkConfigured, blinkLive } = await import("../src/config.js");

  console.log("\nBlink adapter — config + capabilities");
  ok("configured with key + wallet", blinkConfigured());
  ok("not live in sandbox env", !blinkLive());
  ok("not trusted in sandbox env", !blinkAdapter.trusted());
  ok("supports LIGHTNING + ONCHAIN", blinkAdapter.supports("LIGHTNING") && blinkAdapter.supports("ONCHAIN"));
  ok("does NOT support USDT/USDC (Blink USD wallet is fiat, not ERC-20)", !blinkAdapter.supports("USDT") && !blinkAdapter.supports("USDC"));
  ok("priority is after IBEX (0)", blinkAdapter.priority > 0);

  console.log("\nBlink adapter — parseEvent");
  // Lightning received, confirmed. 25,000 sats = 0.00025 BTC.
  {
    const ev = blinkAdapter.parseEvent({ transaction: { status: "SUCCESS", direction: "RECEIVE", settlementAmount: 25000, initiationVia: { paymentHash: "hash_abc" } } });
    ok("LN success → confirmed", ev?.kind === "confirmed" && ev.providerRef === "hash_abc");
    ok("LN amount sats→BTC", ev?.amount === 0.00025, String(ev?.amount));
  }
  // Pending → detected.
  {
    const ev = blinkAdapter.parseEvent({ transaction: { status: "PENDING", direction: "RECEIVE", initiationVia: { paymentHash: "h2" } } });
    ok("LN pending → detected", ev?.kind === "detected" && ev.providerRef === "h2");
  }
  // Failure → ignored.
  ok("FAILURE → null (ignored)", blinkAdapter.parseEvent({ transaction: { status: "FAILURE", direction: "RECEIVE", initiationVia: { paymentHash: "h3" } } }) === null);
  // Outbound send → ignored (only inbound receives matter).
  ok("SEND direction → null", blinkAdapter.parseEvent({ transaction: { status: "SUCCESS", direction: "SEND", initiationVia: { paymentHash: "h4" } } }) === null);
  // On-chain by address.
  {
    const ev = blinkAdapter.parseEvent({ transaction: { status: "SUCCESS", direction: "RECEIVE", settlementAmount: 100000, initiationVia: { address: "bc1qexampleaddr" } } });
    ok("on-chain address → providerRef=address", ev?.providerRef === "bc1qexampleaddr" && ev.kind === "confirmed");
  }
  // Flat/top-level shape.
  {
    const ev = blinkAdapter.parseEvent({ paymentHash: "flat_hash", status: "SUCCESS", amount: 5000 });
    ok("flat shape parsed", ev?.providerRef === "flat_hash" && ev.kind === "confirmed" && ev.amount === 0.00005);
  }
  ok("no providerRef → null", blinkAdapter.parseEvent({ transaction: { status: "SUCCESS" } }) === null);

  console.log("\nBlink adapter — verifyWebhook");
  const body = JSON.stringify({ transaction: { status: "SUCCESS", initiationVia: { paymentHash: "x" } } });
  const hexSig = crypto.createHmac("sha256", "shh-secret").update(body).digest("hex");
  ok("valid HMAC hex signature accepted", blinkAdapter.verifyWebhook(body, { "x-blink-signature": hexSig }));
  ok("wrong signature rejected", !blinkAdapter.verifyWebhook(body, { "x-blink-signature": "deadbeef" }));
  ok("missing signature rejected", !blinkAdapter.verifyWebhook(body, {}));
  // svix-style: sig over `${id}.${ts}.${body}` in base64.
  const svixSig = crypto.createHmac("sha256", "shh-secret").update(`msg_1.1700000000.${body}`).digest("base64");
  ok("svix v1 signature accepted", blinkAdapter.verifyWebhook(body, { "svix-id": "msg_1", "svix-timestamp": "1700000000", "svix-signature": `v1,${svixSig}` }));

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
