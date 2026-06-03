/* ============================================================
   Lightning end-to-end test suite.
   Part A: full HTTP route flow in sandbox mode (quote → payment →
           confirm → settle → ledger → idempotency → activity).
   Part B: live IBEX Lightning path with fetch mocked
           (auth → add-invoice → signed webhook → settle), plus the
           underpayment guard and webhook idempotency.
   Run: pnpm --filter @momome/server test:ln
   ============================================================ */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";

// Env must be set before any module that reads config is imported → dynamic imports.
process.env.DB_PATH = ":memory:"; // isolated, fresh DB per test run
process.env.RAILS_MODE = "sandbox";
// IBEX Hub: set the (mock) URLs + account/webhook secret, but NOT client_id/secret,
// so ibexConfigured() stays false → Part A runs pure-sandbox, while Part B exercises
// the IBEX adapter directly against mocked fetch.
process.env.IBEX_ENV = "sandbox";
process.env.IBEX_API_URL = "https://ibexhub.test";
process.env.IBEX_AUTH_URL = "https://auth.test/oauth/token";
process.env.IBEX_ACCOUNT_ID = "acct_test";
process.env.IBEX_WEBHOOK_SECRET = "whsec_test";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { createApp } = await import("../src/app.js");

  /* ---------------- Part A — HTTP route flow (sandbox) ---------------- */
  console.log("\nPart A — Lightning HTTP flow (sandbox)");
  const app = createApp();
  const server = app.listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://localhost:${(server.address() as AddressInfo).port}`;
  const J = (p: string, init?: RequestInit) => fetch(base + p, init).then(async (r) => ({ status: r.status, body: await r.json() }));
  const POST = (p: string, body?: unknown) => J(p, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });

  try {
    const health = await J("/health");
    ok("health reports sandbox rails", health.body.railsMode === "sandbox");

    // 1. quote
    const q = await POST("/api/quotes", { xaf: 50000, method: "LIGHTNING", country: "CM" });
    ok("quote 200", q.status === 200);
    ok("quote asset is BTC", q.body.inboundAsset === "BTC");
    ok("quote spread is Lightning (150bps)", q.body.spreadBps === 150, `${q.body.spreadBps}bps`);
    ok("quote is firm (not estimate)", q.body.estimateOnly === false);
    ok("quote inbound amount > 0", q.body.inboundAmount > 0, q.body.inboundAmountLabel);
    ok("quote label is BTC", /BTC$/.test(q.body.inboundAmountLabel));
    ok("quote totals", q.body.feeXaf === 1250 && q.body.totalXaf === 51250);
    const ttl = Date.parse(q.body.expiresAt) - Date.parse(q.body.issuedAt);
    ok("quote TTL ≈ 90s", Math.abs(ttl - 90_000) < 1500, `${ttl}ms`);

    // 2. create payment
    const recipient = { phone: "6 70 12 34 56", country: "CM", provider: "MTN", name: "NANA JEAN PAUL", nameSource: "provider" };
    const p = await POST("/api/payments", { quoteId: q.body.id, recipient });
    ok("payment 200", p.status === 200);
    ok("payment awaits inbound", p.body.state === "AWAITING_INBOUND");
    const inst = p.body.payInstruction;
    ok("instruction is Lightning", inst.method === "LIGHTNING");
    ok("invoice is a bolt11 (lnbc…)", typeof inst.code === "string" && inst.code.startsWith("lnbc"), inst.code.slice(0, 12) + "…");
    ok("QR is uppercased bolt11 (LNBC…)", inst.qr.startsWith("LNBC"));
    ok("instruction amount == quote inbound (locked)", inst.amount === q.body.inboundAmount);
    ok("providerRef present (LN payment hash)", typeof inst.providerRef === "string" && inst.providerRef.length === 64);
    ok("provider is sandbox", inst.provider === "sandbox");
    const pid = p.body.id;

    // 3. confirm → poll to DELIVERED
    await POST(`/api/payments/${pid}/confirm`);
    let final: any = null;
    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 250));
      const cur = await J(`/api/payments/${pid}`);
      if (cur.body.state === "DELIVERED") { final = cur.body; break; }
    }
    ok("payment reaches DELIVERED", final?.state === "DELIVERED");
    ok("display status Completed", final?.displayStatus === "Completed");

    // event order = the fast (non-onchain) settlement sequence
    const seq = final.events.map((e: any) => e.state);
    const expectedSeq = ["QUOTED", "AWAITING_INBOUND", "INBOUND_DETECTED", "INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED"];
    ok("settlement event order is correct", JSON.stringify(seq) === JSON.stringify(expectedSeq), seq.join("→"));

    // 4. ledger balanced
    const led = await J(`/api/ledger/${pid}`);
    const nets: Record<string, number> = {};
    for (const e of led.body) nets[e.currency] = (nets[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount);
    ok("ledger BTC nets to 0", Math.abs(nets.BTC) < 1e-9);
    ok("ledger XAF nets to 0", Math.abs(nets.XAF) < 1e-9);
    const accounts = new Set(led.body.map((e: any) => e.account));
    ok("ledger touched all expected accounts", ["inbound_clearing", "customer_wallet", "fx_position", "payout_float_XAF", "fee_revenue", "external_recipient"].every((a) => accounts.has(a)));

    // 5. idempotent confirm
    const before = final.events.length;
    await POST(`/api/payments/${pid}/confirm`);
    const after = await J(`/api/payments/${pid}`);
    ok("re-confirm does not re-settle", after.body.events.length === before && after.body.state === "DELIVERED");

    // 6. activity feed includes it
    const list = await J("/api/payments");
    ok("payment appears in activity as Completed", list.body.some((x: any) => x.id === pid && x.displayStatus === "Completed"));
  } finally {
    server.close();
  }

  /* ---------------- Part B — live IBEX Lightning (fetch mocked) ---------------- */
  console.log("\nPart B — live IBEX Lightning path (fetch mocked)");
  const { ibexAdapter } = await import("../src/adapters/ibex.js");
  const storeMod = await import("../src/core/store.js");
  const { confirmInbound } = await import("../src/core/stateMachine.js");
  const { entriesFor } = await import("../src/core/ledger.js");

  const realFetch = globalThis.fetch;
  let sentInvoiceBody: any = null;
  let sentOnchainBody: any = null;
  const BTC_IN = 0.00130414;
  const MSAT = Math.round(BTC_IN * 1e11);
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (u.endsWith("/oauth/token")) {
      return new Response(JSON.stringify({ access_token: "at_live", token_type: "Bearer", expires_in: 3600 }), { status: 200 });
    }
    if (u.endsWith("/invoice/add")) {
      sentInvoiceBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ transactionId: "tx_live_001", bolt11: "lnbc1304140n1pjmocked", hash: "h_live_001", expirationUtc: 1780000000 }), { status: 201 });
    }
    if (u.endsWith("/onchain/address")) {
      sentOnchainBody = JSON.parse(init.body);
      return new Response(JSON.stringify({ address: "bc1qtestaddr0000" }), { status: 200 });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;

  try {
    // 1. Lightning: OAuth → /invoice/add with amountMsat + memo → bolt11
    const li = await ibexAdapter.createInstruction({ method: "LIGHTNING", ref: "MMM-2026-LIVE", amount: BTC_IN, callbackUrl: "https://app.test/webhooks/ibex" });
    ok("IBEX invoice amount sent in MSAT", sentInvoiceBody.amountMsat === MSAT, `${sentInvoiceBody.amountMsat} msat`);
    ok("IBEX invoice accountId sent", sentInvoiceBody.accountId === "acct_test");
    ok("IBEX invoice memo == payment ref", sentInvoiceBody.memo === "MMM-2026-LIVE");
    ok("IBEX webhook url forwarded", sentInvoiceBody.webhookUrl === "https://app.test/webhooks/ibex");
    ok("IBEX per-invoice webhook secret forwarded", sentInvoiceBody.webhookSecret === "whsec_test");
    ok("instruction code is the bolt11", li.code === "lnbc1304140n1pjmocked");
    ok("instruction QR is uppercased bolt11", li.qr === "LNBC1304140N1PJMOCKED");
    ok("instruction providerRef is the transaction id", li.providerRef === "tx_live_001");
    ok("instruction asset BTC, amount preserved", li.asset === "BTC" && li.amount === BTC_IN);

    // 1b. On-chain BTC: fresh address from /onchain/address
    const oi = await ibexAdapter.createInstruction({ method: "ONCHAIN", ref: "MMM-2026-ONCHAIN", amount: BTC_IN, callbackUrl: "https://app.test/webhooks/ibex" });
    ok("IBEX onchain accountId sent", sentOnchainBody.accountId === "acct_test");
    ok("onchain instruction is the address", oi.code === "bc1qtestaddr0000" && oi.asset === "BTC");
    ok("onchain QR is a bitcoin: URI", oi.qr.startsWith("bitcoin:bc1qtestaddr0000"));
    ok("onchain providerRef is the address", oi.providerRef === "bc1qtestaddr0000");
    // USDT is NOT an IBEX rail (gated per-org) — the sandbox adapter simulates it
    ok("IBEX supports LIGHTNING + ONCHAIN", ibexAdapter.supports("LIGHTNING") && ibexAdapter.supports("ONCHAIN"));
    ok("IBEX does NOT advertise USDT", !ibexAdapter.supports("USDT"));

    // 2. webhook auth — IBEX Hub echoes the per-invoice secret in the body
    const now0 = new Date().toISOString();
    const goodBody = JSON.stringify({ transaction: { id: "tx_live_001", status: "SETTLED", settledAt: now0, amount: BTC_IN }, secret: "whsec_test" });
    ok("valid webhook secret accepted", ibexAdapter.verifyWebhook(goodBody, {}));
    ok("wrong webhook secret rejected", !ibexAdapter.verifyWebhook(JSON.stringify({ transaction: { id: "tx_live_001" }, secret: "nope" }), {}));
    ok("missing webhook secret rejected", !ibexAdapter.verifyWebhook(JSON.stringify({ transaction: { id: "tx_live_001" } }), {}));

    // 3. parse settled event (transaction → confirmed, amount in BTC)
    const ev = ibexAdapter.parseEvent(JSON.parse(goodBody))!;
    ok("event parsed as confirmed", ev.kind === "confirmed");
    ok("event providerRef is the transaction id", ev.providerRef === "tx_live_001");
    ok("event amount is the settled BTC amount", Math.abs(ev.amount! - BTC_IN) < 1e-9);

    // helper to seed an AWAITING payment with a locked instruction
    const seedPayment = (id: string, providerRef: string, amount: number) => {
      const now = new Date().toISOString();
      const pay: any = {
        id, ref: id, quoteId: "q", state: "AWAITING_INBOUND", displayStatus: "Pending", method: "LIGHTNING",
        recipient: { phone: "6 70 12 34 56", country: "CM", provider: "MTN", name: "NANA JEAN PAUL", nameSource: "provider" },
        xaf: 50000, feeXaf: 1250, totalXaf: 51250, usd: 84.3,
        payInstruction: { method: "LIGHTNING", code: "lnbc", qr: "LNBC", asset: "BTC", amount, amountLabel: "", expiresAt: now, providerRef, provider: "ibex" },
        events: [{ at: now, state: "AWAITING_INBOUND" }], createdAt: now, updatedAt: now,
      };
      storeMod.putPayment(pay); storeMod.indexProviderRef(providerRef, id);
      return pay;
    };

    // 4. happy webhook → match → settle → balanced
    seedPayment("pay_live_ok", "tx_live_001", BTC_IN);
    const matched = storeMod.findByProviderRef(ev.providerRef)!;
    ok("webhook matches the payment by providerRef", matched.id === "pay_live_ok");
    await confirmInbound(matched, ev.amount);
    const okPay = storeMod.getPayment("pay_live_ok")!;
    ok("live LN payment DELIVERED", okPay.state === "DELIVERED");
    const n: Record<string, number> = {};
    for (const e of entriesFor("pay_live_ok")) n[e.currency] = (n[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount);
    ok("live LN ledger balanced", Math.abs(n.BTC) < 1e-9 && Math.abs(n.XAF) < 1e-9);

    // 5. underpayment guard uses the LOCKED amount (the bug we fixed)
    seedPayment("pay_live_short", "h_short", BTC_IN);
    await confirmInbound(storeMod.findByProviderRef("h_short")!, BTC_IN * 0.7);
    ok("30%-short inbound → MANUAL_REVIEW", storeMod.getPayment("pay_live_short")!.state === "MANUAL_REVIEW");

    // 5b. a CORRECT payment never trips the guard even though spot drifts over time
    seedPayment("pay_live_exact", "h_exact", BTC_IN);
    await confirmInbound(storeMod.findByProviderRef("h_exact")!, BTC_IN); // exactly the locked amount
    ok("exact locked amount settles (no false underpay)", storeMod.getPayment("pay_live_exact")!.state === "DELIVERED");

    // 6. webhook idempotency
    const evCount = storeMod.getPayment("pay_live_ok")!.events.length;
    await confirmInbound(storeMod.findByProviderRef("tx_live_001")!, ev.amount);
    ok("replayed webhook does not double-settle", storeMod.getPayment("pay_live_ok")!.events.length === evCount);

    // 7. confirmed inbound with NO amount is untrusted → MANUAL_REVIEW (not auto-paid)
    seedPayment("pay_live_noamt", "h_noamt", BTC_IN);
    await confirmInbound(storeMod.findByProviderRef("h_noamt")!, undefined);
    ok("missing inbound amount → MANUAL_REVIEW", storeMod.getPayment("pay_live_noamt")!.state === "MANUAL_REVIEW");

    /* ---- Part C — admin retry / refund correctness (review fixes) ---- */
    console.log("\nPart C — refund & retry ledger correctness");
    const { adminRetry, adminRefund, onPayoutResult } = await import("../src/core/stateMachine.js");
    const nets = (id: string) => { const m: Record<string, number> = {}; for (const e of entriesFor(id)) m[e.currency] = (m[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount); return m; };

    // Refund a settled (but here treated as undelivered) payment → ledger nets to zero.
    seedPayment("pay_refund", "h_refund", BTC_IN);
    await confirmInbound(storeMod.findByProviderRef("h_refund")!, BTC_IN);
    storeMod.getPayment("pay_refund")!.displayStatus = "Pending"; // make it refundable
    adminRefund(storeMod.getPayment("pay_refund")!);
    const rn = nets("pay_refund");
    ok("refund reverses ledger to zero (no float overstatement)", Math.abs(rn.BTC ?? 0) < 1e-9 && Math.abs(rn.XAF ?? 0) < 1e-9);
    ok("refunded payment is REFUNDED", storeMod.getPayment("pay_refund")!.state === "REFUNDED");

    // Retry a MANUAL_REVIEW payment → delivered, ledger balanced, NO double-pay.
    seedPayment("pay_retry", "h_retry", BTC_IN);
    storeMod.getPayment("pay_retry")!.state = "MANUAL_REVIEW";
    storeMod.getPayment("pay_retry")!.displayStatus = "Pending";
    await adminRetry(storeMod.getPayment("pay_retry")!);
    ok("retry delivers the payment", storeMod.getPayment("pay_retry")!.state === "DELIVERED");
    const yn = nets("pay_retry");
    ok("retry posts a balanced payout leg", Math.abs(yn.XAF ?? 0) < 1e-9);
    const ppMod = await import("../src/adapters/pawapay.js");
    const firstRef = ppMod.statusByKey("pay_retry")?.providerRef;
    await adminRetry(storeMod.getPayment("pay_retry")!); // idempotent: Completed → returns false
    ok("retry is exactly-once (no second disbursement)", ppMod.statusByKey("pay_retry")?.providerRef === firstRef);

    /* ---- Part D — Mobile Money rail: async payout, failure→refund, guards ---- */
    console.log("\nPart D — Mobile Money payout (callback, failure, limits)");

    // Payout callback FAILED → auto-refund, ledger nets to zero.
    seedPayment("pay_mmfail", "h_mmfail", BTC_IN);
    storeMod.getPayment("pay_mmfail")!.state = "PAYOUT_REQUESTED"; // awaiting the callback
    await onPayoutResult("pay_mmfail", "FAILED");
    ok("failed payout → REFUNDED", storeMod.getPayment("pay_mmfail")!.state === "REFUNDED");
    const fn = nets("pay_mmfail");
    ok("failed payout refund balances ledger", Math.abs(fn.BTC ?? 0) < 1e-9 && Math.abs(fn.XAF ?? 0) < 1e-9);

    // onPayoutResult is idempotent — a duplicate COMPLETED on a delivered payment is a no-op.
    const okEvents = storeMod.getPayment("pay_live_ok")!.events.length;
    await onPayoutResult("pay_live_ok", "COMPLETED");
    ok("duplicate payout callback is ignored", storeMod.getPayment("pay_live_ok")!.events.length === okEvents);

    // Corridor limit: a payout above the provider cap → MANUAL_REVIEW (not paid).
    const big: any = { id: "pay_big", ref: "pay_big", quoteId: "q", state: "AWAITING_INBOUND", displayStatus: "Pending", method: "LIGHTNING",
      recipient: { phone: "6 70 12 34 56", country: "CM", provider: "AIRTEL", name: "X", nameSource: "provider" },
      xaf: 800_000, feeXaf: 20_000, totalXaf: 820_000, usd: 1350,
      payInstruction: { method: "LIGHTNING", code: "lnbc", qr: "LNBC", asset: "BTC", amount: BTC_IN, amountLabel: "", expiresAt: new Date().toISOString(), providerRef: "h_big", provider: "ibex" },
      events: [{ at: new Date().toISOString(), state: "AWAITING_INBOUND" }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    storeMod.putPayment(big); storeMod.indexProviderRef("h_big", "pay_big");
    await confirmInbound(storeMod.findByProviderRef("h_big")!, BTC_IN); // 800k > AIRTEL cap 500k
    ok("over-cap payout → MANUAL_REVIEW (not paid)", storeMod.getPayment("pay_big")!.state === "MANUAL_REVIEW");

    /* ---- Part E — Merchant Identity Graph (MOMOMI) ---- */
    console.log("\nPart E — Merchant Identity Graph");
    const mig = await import("../src/core/merchant.js");
    const routing = await import("../src/core/routing.js");

    ok("classify: MOMO-code → merchant_code", mig.classify("MOMO-1234").type === "merchant_code");
    ok("classify: digits → phone", mig.classify("6 70 12 34 56").type === "phone");
    ok("classify: momomi: URI → resolves inner code", mig.classify("momomi:MOMO-1234").type === "merchant_code");

    // Resolve a brand-new merchant code → PENDING (needs confirmation), then admin-validate.
    const r1 = await mig.resolveMerchant("MOMO-TEST-1");
    ok("unknown code → pending, needs confirmation", r1.merchant!.status === "pending" && r1.needsConfirmation);
    const validated = mig.validateMerchant(r1.merchant!.internalId, "TEST SHOP")!;
    ok("admin validate → active, trust ≥ 0.9, admin-verified", validated.status === "active" && validated.trustScore >= 0.9 && validated.verificationSource === "admin");
    const r2 = await mig.resolveMerchant("MOMO-TEST-1");
    ok("second lookup of same code now resolves instantly", r2.resolved && r2.merchant!.internalId === validated.internalId);

    // Learning: a successful payout raises trust + attaches the code↔phone mapping.
    const before = mig.resolveMerchant("699000111");
    const learned = mig.recordSuccessfulPayout({ phone: "699000111", name: "BOULANGERIE X", provider: "MTN", country: "CM", merchantCode: "MOMO-BX" });
    ok("learning links code↔phone and raises trust", learned.merchantCode === "MOMO-BX" && learned.phone === "699000111" && learned.txCount === 1);
    ok("learned merchant has both lightning addresses", learned.lightningAddresses.some((a) => a.startsWith("momo-bx@")) && learned.lightningAddresses.some((a) => /@momomi\.io$/.test(a)));
    void before;

    // Routing: invisible aggregator selection per provider (health being equal).
    ok("Orange routes to Peexit (preferred)", routing.selectAggregator("ORANGE").name === "peexit");
    ok("MTN routes to PawaPay", routing.selectAggregator("MTN").name === "pawapay");

    // Health-aware failover: take Peexit down → Orange must route to PawaPay.
    routing.setAggregatorUp("peexit", false);
    ok("Orange fails over to PawaPay when Peexit is down", routing.selectAggregator("ORANGE").name === "pawapay");
    routing.setAggregatorUp("peexit", true);
    ok("Orange returns to Peexit once healthy", routing.selectAggregator("ORANGE").name === "peexit");

    // Execution log feeds the snapshot.
    routing.recordExecution({ at: new Date().toISOString(), aggregator: "pawapay", ref: "X1", provider: "MTN", status: "COMPLETED", latencyMs: 120 });
    const snap = routing.routingSnapshot();
    ok("routing snapshot reports aggregator health", snap.aggregators.some((a: any) => a.name === "pawapay" && a.count >= 1));

    // Trust gate: a flagged merchant's number is blocked from auto-payout.
    const flaggedM = mig.recordSuccessfulPayout({ phone: "655777888", name: "RISKY", provider: "MTN", country: "CM" });
    mig.flagMerchant(flaggedM.internalId);
    ok("flagged merchant → payout blocked (manual review)", mig.payoutBlocked("655777888") === true);
    ok("healthy merchant → payout not blocked", mig.payoutBlocked("682410933") === false);

    // Merge two duplicates into one.
    const a = mig.recordSuccessfulPayout({ phone: "655111222", name: "DUP A", provider: "MTN", country: "CM" });
    const b = mig.recordSuccessfulPayout({ phone: "655111999", name: "DUP B", provider: "MTN", country: "CM", merchantCode: "MOMO-DUP" });
    const merged = mig.mergeMerchants(a.internalId, b.internalId)!;
    ok("merge combines code + tx counts and removes the duplicate", merged.merchantCode === "MOMO-DUP" && merged.txCount === 2 && !mig.getMerchant(b.internalId));
  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n✅ Lightning E2E: ${passed} assertions passed\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("\n❌", e.message); process.exit(1); });
