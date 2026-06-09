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
  // Every call carries an anonymous sender id so sender-scoped reads (GET /payments) work.
  const J = (p: string, init?: RequestInit) => fetch(base + p, { ...init, headers: { "x-mm-sender": "e2e-sender", ...(init?.headers ?? {}) } }).then(async (r) => ({ status: r.status, body: await r.json() }));
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
    ok("quote TTL ≈ 600s (10 min — long enough to actually pay)", Math.abs(ttl - 600_000) < 1500, `${ttl}ms`);

    // 2. create payment
    const recipient = { phone: "6 70 12 34 56", country: "CM", provider: "MTN", name: "NANA JEAN PAUL", nameSource: "provider" };
    const p = await POST("/api/payments", { quoteId: q.body.id, recipient });
    ok("payment 200", p.status === 200);
    ok("payment awaits inbound", p.body.state === "AWAITING_INBOUND");
    const inst = p.body.payInstruction;
    ok("instruction is Lightning", inst.method === "LIGHTNING");
    ok("invoice is a bolt11 (lnbc…)", typeof inst.code === "string" && inst.code.startsWith("lnbc"), inst.code.slice(0, 12) + "…");
    ok("QR is a lightning: BOLT11 URI", inst.qr.startsWith("lightning:lnbc"));
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

    // Security: IDOR — another sender (or anonymous) can't read someone's payment
    // or ledger by id; the owner can. 404 (not 403) so the id space can't be probed.
    const idorPay = await J(`/api/payments/${pid}`, { headers: { "x-mm-sender": "not-the-owner" } });
    ok("IDOR: foreign sender can't read a payment → 404", idorPay.status === 404);
    const idorLed = await J(`/api/ledger/${pid}`, { headers: { "x-mm-sender": "not-the-owner" } });
    ok("IDOR: foreign sender can't read a ledger → 404", idorLed.status === 404);
    const ownerPay = await J(`/api/payments/${pid}`);
    ok("owner can still read their own payment → 200", ownerPay.status === 200);

    // Security: a locked quote is single-use — replaying it into a second payment fails.
    const sq = await POST("/api/quotes", { xaf: 10000, method: "LIGHTNING", country: "CM" });
    const sp1 = await POST("/api/payments", { quoteId: sq.body.id, recipient });
    const sp2 = await POST("/api/payments", { quoteId: sq.body.id, recipient });
    ok("quote is single-use (replay → 404)", sp1.status === 200 && sp2.status === 404);

    // 5. idempotent confirm
    const before = final.events.length;
    await POST(`/api/payments/${pid}/confirm`);
    const after = await J(`/api/payments/${pid}`);
    ok("re-confirm does not re-settle", after.body.events.length === before && after.body.state === "DELIVERED");

    // 6. activity feed includes it — and is SENDER-SCOPED (another device sees nothing)
    const list = await J("/api/payments");
    ok("payment appears in activity as Completed", list.body.some((x: any) => x.id === pid && x.displayStatus === "Completed"));
    const otherSender = await J("/api/payments", { headers: { "x-mm-sender": "someone-else" } });
    ok("activity is sender-scoped (another device sees none of it)", Array.isArray(otherSender.body) && !otherSender.body.some((x: any) => x.id === pid));
    const recents = await J("/api/me/recipients");
    ok("recent recipients lists the sender's recipient(s)", Array.isArray(recents.body) && recents.body.length >= 1 && !!recents.body[0].phone);

    // 7. admin login guard + operational settings (HTTP, live server)
    const auth = (tok: string, init?: RequestInit): RequestInit => ({ ...init, headers: { "content-type": "application/json", authorization: `Bearer ${tok}`, ...(init?.headers ?? {}) } });
    const noTok = await J("/api/admin/overview");
    ok("admin API without token → 401", noTok.status === 401);
    const badLogin = await POST("/api/admin/login", { username: "admin", password: "wrong" });
    ok("login with wrong password → 401", badLogin.status === 401);
    const goodLogin = await POST("/api/admin/login", { username: "admin", password: "momome-admin" }); // seeded Super Admin
    ok("login with correct credentials → token", goodLogin.status === 200 && typeof goodLogin.body.token === "string");
    ok("login returns the user with role", goodLogin.body.user?.username === "admin" && goodLogin.body.user?.role === "Super Admin");
    const tok = goodLogin.body.token as string;
    const withTok = await J("/api/admin/overview", auth(tok));
    ok("admin API with valid token → 200", withTok.status === 200);
    const forged = await J("/api/admin/overview", auth(tok.slice(0, -2) + "xx"));
    ok("tampered token → 401", forged.status === 401);
    const sess = await J("/api/admin/session", auth(tok));
    ok("session reports authenticated + user", sess.body.authenticated === true && sess.body.user?.role === "Super Admin");

    // Revenue intelligence: gross = fee + spread; the delivered Lightning payment is counted, with non-zero spread.
    const rev = await J("/api/admin/revenue?period=all", auth(tok));
    ok("revenue gross = fee + spread", rev.status === 200 && rev.body.grossRevenueXaf === rev.body.feeRevenueXaf + rev.body.spreadRevenueXaf);
    ok("revenue books the FX spread (was invisible)", rev.body.payments >= 1 && rev.body.spreadRevenueXaf > 0);
    ok("revenue nets out costs", rev.body.netRevenueXaf === rev.body.grossRevenueXaf - rev.body.costsXaf && Array.isArray(rev.body.insights));

    // 7b. Per-user accounts + RBAC enforcement
    const mkSupport = await J("/api/admin/users", auth(tok, { method: "POST", body: JSON.stringify({ username: "agent1", password: "support-pass", role: "Support Agent" }) }));
    ok("super admin creates a user → 201", mkSupport.status === 201 && mkSupport.body.user?.username === "agent1");
    const dupe = await J("/api/admin/users", auth(tok, { method: "POST", body: JSON.stringify({ username: "agent1", password: "support-pass", role: "Support Agent" }) }));
    ok("duplicate username → 409", dupe.status === 409);
    const weak = await J("/api/admin/users", auth(tok, { method: "POST", body: JSON.stringify({ username: "agent2", password: "short", role: "Support Agent" }) }));
    ok("weak password rejected → 400", weak.status === 400);

    const agentLogin = await POST("/api/admin/login", { username: "agent1", password: "support-pass" });
    ok("new user can sign in", agentLogin.status === 200);
    const agentTok = agentLogin.body.token as string;
    // Support Agent can read payments (in remit) but not liquidity (out of remit).
    const agentPayments = await J("/api/admin/payments", auth(agentTok));
    ok("support agent reads payments (in remit) → 200", agentPayments.status === 200);
    const agentLiquidity = await J("/api/admin/liquidity", auth(agentTok));
    ok("support agent blocked from liquidity → 403", agentLiquidity.status === 403);
    // Fail-closed section gate: revenue (finance data) is denied to Support Agents.
    const agentRevenue = await J("/api/admin/revenue", auth(agentTok));
    ok("support agent blocked from revenue (fail-closed) → 403", agentRevenue.status === 403);
    // Support Agent cannot manage users.
    const agentUsers = await J("/api/admin/users", auth(agentTok));
    ok("support agent blocked from user admin → 403", agentUsers.status === 403);

    // Money-movement RBAC: a Support Agent can VIEW payments but must never
    // retry a payout or issue a refund (those move funds).
    const somePid = Array.isArray(agentPayments.body) && agentPayments.body[0]?.id;
    if (somePid) {
      const agentRetry = await J(`/api/admin/payments/${somePid}/retry`, auth(agentTok, { method: "POST" }));
      ok("support agent blocked from retry → 403", agentRetry.status === 403);
      const agentRefund = await J(`/api/admin/payments/${somePid}/refund`, auth(agentTok, { method: "POST" }));
      ok("support agent blocked from refund → 403", agentRefund.status === 403);
      // An Operations Manager may move funds — authorized (not 403, even if the
      // action itself no-ops on an already-delivered payment).
      await J("/api/admin/users", auth(tok, { method: "POST", body: JSON.stringify({ username: "ops1", password: "ops-pass-123", role: "Operations Manager" }) }));
      const opsLogin = await POST("/api/admin/login", { username: "ops1", password: "ops-pass-123" });
      const opsRetry = await J(`/api/admin/payments/${somePid}/retry`, auth(opsLogin.body.token as string, { method: "POST" }));
      ok("operations manager allowed to move funds (not 403)", opsRetry.status !== 403);
    }

    // change-own-password: wrong current rejected, correct accepted, old password then fails.
    const badChange = await J("/api/admin/password", auth(agentTok, { method: "POST", body: JSON.stringify({ currentPassword: "nope", newPassword: "newsupportpass" }) }));
    ok("change password with wrong current → 401", badChange.status === 401);
    const goodChange = await J("/api/admin/password", auth(agentTok, { method: "POST", body: JSON.stringify({ currentPassword: "support-pass", newPassword: "newsupportpass" }) }));
    ok("change own password → 200", goodChange.status === 200);
    const oldFails = await POST("/api/admin/login", { username: "agent1", password: "support-pass" });
    ok("old password no longer works → 401", oldFails.status === 401);
    const newWorks = await POST("/api/admin/login", { username: "agent1", password: "newsupportpass" });
    ok("new password works", newWorks.status === 200);

    // forgot-password: master recovery key (ADMIN_PASSWORD) resets any account.
    const badRecover = await POST("/api/admin/forgot", { username: "agent1", recoveryKey: "wrong", newPassword: "recovered-pass" });
    ok("forgot with bad recovery key → 401", badRecover.status === 401);
    const recover = await POST("/api/admin/forgot", { username: "agent1", recoveryKey: "momome-admin", newPassword: "recovered-pass" });
    ok("forgot with master key resets password → 200", recover.status === 200);
    const recoveredLogin = await POST("/api/admin/login", { username: "agent1", password: "recovered-pass" });
    ok("login with recovered password works", recoveredLogin.status === 200);

    // delete the agent (super admin); last-super-admin protection.
    const agentId = mkSupport.body.user.id as string;
    const del = await J(`/api/admin/users/${agentId}`, auth(tok, { method: "DELETE" }));
    ok("super admin deletes a user → 200", del.status === 200);
    const selfDemote = await J(`/api/admin/users/${goodLogin.body.user.id}`, auth(tok, { method: "PUT", body: JSON.stringify({ role: "Read Only" }) }));
    ok("last super admin can't be demoted → 409", selfDemote.status === 409);

    // Kill-switch: pausing payments refuses new quotes; re-enabling restores them.
    const pause = await J("/api/admin/settings", auth(tok, { method: "PUT", body: JSON.stringify({ ops: { acceptingPayments: false } }) }));
    ok("pause payments persists", pause.status === 200 && pause.body.ops.acceptingPayments === false);
    const qPaused = await POST("/api/quotes", { xaf: 50000, method: "LIGHTNING", country: "CM" });
    ok("quotes refused while paused → 503", qPaused.status === 503);
    const resume = await J("/api/admin/settings", auth(tok, { method: "PUT", body: JSON.stringify({ ops: { acceptingPayments: true } }) }));
    ok("resume payments persists", resume.status === 200 && resume.body.ops.acceptingPayments === true);
    const qResumed = await POST("/api/quotes", { xaf: 50000, method: "LIGHTNING", country: "CM" });
    ok("quotes accepted after resume → 200", qResumed.status === 200);

    // Approval-threshold validation guards bad input.
    const badThresh = await J("/api/admin/settings", auth(tok, { method: "PUT", body: JSON.stringify({ ops: { payoutApprovalXaf: 99_999_999 } }) }));
    ok("out-of-range approval threshold → 400", badThresh.status === 400);

    // Brand logo: a valid data URL persists + surfaces on public /config; junk is rejected.
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const setLogo = await J("/api/admin/settings", auth(tok, { method: "PUT", body: JSON.stringify({ company: { logo: PNG } }) }));
    ok("valid logo data URL persists", setLogo.status === 200 && setLogo.body.company.logo === PNG);
    const cfg = await J("/api/config");
    ok("logo surfaces on public /config", cfg.body.brandLogo === PNG);
    const badLogo = await J("/api/admin/settings", auth(tok, { method: "PUT", body: JSON.stringify({ company: { logo: "not-a-data-url" } }) }));
    ok("invalid logo → 400", badLogo.status === 400);
    const clearLogo = await J("/api/admin/settings", auth(tok, { method: "PUT", body: JSON.stringify({ company: { logo: null } }) }));
    ok("logo can be removed (null)", clearLogo.status === 200 && clearLogo.body.company.logo === null);

    /* ---- Lightning Address (LNURL-pay): pay a Mobile Money number in Sats ---- */
    const lnp = await J("/.well-known/lnurlp/677000789");
    ok("lnurlp resolves a valid MTN number → payRequest", lnp.status === 200 && lnp.body.tag === "payRequest");
    ok("lnurlp callback + sendable range present", typeof lnp.body.callback === "string" && lnp.body.maxSendable >= lnp.body.minSendable && lnp.body.minSendable > 0);
    ok("lnurlp metadata names the Mobile Money number", typeof lnp.body.metadata === "string" && lnp.body.metadata.includes("677000789"));
    const lnBad = await J("/.well-known/lnurlp/666000111"); // Nexttel 66x — unsupported
    ok("lnurlp rejects an unsupported number → ERROR", lnBad.body.status === "ERROR");
    const amt = Math.round((lnp.body.minSendable + lnp.body.maxSendable) / 2) > 0 ? Math.max(lnp.body.minSendable, 5_000_000) : lnp.body.minSendable;
    const lnPay = await J(`/lnurl/pay/677000789?amount=${amt}`);
    ok("lnurl pay returns a bolt11 invoice (pr)", typeof lnPay.body.pr === "string" && lnPay.body.pr.startsWith("lnbc"));
    const lnLow = await J("/lnurl/pay/677000789?amount=1");
    ok("lnurl pay rejects out-of-range amount → ERROR", lnLow.body.status === "ERROR");
    const lnNoAmt = await J("/lnurl/pay/677000789");
    ok("lnurl pay requires an amount → ERROR", lnNoAmt.body.status === "ERROR");
    // The LNURL invoice creates a real AWAITING_INBOUND payment tagged source=lnurl.
    const lnPays = await J("/api/payments", { headers: { "x-mm-sender": `lnurl:677000789@momome.xyz` } });
    ok("lnurl payment is created + tagged source=lnurl", Array.isArray(lnPays.body) && lnPays.body.some((p: { source?: string; recipient: { phone: string } }) => p.source === "lnurl" && p.recipient.phone === "677000789"));

    // --- Security: admin auth brute-force throttling (real HTTP, end of phase 1
    // so the shared-IP buckets don't affect earlier auth tests). Per-username
    // lockout on login; per-IP lockout on the recovery-key forgot endpoint. ---
    let loginSaw429 = false;
    for (let i = 0; i < 9; i++) {
      const r = await POST("/api/admin/login", { username: "ratelimit-probe", password: `nope${i}` });
      if (r.status === 429) loginSaw429 = true;
    }
    ok("admin login is rate-limited after repeated failures (429)", loginSaw429);
    let forgotSaw429 = false;
    for (let i = 0; i < 7; i++) {
      const r = await POST("/api/admin/forgot", { username: "admin", recoveryKey: "definitely-wrong", newPassword: "irrelevant" });
      if (r.status === 429) forgotSaw429 = true;
    }
    ok("admin forgot (recovery-key) is rate-limited (429)", forgotSaw429);
  } finally {
    server.close();
  }

  /* ---------------- Part B — live IBEX Lightning (fetch mocked) ---------------- */
  console.log("\nPart B — live IBEX Lightning path (fetch mocked)");
  const { ibexAdapter, registerAccountWebhook, transactionStatus } = await import("../src/adapters/ibex.js");
  const storeMod = await import("../src/core/store.js");
  const { confirmInbound } = await import("../src/core/stateMachine.js");
  const { entriesFor } = await import("../src/core/ledger.js");

  const realFetch = globalThis.fetch;
  let sentInvoiceBody: any = null;
  let sentOnchainBody: any = null;
  let sentWebhookReg: any = null;
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
    if (u.includes("/webhooks") && u.includes("/accounts/")) {
      sentWebhookReg = JSON.parse(init.body);
      return new Response(null, { status: 204 });
    }
    if (u.includes("/v2/transaction/") && !u.endsWith("/details")) {
      // GET /v2/transaction/{id} — the real status source. "expired" → CANCEL
      // (unpaid), anything else → a paid invoice (receiveMsat > 0).
      if (u.includes("tx_expired")) {
        return new Response(JSON.stringify({ status: "failed", settledAt: null, invoice: { settleDateUtc: null, receiveMsat: 0, state: { name: "CANCEL" } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ settledAt: "2026-06-04T00:00:00Z", invoice: { settleDateUtc: "2026-06-04T00:00:00Z", receiveMsat: MSAT, state: { name: "SETTLED" } } }), { status: 200 });
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
    ok("instruction QR is a lightning: URI", li.qr === "lightning:lnbc1304140n1pjmocked");
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

    // 1c. account webhook registration (covers on-chain) + reconciliation lookup
    await registerAccountWebhook();
    ok("account webhook registered to /webhooks/ibex", String(sentWebhookReg.url).endsWith("/webhooks/ibex"));
    ok("account webhook carries the secret", sentWebhookReg.secret === "whsec_test");
    const st = await transactionStatus("tx_recon");
    ok("reconciliation reports a settled tx (receiveMsat>0 via /v2/transaction/{id})", st?.settled === true && st?.failed === false);
    const stX = await transactionStatus("tx_expired");
    ok("reconciliation reports an expired/CANCEL tx as failed, not settled", stX?.settled === false && stX?.failed === true);

    // 2. webhook auth — IBEX Hub echoes the shared secret in the body (no HMAC)
    const now0 = new Date().toISOString();
    // IBEX reports the amount in MSAT on a BTC account.
    const goodBody = JSON.stringify({ transaction: { id: "tx_live_001", status: "settled", settledAt: now0, amount: MSAT }, secret: "whsec_test" });
    ok("valid webhook secret accepted", ibexAdapter.verifyWebhook(goodBody, {}));
    ok("wrong webhook secret rejected", !ibexAdapter.verifyWebhook(JSON.stringify({ transaction: { id: "tx_live_001" }, secret: "nope" }), {}));
    ok("missing webhook secret rejected", !ibexAdapter.verifyWebhook(JSON.stringify({ transaction: { id: "tx_live_001" } }), {}));
    // sender-IP allowlist: a non-allowed forwarded IP is rejected even with a good secret
    ok("disallowed sender IP rejected", !ibexAdapter.verifyWebhook(goodBody, { "x-forwarded-for": "1.2.3.4" }));
    ok("allowed sender IP accepted", ibexAdapter.verifyWebhook(goodBody, { "x-forwarded-for": "35.243.242.121" }));

    // 3. parse settled event — amount converted MSAT → BTC (the 1e11 fix)
    const ev = ibexAdapter.parseEvent(JSON.parse(goodBody))!;
    ok("event parsed as confirmed", ev.kind === "confirmed");
    ok("event providerRef is the transaction id", ev.providerRef === "tx_live_001");
    ok("event amount converted msat→BTC", Math.abs(ev.amount! - BTC_IN) < 1e-9);
    ok("a failed/expired tx is ignored", ibexAdapter.parseEvent({ transaction: { id: "x", status: "failed" } }) === null);
    // webhook path agrees with transactionStatus: paid signal carried ONLY on the
    // embedded invoice (receiveMsat) — no top-level settledAt/status — still confirms.
    const evInv = ibexAdapter.parseEvent({ transaction: { id: "tx_inv", invoice: { receiveMsat: MSAT, settleDateUtc: now0, state: { name: "SETTLED" } } } })!;
    ok("invoice-only paid webhook confirms (receiveMsat)", evInv?.kind === "confirmed" && Math.abs(evInv.amount! - BTC_IN) < 1e-9);
    ok("invoice CANCEL webhook is ignored", ibexAdapter.parseEvent({ transaction: { id: "x", invoice: { receiveMsat: 0, state: { name: "CANCEL" } } } }) === null);

    // helper to seed an AWAITING payment with a locked instruction
    const seedPayment = (id: string, providerRef: string, amount: number, method: any = "LIGHTNING") => {
      const now = new Date().toISOString();
      const pay: any = {
        id, ref: id, quoteId: "q", state: "AWAITING_INBOUND", displayStatus: "Pending", method,
        recipient: { phone: "6 70 12 34 56", country: "CM", provider: "MTN", name: "NANA JEAN PAUL", nameSource: "provider" },
        xaf: 50000, feeXaf: 1250, totalXaf: 51250, usd: 84.3,
        payInstruction: { method, code: "addr", qr: "QR", asset: "BTC", amount, amountLabel: "", expiresAt: now, providerRef, provider: "ibex" },
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

    // 4b. Lightning credits the LOCKED amount regardless of the webhook amount
    //     (LN settles in full; protects the ledger from any unit error).
    seedPayment("pay_ln_lock", "tx_ln_lock", BTC_IN);
    await confirmInbound(storeMod.findByProviderRef("tx_ln_lock")!, BTC_IN * 0.5); // bogus low amount
    const lockNets: Record<string, number> = {};
    for (const e of entriesFor("pay_ln_lock")) lockNets[e.currency] = (lockNets[e.currency] ?? 0) + (e.direction === "debit" ? e.amount : -e.amount);
    ok("LN settles in full despite a low webhook amount", storeMod.getPayment("pay_ln_lock")!.state === "DELIVERED");
    ok("LN ledger uses the locked amount (balanced)", Math.abs(lockNets.BTC) < 1e-9 && Math.abs(lockNets.XAF) < 1e-9);

    // 5. ON-CHAIN underpayment guard (on-chain CAN be partial, unlike LN)
    seedPayment("pay_oc_short", "oc_short", BTC_IN, "ONCHAIN");
    await confirmInbound(storeMod.findByProviderRef("oc_short")!, BTC_IN * 0.7);
    ok("30%-short on-chain inbound → MANUAL_REVIEW", storeMod.getPayment("pay_oc_short")!.state === "MANUAL_REVIEW");

    // 5b. a CORRECT on-chain payment never trips the guard
    seedPayment("pay_oc_exact", "oc_exact", BTC_IN, "ONCHAIN");
    await confirmInbound(storeMod.findByProviderRef("oc_exact")!, BTC_IN);
    ok("exact on-chain amount settles (no false underpay)", storeMod.getPayment("pay_oc_exact")!.state === "DELIVERED");

    // 6. webhook idempotency
    const evCount = storeMod.getPayment("pay_live_ok")!.events.length;
    await confirmInbound(storeMod.findByProviderRef("tx_live_001")!, ev.amount);
    ok("replayed webhook does not double-settle", storeMod.getPayment("pay_live_ok")!.events.length === evCount);

    // 7. confirmed ON-CHAIN inbound with NO amount is untrusted → MANUAL_REVIEW
    seedPayment("pay_oc_noamt", "oc_noamt", BTC_IN, "ONCHAIN");
    await confirmInbound(storeMod.findByProviderRef("oc_noamt")!, undefined);
    ok("missing on-chain amount → MANUAL_REVIEW", storeMod.getPayment("pay_oc_noamt")!.state === "MANUAL_REVIEW");

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
    // Idempotent: a second refund must be a no-op (never double-reverse the ledger).
    const secondRefund = adminRefund(storeMod.getPayment("pay_refund")!);
    const rn2 = nets("pay_refund");
    ok("second refund is a no-op (idempotent, ledger stays balanced)", secondRefund === false && Math.abs(rn2.BTC ?? 0) < 1e-9 && Math.abs(rn2.XAF ?? 0) < 1e-9);

    // Float reservation: a payout reserves the treasury at FX-lock, so a marginal
    // payment that over-commits the float is HELD (not over-drawn). Compute the
    // current available float, then seed a payment whose xaf exceeds it.
    const ledgerMod2 = await import("../src/core/ledger.js");
    const domainMod = await import("../../shared/domain.js");
    const availFloat = domainMod.XAF_FLOAT_BASE + ledgerMod2.balance("external_recipient", "XAF") + ledgerMod2.balance("payout_float_XAF", "XAF");
    const overP = seedPayment("pay_float_over", "h_float_over", BTC_IN);
    overP.xaf = availFloat + 100_000; overP.totalXaf = overP.xaf + overP.feeXaf; storeMod.putPayment(overP);
    await confirmInbound(storeMod.findByProviderRef("h_float_over")!, BTC_IN);
    ok("over-committing payout is held for float (MANUAL_REVIEW)", storeMod.getPayment("pay_float_over")!.state === "MANUAL_REVIEW");

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
    // A code-only merchant (no phone yet) has NO Lightning identity — never a code-based one.
    ok("code-only merchant has no lightning identity until a phone is known", r1.merchant!.lightningAddresses.length === 0);
    const validated = mig.validateMerchant(r1.merchant!.internalId, "TEST SHOP")!;
    ok("admin validate → active, trust ≥ 0.9, admin-verified", validated.status === "active" && validated.trustScore >= 0.9 && validated.verificationSource === "admin");
    const r2 = await mig.resolveMerchant("MOMO-TEST-1");
    ok("second lookup of same code now resolves instantly", r2.resolved && r2.merchant!.internalId === validated.internalId);

    // Learning: a successful payout raises trust + attaches the code↔phone mapping.
    const before = mig.resolveMerchant("699000111");
    const learned = mig.recordSuccessfulPayout({ phone: "699000111", name: "BOULANGERIE X", provider: "MTN", country: "CM", merchantCode: "MOMO-BX" });
    ok("learning links code↔phone and raises trust", learned.merchantCode === "MOMO-BX" && learned.phone === "699000111" && learned.txCount === 1);
    // The Lightning identity is the PHONE, never the merchant code (a lookup label).
    ok("learned merchant's lightning identity is the phone, not the code",
      learned.lightningAddresses.length === 1
      && learned.lightningAddresses[0] === "699000111@momome.xyz"
      && !learned.lightningAddresses.some((a) => a.startsWith("momo-bx@")));
    void before;

    // Routing: invisible aggregator selection per provider (health being equal).
    ok("Orange routes to Peexit (preferred)", routing.selectAggregator("ORANGE").name === "peexit");
    ok("MTN routes to PawaPay", routing.selectAggregator("MTN").name === "pawapay");

    // Health-aware failover: take Peexit down → Orange must route to PawaPay.
    routing.setAggregatorUp("peexit", false);
    ok("Orange fails over to PawaPay when Peexit is down", routing.selectAggregator("ORANGE").name === "pawapay");
    routing.setAggregatorUp("peexit", true);
    ok("Orange returns to Peexit once healthy", routing.selectAggregator("ORANGE").name === "peexit");

    // Balance-aware payout selection: the funded API picks up. With no real rail
    // configured (test env), it routes by preference (simulated).
    const fundedMtn = await routing.selectFundedAggregator("MTN", "CM", 100);
    const fundedOrange = await routing.selectFundedAggregator("ORANGE", "CM", 100);
    ok("balance-aware select (sandbox) → a usable aggregator", !!fundedMtn && !!fundedOrange);
    ok("balance-aware select falls back to preference when no real rail", fundedMtn!.name === "pawapay" && fundedOrange!.name === "peexit");
    // requireLive: real-money settlement must NEVER fall back to a simulated rail.
    const liveMtn = await routing.selectFundedAggregator("MTN", "CM", 100, true);
    const liveOrange = await routing.selectFundedAggregator("ORANGE", "CM", 100, true);
    ok("requireLive with no live rail → null (never simulates a real payout)", liveMtn === null && liveOrange === null);

    // Operator detection from the number prefix (the routing/identity anchor).
    const { detectProvider } = await import("../../shared/domain.js");
    ok("677/650 → MTN", detectProvider("677000001", "CM") === "MTN" && detectProvider("650123456", "CM") === "MTN");
    ok("699/655 → ORANGE", detectProvider("699000001", "CM") === "ORANGE" && detectProvider("655123456", "CM") === "ORANGE");
    ok("Nexttel 66x → null (unsupported)", detectProvider("666123456", "CM") === null);
    const rr = await (await import("../src/core/nameResolver.js")).resolveRecipient("699123456", "CM");
    ok("resolve returns the detected operator", rr.provider === "ORANGE");

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

    // Identity prune: phantom (unclaimed, never-delivered) identities are removed;
    // a claimed identity is always kept. (Runs last — it mutates the identity graph.)
    const idMod = await import("../src/core/identity.js");
    const orphan = idMod.ensureIdentity({ phone: "699888777", country: "CM", provider: "ORANGE", name: "ORPHAN", nameSource: "manual" });
    const keeper = idMod.ensureIdentity({ phone: "699888666", country: "CM", provider: "ORANGE", name: "KEEPER", nameSource: "manual" });
    idMod.claimIdentity(keeper.customerId); // claimed → must survive the prune
    const removedIds = idMod.pruneOrphanIdentities(new Set()); // no delivered numbers → all UNCLAIMED pruned
    ok("prune removes an unclaimed never-delivered identity", removedIds.includes(orphan.customerId) && idMod.getIdentityByPhone("699888777") === undefined);
    ok("prune keeps a claimed identity", idMod.getIdentityByPhone("699888666") !== undefined);

  } finally {
    globalThis.fetch = realFetch;
  }

  console.log(`\n✅ Lightning E2E: ${passed} assertions passed\n`);
}

main().then(() => process.exit(0)).catch((e) => { console.error("\n❌", e.message); process.exit(1); });
