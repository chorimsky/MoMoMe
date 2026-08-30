/* ============================================================
   IBEX Hub rail adapter — end-to-end unit test.

   Two sections:
   1. PURE LOGIC (no network) — parseEvent over real IBEX transaction shapes
      (Lightning / on-chain typeId 7 / ERC-20 stablecoin, confirmed/detected/
      expired), verifyWebhook (shared-secret echo + sender-IP allowlist), and
      capability/config gating (configured / live / trusted / supports).
   2. NETWORK (mocked global fetch) — the OAuth2 client-credentials handshake,
      createInstruction (LIGHTNING invoice + ONCHAIN address) request→instruction
      shape, and transactionStatus interpretation (paid / expired / lookup-fail),
      which confirmSettlement delegates to.

   Run: pnpm --filter @momome/server test:ibex
   ============================================================ */
import assert from "node:assert/strict";

// Configure IBEX BEFORE importing config/adapter (config reads env at load).
// Sandbox + IBEX_ALLOW_SANDBOX_PAYOUT=true → trusted() true (exercises the
// real-money gating), with a webhook secret so verifyWebhook uses the secret path.
process.env.IBEX_ENV = "sandbox";
process.env.IBEX_CLIENT_ID = "ibex_client_test";
process.env.IBEX_CLIENT_SECRET = "ibex_secret_test";
process.env.IBEX_ACCOUNT_ID = "acct_btc_test";
process.env.IBEX_USDT_ACCOUNT_ID = "acct_usdt_test"; // enables USDT support
process.env.IBEX_WEBHOOK_SECRET = "whsec_ibex_shared_secret";
process.env.IBEX_ALLOW_SANDBOX_PAYOUT = "true";
// A trusted inbound (real payout possible) also requires an https PUBLIC_URL so the
// settlement webhook is deliverable + verifiable (assertIbexConfig enforces it).
process.env.PUBLIC_URL = "https://api.momome.test";
// Sandbox webhook sender IPs (config default): 35.243.242.121, 34.74.236.191.
const ALLOWED_IP = "35.243.242.121";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { ibexAdapter, transactionStatus } = await import("../src/adapters/ibex.js");
  const { ibexConfigured, ibexLive, ibexInboundTrusted, assertIbexConfig } = await import("../src/config.js");
  const SECRET = process.env.IBEX_WEBHOOK_SECRET!;

  console.log("\nIBEX adapter — config + capabilities");
  ok("configured (clientId+secret+account)", ibexConfigured());
  ok("not live in sandbox env", !ibexLive());
  ok("trusted() true with IBEX_ALLOW_SANDBOX_PAYOUT", ibexInboundTrusted() && ibexAdapter.trusted());
  ok("assertIbexConfig passes (secret set for a trusted inbound)", (() => { try { assertIbexConfig(); return true; } catch { return false; } })());
  ok("supports LIGHTNING + ONCHAIN", ibexAdapter.supports("LIGHTNING") && ibexAdapter.supports("ONCHAIN"));
  ok("supports USDT (usdt account configured)", ibexAdapter.supports("USDT"));
  ok("does NOT support USDC (no USDC account)", !ibexAdapter.supports("USDC"));
  ok("priority 0 (base crypto rail)", ibexAdapter.priority === 0);
  ok("name is 'ibex'", ibexAdapter.name === "ibex");

  console.log("\nIBEX adapter — parseEvent (real transaction shapes)");
  // Lightning confirmed via invoice.settleDateUtc; 25,000,000 msat = 0.00025 BTC.
  {
    const ev = ibexAdapter.parseEvent({ transaction: { id: "tx_ln_1", transactionTypeId: 1, invoice: { settleDateUtc: "2026-01-01T00:00:00Z", receiveMsat: 25_000_000 } } });
    ok("LN settleDateUtc → confirmed, providerRef=id", ev?.kind === "confirmed" && ev.providerRef === "tx_ln_1");
    ok("LN amount receiveMsat→BTC", ev?.amount === 0.00025, String(ev?.amount));
  }
  // Lightning confirmed via receiveMsat only (no settleDateUtc).
  {
    const ev = ibexAdapter.parseEvent({ transaction: { id: "tx_ln_2", invoice: { receiveMsat: 100_000 } } });
    ok("LN receiveMsat only → confirmed", ev?.kind === "confirmed" && ev.providerRef === "tx_ln_2" && ev.amount === 0.000001);
  }
  // Lightning detected (status pending, no settle signals).
  {
    const ev = ibexAdapter.parseEvent({ transaction: { id: "tx_ln_3", status: "pending", invoice: {} } });
    ok("LN status=pending → detected", ev?.kind === "detected" && ev.providerRef === "tx_ln_3");
  }
  // Lightning EXPIRED invoice → null (never settle/authorize a payout).
  ok("LN invoice state CANCEL → null", ibexAdapter.parseEvent({ transaction: { id: "tx_ln_4", invoice: { state: { name: "CANCEL" } } } }) === null);
  ok("LN invoice state EXPIRED → null", ibexAdapter.parseEvent({ transaction: { id: "tx_ln_5", invoice: { state: { name: "EXPIRED" } } } }) === null);
  ok("status=failed → null", ibexAdapter.parseEvent({ transaction: { id: "tx_ln_6", status: "failed" } }) === null);
  // On-chain deposit (typeId 7), confirmed → providerRef = address (how the instruction stored it).
  {
    const ev = ibexAdapter.parseEvent({ transaction: { id: "tx_oc_1", transactionTypeId: 7, address: "bc1qexampleaddr", amount: 50_000_000, settledAt: "2026-01-01T00:00:00Z" } });
    ok("on-chain typeId 7 → providerRef=address, confirmed", ev?.providerRef === "bc1qexampleaddr" && ev.kind === "confirmed");
    ok("on-chain amount msat→BTC", ev?.amount === 0.0005, String(ev?.amount));
  }
  // On-chain detected (mempool/pending) → detected, still keyed by address.
  {
    const ev = ibexAdapter.parseEvent({ transaction: { id: "tx_oc_2", transactionTypeId: 7, address: "bc1qpendingaddr", status: "mempool" } });
    ok("on-chain mempool → detected by address", ev?.kind === "detected" && ev.providerRef === "bc1qpendingaddr");
  }
  // Stablecoin (USDT currencyId 29) confirmed → providerRef = 0x address, amount = base units / 1e6.
  {
    const ev = ibexAdapter.parseEvent({ transaction: { id: "tx_usdt_1", currencyId: 29, address: "0xAbC123", amount: 5_000_000, settledAt: "2026-01-01T00:00:00Z" } });
    ok("USDT deposit → providerRef=0x addr, confirmed", ev?.providerRef === "0xAbC123" && ev.kind === "confirmed");
    ok("USDT amount base-units→USDT (÷1e6)", ev?.amount === 5, String(ev?.amount));
  }
  ok("no transaction → null", ibexAdapter.parseEvent({}) === null);
  ok("no providerRef (no id/addr) → null", ibexAdapter.parseEvent({ transaction: { invoice: { receiveMsat: 1000 } } }) === null);

  console.log("\nIBEX adapter — verifyWebhook (shared secret + sender-IP allowlist)");
  const goodBody = JSON.stringify({ secret: SECRET, transaction: { id: "tx_ln_1" } });
  ok("correct secret + allowed IP → accepted", ibexAdapter.verifyWebhook(goodBody, { "x-forwarded-for": ALLOWED_IP }));
  ok("correct secret + no IP header → accepted (secret gates)", ibexAdapter.verifyWebhook(goodBody, {}));
  // Called WITHOUT a resolved req.ip, so the allowlist cannot be enforced from a
  // caller-supplied header — the secret gates instead. Over HTTP the route passes req.ip
  // and this exact chain is REJECTED; see ibex-e2e.test.ts ("allowlisted IP PREPENDED").
  ok("correct secret, no resolved sender → accepted (secret gates)", ibexAdapter.verifyWebhook(goodBody, { "x-forwarded-for": `${ALLOWED_IP}, 10.0.0.1` }));
  ok("resolved sender NOT on the allowlist → rejected", ibexAdapter.verifyWebhook(goodBody, {}, "10.0.0.1") === false);
  ok("resolved sender ON the allowlist → accepted", ibexAdapter.verifyWebhook(goodBody, {}, ALLOWED_IP) === true);
  ok("wrong secret → rejected", !ibexAdapter.verifyWebhook(JSON.stringify({ secret: "nope", transaction: {} }), { "x-forwarded-for": ALLOWED_IP }));
  ok("missing secret → rejected", !ibexAdapter.verifyWebhook(JSON.stringify({ transaction: {} }), { "x-forwarded-for": ALLOWED_IP }));
  ok("disallowed sender IP → rejected (even with correct secret)", !ibexAdapter.verifyWebhook(goodBody, { "x-forwarded-for": "1.2.3.4" }));
  ok("malformed JSON body → rejected", !ibexAdapter.verifyWebhook("{not json", { "x-forwarded-for": ALLOWED_IP }));

  console.log("\nIBEX adapter — network paths (mocked fetch)");
  const origFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL) => {
    const u = String(url);
    if (u.includes("/oauth/token")) return new Response(JSON.stringify({ access_token: "tok_123", expires_in: 3600 }), { status: 200 });
    if (u.endsWith("/invoice/add")) return new Response(JSON.stringify({ transactionId: "tx_ln_new", bolt11: "lnbc1pxyz", hash: "hh" }), { status: 200 });
    if (u.endsWith("/onchain/address")) return new Response(JSON.stringify({ address: "bc1qfreshaddr" }), { status: 200 });
    if (u.includes("/v2/transaction/tx_paid")) return new Response(JSON.stringify({ invoice: { receiveMsat: 25_000_000, settleDateUtc: "2026-01-01T00:00:00Z" } }), { status: 200 });
    if (u.includes("/v2/transaction/tx_expired")) return new Response(JSON.stringify({ invoice: { state: { name: "CANCEL" } } }), { status: 200 });
    if (u.includes("/v2/transaction/tx_404")) return new Response("not found", { status: 404 });
    return new Response(`unexpected ${u}`, { status: 500 });
  }) as typeof fetch;

  try {
    const ln = await ibexAdapter.createInstruction({ method: "LIGHTNING", ref: "MMM-REF-1", amount: 0.00025, callbackUrl: "https://x/webhooks/ibex" });
    ok("createInstruction LIGHTNING → bolt11 code", ln.code === "lnbc1pxyz" && ln.method === "LIGHTNING");
    ok("LN qr uses lightning: URI", ln.qr === "lightning:lnbc1pxyz");
    ok("LN providerRef = transactionId, provider=ibex", ln.providerRef === "tx_ln_new" && ln.provider === "ibex");
    ok("LN expiresAt is a future ISO", !Number.isNaN(Date.parse(ln.expiresAt)) && Date.parse(ln.expiresAt) > Date.now());

    const oc = await ibexAdapter.createInstruction({ method: "ONCHAIN", ref: "MMM-REF-2", amount: 0.01, callbackUrl: "https://x/webhooks/ibex" });
    ok("createInstruction ONCHAIN → address code", oc.code === "bc1qfreshaddr" && oc.method === "ONCHAIN");
    ok("ONCHAIN qr uses bitcoin: URI with amount", oc.qr === "bitcoin:bc1qfreshaddr?amount=0.01000000");
    ok("ONCHAIN providerRef = address (matches on-chain webhook)", oc.providerRef === "bc1qfreshaddr");

    const paid = await transactionStatus("tx_paid");
    ok("transactionStatus paid → settled", paid?.settled === true && paid.failed === false);
    const expired = await transactionStatus("tx_expired");
    ok("transactionStatus CANCEL → failed, not settled", expired?.settled === false && expired.failed === true);
    ok("transactionStatus lookup 404 → null (indeterminate)", (await transactionStatus("tx_404")) === null);
    ok("confirmSettlement delegates to transactionStatus", (await ibexAdapter.confirmSettlement!("tx_paid"))?.settled === true);
  } finally {
    globalThis.fetch = origFetch;
  }

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
