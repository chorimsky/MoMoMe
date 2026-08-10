/* ============================================================
   Blink (Galoy) rail adapter — pure-logic test (no network).
   Covers parseEvent (real Blink callback → normalised RailEvent, keyed on the
   `receive.*`/`send.*` eventType), verifyWebhook (Svix signature scheme), and the
   sats↔BTC amount conversion. The GraphQL calls (createInstruction /
   confirmSettlement) need live creds and aren't run here; real settlement is
   guarded by confirmSettlement at the webhook layer.
   Run: pnpm --filter @momome/server test:blink
   ============================================================ */
import assert from "node:assert/strict";
import crypto from "node:crypto";

// Configure Blink BEFORE importing config/adapter (config reads env at load). The
// webhook secret is a Svix `whsec_<base64>` endpoint signing secret (as Blink issues).
process.env.BLINK_API_KEY = "blink_test_key";
process.env.BLINK_WALLET_ID = "wallet_btc_test";
process.env.BLINK_USD_WALLET_ID = "wallet_usd_test"; // Stablesats wallet → enables the hedge (default policy = split)
process.env.BLINK_WEBHOOK_SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";
// BLINK_ENV unset → sandbox → not trusted (verifyWebhook still enforces the signature).

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

// Replicate the adapter's Svix key derivation + signing so the test is self-contained.
function svixKey(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const decoded = Buffer.from(raw, "base64");
  return decoded.length && decoded.toString("base64").replace(/=+$/, "") === raw.replace(/=+$/, "") ? decoded : Buffer.from(raw);
}
function svixSign(secret: string, id: string, ts: string, body: string): string {
  return crypto.createHmac("sha256", svixKey(secret)).update(`${id}.${ts}.${body}`).digest("base64");
}

async function main() {
  const { blinkAdapter, receiveTarget } = await import("../src/adapters/blink.js");
  const { blinkConfigured, blinkLive, config } = await import("../src/config.js");
  const SECRET = process.env.BLINK_WEBHOOK_SECRET!;

  console.log("\nBlink adapter — config + capabilities");
  ok("configured with key + wallet", blinkConfigured());
  ok("not live in sandbox env", !blinkLive());
  ok("not trusted in sandbox env", !blinkAdapter.trusted());
  ok("supports LIGHTNING + ONCHAIN", blinkAdapter.supports("LIGHTNING") && blinkAdapter.supports("ONCHAIN"));
  ok("does NOT support USDT/USDC (Blink USD wallet is fiat, not ERC-20)", !blinkAdapter.supports("USDT") && !blinkAdapter.supports("USDC"));
  ok("priority is after IBEX (0)", blinkAdapter.priority > 0);

  console.log("\nBlink adapter — receive routing (BLINK_RECEIVE_POLICY)");
  // USD wallet is set → default policy = split: LIGHTNING → BTC, ONCHAIN → USD.
  ok("default policy is 'split' (USD wallet present)", config.blink.receivePolicy === "split", config.blink.receivePolicy);
  ok("split: LIGHTNING → BTC wallet", receiveTarget("LIGHTNING").currency === "BTC" && receiveTarget("LIGHTNING").walletId === "wallet_btc_test");
  ok("split: ONCHAIN → USD (Stablesats) wallet", receiveTarget("ONCHAIN").currency === "USD" && receiveTarget("ONCHAIN").walletId === "wallet_usd_test");

  console.log("\nBlink adapter — parseEvent (real receive.* shape)");
  // receive.lightning, settled. 25,000 sats = 0.00025 BTC.
  {
    const ev = blinkAdapter.parseEvent({ eventType: "receive.lightning", transaction: { status: "SUCCESS", settlementAmount: 25000, initiationVia: { paymentHash: "hash_abc", type: "lightning" } } });
    ok("receive.lightning SUCCESS → confirmed", ev?.kind === "confirmed" && ev.providerRef === "hash_abc");
    ok("LN amount sats→BTC", ev?.amount === 0.00025, String(ev?.amount));
  }
  // Pending → detected.
  {
    const ev = blinkAdapter.parseEvent({ eventType: "receive.lightning", transaction: { status: "PENDING", initiationVia: { paymentHash: "h2" } } });
    ok("receive.lightning PENDING → detected", ev?.kind === "detected" && ev.providerRef === "h2");
  }
  // Outbound send → ignored (eventType send.*).
  ok("send.lightning → null (outbound)", blinkAdapter.parseEvent({ eventType: "send.lightning", transaction: { status: "SUCCESS", settlementAmount: 5000, initiationVia: { paymentHash: "h4" } } }) === null);
  // Failure → ignored.
  ok("FAILURE → null (ignored)", blinkAdapter.parseEvent({ eventType: "receive.lightning", transaction: { status: "FAILURE", initiationVia: { paymentHash: "h3" } } }) === null);
  // Negative settlement (outbound) → ignored even without a send.* eventType.
  ok("negative settlementAmount → null", blinkAdapter.parseEvent({ eventType: "receive.lightning", transaction: { status: "SUCCESS", settlementAmount: -5000, initiationVia: { paymentHash: "h5" } } }) === null);
  // On-chain receive, matched by address.
  {
    const ev = blinkAdapter.parseEvent({ eventType: "receive.onchain", transaction: { status: "SUCCESS", settlementAmount: 100000, initiationVia: { address: "bc1qexampleaddr", type: "onchain" } } });
    ok("receive.onchain → providerRef=address", ev?.providerRef === "bc1qexampleaddr" && ev.kind === "confirmed");
  }
  // receive.* with no explicit status but a positive amount → confirmed.
  {
    const ev = blinkAdapter.parseEvent({ eventType: "receive.lightning", transaction: { settlementAmount: 5000, initiationVia: { paymentHash: "h6" } } });
    ok("receive.* + positive amount, no status → confirmed", ev?.kind === "confirmed" && ev.amount === 0.00005);
  }
  ok("no providerRef → null", blinkAdapter.parseEvent({ eventType: "receive.lightning", transaction: { status: "SUCCESS" } }) === null);
  // USD (Stablesats) receive: settlementAmount is CENTS, not sats → confirmed but no
  // BTC amount (the under/overpayment check is skipped; confirmSettlement is authoritative).
  {
    const ev = blinkAdapter.parseEvent({ eventType: "receive.lightning", transaction: { status: "SUCCESS", settlementCurrency: "USD", settlementAmount: 1500, initiationVia: { paymentHash: "hUsd" } } });
    ok("USD receive → confirmed, amount undefined (cents≠sats)", ev?.kind === "confirmed" && ev.providerRef === "hUsd" && ev.amount === undefined);
  }

  console.log("\nBlink adapter — verifyWebhook (Svix)");
  const body = JSON.stringify({ eventType: "receive.lightning", transaction: { status: "SUCCESS", initiationVia: { paymentHash: "x" } } });
  const id = "msg_2abc", ts = "1700000000";
  const sig = svixSign(SECRET, id, ts, body);
  ok("valid Svix signature accepted", blinkAdapter.verifyWebhook(body, { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` }));
  ok("standard webhook-* header aliases accepted", blinkAdapter.verifyWebhook(body, { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` }));
  ok("multiple space-separated tokens, one valid → accepted", blinkAdapter.verifyWebhook(body, { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,badsig v1,${sig}` }));
  ok("wrong signature rejected", !blinkAdapter.verifyWebhook(body, { "svix-id": id, "svix-timestamp": ts, "svix-signature": "v1,ZGVhZGJlZWY=" }));
  ok("tampered body rejected", !blinkAdapter.verifyWebhook(body + " ", { "svix-id": id, "svix-timestamp": ts, "svix-signature": `v1,${sig}` }));
  ok("missing signature header rejected", !blinkAdapter.verifyWebhook(body, { "svix-id": id, "svix-timestamp": ts }));

  console.log("\nBlink adapter — confirmSettlement guard (on-chain safety)");
  // A non-64-hex providerRef (an on-chain address) is not a payment hash → null
  // (indeterminate, no network call), so the on-chain callback isn't wrongly dropped.
  ok("on-chain address → null", (await blinkAdapter.confirmSettlement!("bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4")) === null);
  ok("garbage ref → null", (await blinkAdapter.confirmSettlement!("not-a-hash")) === null);

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
