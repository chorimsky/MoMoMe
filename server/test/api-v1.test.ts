/* API v1 (docs/api-v1) — the §44 critical flow through /v1, then the guarantees:
   envelope + request ids, credentials + environments + scopes, idempotency, limits,
   liquidity reservations under concurrency (§45), webhooks (typed, signed, replay),
   settlements, usage, the developer dashboard backend and the operator side.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/api-v1.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "api-v1-test-secret";
process.env.IDENTITY_MAX_DISTINCT_PER_HOUR_IP = "1000";
import type { AddressInfo } from "node:net";
import http from "node:http";
import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

type J = Record<string, any>;
async function main() {
  const { createApp } = await import("../src/app.js");
  const { store } = await import("../src/db/store.js");
  const { simulateFloatTotal, reservedXaf } = await import("../src/core/platform/liquidity.js");
  const { updateOrganization } = await import("../src/core/platform/orgs.js");
  const { issueToken } = await import("../src/core/adminAuth.js"); const { createUser: createAdmin } = await import("../src/core/adminUsers.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // A webhook receiver that records signed deliveries.
  const received: Array<{ headers: http.IncomingHttpHeaders; body: J }> = [];
  const hook = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { received.push({ headers: req.headers, body: JSON.parse(b) }); res.writeHead(200).end("ok"); }); }).listen(0);
  await new Promise<void>((r) => hook.once("listening", () => r()));
  const hookUrl = `http://127.0.0.1:${(hook.address() as AddressInfo).port}/hook`;

  const dev = async (p: string, body?: unknown, token?: string, method = body ? "POST" : "GET") => { const r = await fetch(`${base}/api/developers${p}`, { method, headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: (await r.json()) as J }; };
  const v1 = async (p: string, opts: { method?: string; body?: unknown; key?: string; idem?: string; headers?: Record<string, string> } = {}) => {
    const r = await fetch(`${base}/v1${p}`, { method: opts.method ?? (opts.body ? "POST" : "GET"), headers: { "content-type": "application/json", ...(opts.key ? { authorization: `Bearer ${opts.key}` } : {}), ...(opts.idem ? { "idempotency-key": opts.idem } : {}), ...(opts.headers ?? {}) }, body: opts.body ? JSON.stringify(opts.body) : undefined });
    return { status: r.status, headers: r.headers, body: (await r.json()) as J };
  };
  const idem = () => `idem_${crypto.randomBytes(6).toString("hex")}`;
  const until = async (id: string, states: string[], ms = 12_000) => { const t0 = Date.now(); let cur = await store().getPayment(id); while (cur && !states.includes(cur.state) && Date.now() - t0 < ms) { await new Promise((r) => setTimeout(r, 120)); cur = await store().getPayment(id); } return cur!; };
  const settle = (ms: number) => new Promise((r) => setTimeout(r, ms));

  try {
    console.log("\n1. Developer account → organization → credential (Phase 1)\n");
    const su = await dev("/signup", { email: "dev@bitbank.example", name: "Ada", password: "correct-horse-battery", organization: "Bitbank" });
    ok("sign-up creates the user, an organization with a default application, and a session", su.status === 201 && su.body.organization?.id && su.body.token, JSON.stringify(su.body).slice(0, 80));
    const tok = su.body.token as string; const orgId = su.body.organization.id as string;
    const me = await dev("/me", undefined, tok);
    ok("/me lists the organization with the owner role", me.body.organizations?.[0]?.role === "owner");
    const noLive = await dev(`/orgs/${orgId}/credentials`, { environment: "live", label: "prod" }, tok);
    ok("a live credential is refused until the operator enables live", noLive.status === 403 && noLive.body.error === "live_not_enabled");
    const cr = await dev(`/orgs/${orgId}/credentials`, { environment: "test", label: "sandbox key" }, tok);
    ok("a test credential is minted once with its secret", cr.status === 201 && /^mm_test_[0-9a-f]{32}$/.test(cr.body.secret) && cr.body.credential.hint.startsWith("mm_test_"));
    const key = cr.body.secret as string;
    const list = await dev(`/orgs/${orgId}/credentials`, undefined, tok);
    ok("the list never shows the secret", list.body.credentials.length === 1 && !JSON.stringify(list.body).includes(key));
    const login = await dev("/login", { email: "dev@bitbank.example", password: "wrong" });
    ok("a wrong password is refused", login.status === 401);

    console.log("\n2. The envelope, request ids, auth and environments\n");
    const noAuth = await v1("/account");
    ok("no credential → 401 in the error envelope with a request id", noAuth.status === 401 && noAuth.body.error?.code === "unauthorized" && /^req_/.test(noAuth.body.meta?.request_id) && noAuth.headers.get("x-request-id") === noAuth.body.meta.request_id);
    const echo = await v1("/account", { key, headers: { "x-request-id": "my-trace-0001" } });
    ok("a caller-supplied X-Request-Id is echoed", echo.body.meta?.request_id === "my-trace-0001");
    ok("GET /v1/account describes org, credential, plan and environment", echo.status === 200 && echo.body.data?.organization?.id === orgId && echo.body.data.environment === "test" && echo.body.data.plan?.id === "developer");
    const liveKey = `mm_live_${"a".repeat(32)}`;
    const wrongEnv = await v1("/account", { key: liveKey });
    ok("an unknown live key on the test deployment → 401 unauthorized (not environment_mismatch: it does not exist)", wrongEnv.status === 401);
    const health = await v1("/health");
    ok("GET /v1/health is public and names the environment", health.status === 200 && health.body.data.environment === "test");
    const missing = await v1("/nothing", { key });
    ok("unknown paths answer in the envelope", missing.status === 404 && missing.body.error.code === "not_found");

    console.log("\n3. §44 critical flow: quote → payment → paid → converted → paid out → COMPLETED → webhook → timeline\n");
    const wh = await v1("/webhooks", { key, idem: idem(), body: { url: hookUrl, events: ["payment.completed", "payment.awaiting_payment", "settlement.created"] } });
    ok("webhook endpoint registered with a one-time secret", wh.status === 201 && /^whsec_/.test(wh.body.data.secret), JSON.stringify(wh.body.error ?? ""));
    const whSecret = wh.body.data.secret as string;
    const q = await v1("/quotes", { key, idem: idem(), body: { source: { asset: "BTC", network: "LIGHTNING" }, destination: { country: "CM", currency: "XAF", amount: "5000" } } });
    ok("POST /v1/quotes → 201 with rate, fees, expiry", q.status === 201 && q.body.data.status === "active" && Number(q.body.data.source.amount) > 0 && q.body.data.fees.platform.currency === "XAF" && q.body.data.expires_at, JSON.stringify(q.body).slice(0, 120));
    const quoteId = q.body.data.id as string;
    const qg = await v1(`/quotes/${quoteId}`, { key });
    ok("GET /v1/quotes/:id returns it", qg.status === 200 && qg.body.data.id === quoteId);
    const pay = await v1("/payments", { key, idem: "order-12345", body: { quote_id: quoteId, reference: "ORDER-12345", recipient: { phone: "+237670123456" }, metadata: { order_id: "12345" } } });
    ok("POST /v1/payments → 201 AWAITING_PAYMENT with a Lightning invoice", pay.status === 201 && pay.body.data.status === "AWAITING_PAYMENT" && pay.body.data.payment_instructions?.method === "lightning_invoice" && pay.body.data.reference === "ORDER-12345" && pay.body.data.metadata.order_id === "12345", JSON.stringify(pay.body).slice(0, 160));
    const pid = pay.body.data.id as string;
    ok("the recipient name came from the operator record (sandbox: NANA JEAN PAUL)", pay.body.data.recipient.name === "NANA JEAN PAUL" && pay.body.data.recipient.operator === "MTN");
    ok("the XAF was reserved for this payment", reservedXaf() === 5000, String(reservedXaf()));
    const replay = await v1("/payments", { key, idem: "order-12345", body: { quote_id: quoteId, reference: "ORDER-12345", recipient: { phone: "+237670123456" }, metadata: { order_id: "12345" } } });
    ok("the same Idempotency-Key + body replays the 201 (no second payment)", replay.status === 201 && replay.body.data.id === pid && replay.headers.get("idempotent-replayed") === "true");
    const mismatch = await v1("/payments", { key, idem: "order-12345", body: { quote_id: quoteId, reference: "OTHER" } });
    ok("the same key with a different body → 409 idempotency_key_reused", mismatch.status === 409 && mismatch.body.error.code === "idempotency_key_reused");
    const reuse = await v1("/payments", { key, idem: idem(), body: { quote_id: quoteId, recipient: { phone: "+237670123456" } } });
    ok("a used quote cannot make a second payment", reuse.status === 409 && reuse.body.error.code === "quote_already_used");
    // The customer pays the invoice (sandbox: simulate the inbound as the app does).
    await fetch(`${base}/api/payments/${pid}/simulate`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` } });
    const done = await until(pid, ["DELIVERED", "FAILED", "REFUND_PENDING", "MANUAL_REVIEW"]);
    ok("engine: DELIVERED", done.state === "DELIVERED", done.state);
    const got = await v1(`/payments/${pid}`, { key });
    ok("GET /v1/payments/:id → COMPLETED with the timeline filled", got.body.data.status === "COMPLETED" && got.body.data.timeline.payment_confirmed_at && got.body.data.timeline.payout_submitted_at && got.body.data.timeline.completed_at && got.body.data.payment_instructions === null);
    await settle(400);
    ok("the reservation was consumed", reservedXaf() === 0);
    const types = received.map((r) => r.body.type);
    ok("webhooks: payment.awaiting_payment then payment.completed delivered (only the subscribed types)", types.includes("payment.awaiting_payment") && types.includes("payment.completed") && types.indexOf("payment.awaiting_payment") < types.indexOf("payment.completed") && !types.includes("payment.detected"), types.join(","));
    const completed = received.find((r) => r.body.type === "payment.completed")!;
    const sig = String(completed.headers["x-momome-signature"]); const t = /t=(\d+)/.exec(sig)![1]; const v = /v1=([0-9a-f]+)/.exec(sig)![1];
    const expect = crypto.createHmac("sha256", whSecret).update(`${t}.${JSON.stringify(completed.body)}`).digest("hex");
    ok("the delivery is signed with the endpoint secret and carries the event id", v === expect && String(completed.headers["x-momome-event-id"]) === completed.body.id && completed.body.data.id === pid && completed.body.livemode === false);
    const tl = await v1(`/transactions/${pid}`, { key });
    ok("GET /v1/transactions/:id — request → quote → payment → engine → provider → ledger → webhooks", tl.status === 200 && tl.body.data.steps.some((s: J) => s.step === "provider_transaction") && tl.body.data.ledger.length > 0 && tl.body.data.webhooks.some((w: J) => w.type === "payment.completed" && w.status === "delivered") && tl.body.data.compliance.status === "CLEAR");
    const hist = await v1("/payments?limit=10", { key });
    ok("GET /v1/payments lists the organization's payments", hist.body.data.data.length === 1 && hist.body.data.data[0].id === pid);
    const byRef = await v1("/payments?reference=ORDER-12345", { key });
    ok("…and finds by reference", byRef.body.data.data[0]?.id === pid);
    const usage = await v1("/usage", { key });
    ok("GET /v1/usage counts the quote, the payment, the completion and the volume", usage.body.data.quotes >= 1 && usage.body.data.payments === 1 && usage.body.data.completed === 1 && usage.body.data.volumeXaf === 5000, JSON.stringify(usage.body.data).slice(0, 120));

    console.log("\n4. Source-first quotes, validation vocabulary, recipients\n");
    const sq = await v1("/quotes", { key, idem: idem(), body: { source: { asset: "USDT", network: "ETHEREUM", amount: "50.00" }, destination: { country: "CM", currency: "XAF" } } });
    ok("a source-amount quote fits under the amount the sender will pay", sq.status === 201 && Number(sq.body.data.source.amount) <= 50 && Number(sq.body.data.destination.amount) > 20000, `${sq.body.data?.source?.amount} USDT → ${sq.body.data?.destination?.amount} XAF`);
    const tron = await v1("/quotes", { key, idem: idem(), body: { source: { asset: "USDT", network: "TRON", amount: "50" }, destination: { country: "CM" } } });
    ok("USDT on TRON → 422 network_unsupported naming what is supported", tron.status === 422 && tron.body.error.code === "network_unsupported" && Array.isArray(tron.body.error.details.supported));
    const ke = await v1("/quotes", { key, idem: idem(), body: { source: { asset: "BTC", network: "LIGHTNING" }, destination: { country: "KE", amount: "5000" } } });
    ok("an unsupported country → country_unsupported", ke.status === 422 && ke.body.error.code === "country_unsupported");
    const noIdem = await v1("/quotes", { key, body: { source: { asset: "BTC", network: "LIGHTNING" }, destination: { country: "CM", amount: "5000" } } });
    ok("a write without Idempotency-Key → 400 idempotency_key_required", noIdem.status === 400 && noIdem.body.error.code === "idempotency_key_required");
    const val = await v1("/recipients/validate", { key, body: { phone: "+237670123456" } });
    ok("POST /v1/recipients/validate → operator + verified name", val.body.data.valid === true && val.body.data.operator === "MTN" && val.body.data.name === "NANA JEAN PAUL");
    const bad = await v1("/recipients/validate", { key, body: { phone: "+23767012" } });
    ok("…a short number is invalid with a reason", bad.body.data.valid === false && bad.body.data.reason === "bad_length");
    const mm = await v1("/recipients/validate", { key, body: { phone: "+237670123456", name: "Paul Biya" } });
    ok("…a name that does not match says mismatch", mm.body.data.name_match === "mismatch");

    console.log("\n5. Scopes, limits, cancellation\n");
    const ro = await dev(`/orgs/${orgId}/credentials`, { environment: "test", label: "read only", scopes: ["payments:read"] }, tok);
    const roKey = ro.body.secret as string;
    const forb = await v1("/quotes", { key: roKey, idem: idem(), body: { source: { asset: "BTC", network: "LIGHTNING" }, destination: { country: "CM", amount: "5000" } } });
    ok("a credential without quotes:write → 403 forbidden_scope", forb.status === 403 && forb.body.error.code === "forbidden_scope");
    const bigQ = await v1("/quotes", { key, idem: idem(), body: { source: { asset: "BTC", network: "LIGHTNING" }, destination: { country: "CM", amount: "1000000" } } });
    // Raise the engine ceiling is not needed: 1,000,000 XAF is inside the engine's range; the org's test rule caps at 5,000,000 — so add a tighter rule.
    const admin = createAdmin("Ops", "ops@momome.xyz", "Super Admin", "ops-password-1234"); const atok = issueToken({ uid: admin.id, role: "Super Admin", elevatedUntil: Date.now() + 600_000 }).token;
    const A = { "content-type": "application/json", authorization: `Bearer ${atok}` };
    const rule = await (await fetch(`${base}/api/admin/platform/limits`, { method: "PUT", headers: A, body: JSON.stringify({ name: "Bitbank test cap", priority: 1, scope: { orgIds: [orgId] }, ceilings: { maxTransactionXaf: 500000 } }) })).json() as J;
    ok("operator adds an organization-scoped limit rule", rule.id?.startsWith("lim_"));
    const over = await v1("/payments", { key, idem: idem(), body: { quote_id: bigQ.body.data.id, recipient: { phone: "+237670123456" } } });
    ok("a payment over the rule → 422 limit_exceeded naming the rule, nothing reserved", over.status === 422 && over.body.error.code === "limit_exceeded" && over.body.error.details.rule === "Bitbank test cap" && reservedXaf() === 0, JSON.stringify(over.body.error).slice(0, 120));
    const q2 = await v1("/quotes", { key, idem: idem(), body: { source: { asset: "BTC", network: "LIGHTNING" }, destination: { country: "CM", amount: "3000" } } });
    const p2 = await v1("/payments", { key, idem: idem(), body: { quote_id: q2.body.data.id, recipient: { phone: "+237670123456" } } });
    const cx = await v1(`/payments/${p2.body.data.id}/cancel`, { key, idem: idem(), body: {} });
    ok("an unpaid payment can be cancelled → CANCELLED and its reservation released", cx.status === 200 && cx.body.data.status === "CANCELLED" && reservedXaf() === 0, cx.body.data?.status);
    const cx2 = await v1(`/payments/${pid}/cancel`, { key, idem: idem(), body: {} });
    ok("a completed payment cannot be cancelled", cx2.status === 409 && cx2.body.error.code === "payment_not_cancellable");
    const rf = await v1(`/payments/${pid}/refund`, { key, idem: idem(), body: { destination: { invoice: "lnbc1test" } } });
    ok("a completed payment cannot be refunded (pass-through: the money is at the recipient)", rf.status === 409 && rf.body.error.code === "payment_not_refundable");
    const otherOrg = await dev("/signup", { email: "other@example.com", name: "Bob", password: "another-long-password", organization: "Other Co" });
    const oc = await dev(`/orgs/${otherOrg.body.organization.id}/credentials`, { environment: "test", label: "k" }, otherOrg.body.token);
    const foreign = await v1(`/payments/${pid}`, { key: oc.body.secret });
    ok("another organization cannot read the payment (404, not 403)", foreign.status === 404 && foreign.body.error.code === "payment_not_found");

    console.log("\n6. §45 concurrency: many payments race for the same liquidity — never overspent\n");
    simulateFloatTotal(20_000); // room for four 5 000 XAF payouts
    await fetch(`${base}/api/admin/platform/organizations/${orgId}`, { method: "PATCH", headers: A, body: JSON.stringify({ plan: "enterprise" }) }); // the developer plan's payment-endpoint ceiling would refuse the burst first
    const quotes = await Promise.all(Array.from({ length: 12 }, () => v1("/quotes", { key, idem: idem(), body: { source: { asset: "BTC", network: "LIGHTNING" }, destination: { country: "CM", amount: "5000" } } })));
    // Well-separated numbers: adjacent ones would trip the wrong-person guard, not the liquidity check.
    const phones = ["670111000", "671222000", "672333000", "673444000", "674555000", "675666000", "676777000", "677888000", "678999000", "679100000", "650200000", "651300000"];
    const races = await Promise.all(quotes.map((qq, i) => v1("/payments", { key, idem: idem(), body: { quote_id: qq.body.data.id, recipient: { phone: `+237${phones[i]}` } } })));
    const created = races.filter((r) => r.status === 201).length; const refused = races.filter((r) => r.status === 503 && r.body.error.code === "insufficient_liquidity").length;
    ok("exactly the liquidity's worth were created, the rest refused insufficient_liquidity", created === 4 && refused === 8 && reservedXaf() === 20_000, `created=${created} refused=${refused} reserved=${reservedXaf()} other=${races.filter((r) => r.status !== 201 && r.status !== 503).map((r) => `${r.status}:${r.body.error?.code}`).join(",")}`);
    const ids = new Set(races.filter((r) => r.status === 201).map((r) => r.body.data.id));
    ok("no payment was created twice", ids.size === created);
    for (const r of races.filter((r) => r.status === 201)) await v1(`/payments/${r.body.data.id}/cancel`, { key, idem: idem(), body: {} });
    ok("cancelling them returns the liquidity", reservedXaf() === 0);
    simulateFloatTotal(null);

    console.log("\n7. Settlements (balance is ledger-derived; nothing to settle until credited)\n");
    const s0 = await v1("/settlements", { key, idem: idem(), body: { amount: "1000", destination: { type: "mobile_money", phone: "+237670123456" } } });
    ok("a settlement above the (zero) balance → 409 insufficient_balance", s0.status === 409 && s0.body.error.code === "insufficient_balance");
    const credit = await (await fetch(`${base}/api/admin/platform/organizations/${orgId}/credit`, { method: "POST", headers: A, body: JSON.stringify({ xaf: 10000, reference: "test-collection" }) })).json() as J;
    ok("operator credits the organization (ledger entry)", credit.ok && credit.balance.available === 10000);
    const bal = await v1("/account/balances", { key });
    ok("GET /v1/account/balances shows it", bal.body.data.data[0].available === "10000");
    const s1 = await v1("/settlements", { key, idem: idem(), body: { amount: "6000", destination: { type: "mobile_money", phone: "+237670123456", name: "Bitbank Ltd" }, reference: "PAYOUT-1" } });
    ok("POST /v1/settlements → 201 REQUESTED", s1.status === 201 && s1.body.data.status === "REQUESTED", JSON.stringify(s1.body).slice(0, 120));
    const sid = s1.body.data.id as string;
    const s2 = await v1("/settlements", { key, idem: idem(), body: { amount: "6000", destination: { type: "mobile_money", phone: "+237670123456" } } });
    ok("a second request cannot spend the same money", s2.status === 409);
    for (const a of ["approve", "submit", "complete"]) await fetch(`${base}/api/admin/platform/settlements/${sid}/${a}`, { method: "POST", headers: A, body: JSON.stringify({ providerRef: "MTN-REF-1" }) });
    const sg = await v1(`/settlements/${sid}`, { key });
    ok("operator approve → submit → complete; the org sees COMPLETED with the provider reference", sg.body.data.status === "COMPLETED" && sg.body.data.provider_reference === "MTN-REF-1");
    const bal2 = await v1("/account/balances", { key });
    ok("the balance fell by the settled amount", bal2.body.data.data[0].available === "4000");
    await settle(300);
    ok("settlement.created reached the webhook", received.some((r) => r.body.type === "settlement.created"));

    console.log("\n8. Webhook management: list, test, deliveries, replay, patch, delete\n");
    const wl = await v1("/webhooks", { key });
    const whId = wl.body.data.data[0].id as string;
    const test = await v1(`/webhooks/${whId}/test`, { key, body: {} });
    await settle(300);
    ok("POST /webhooks/:id/test delivers a ping", test.body.data.sent && received.some((r) => r.body.type === "ping"));
    const dl = await v1(`/webhooks/${whId}/deliveries`, { key });
    const evId = dl.body.data.data.find((d: J) => d.type === "payment.completed")?.event_id;
    const before = received.length;
    const rp = await v1(`/webhooks/${whId}/replay`, { key, body: { event_id: evId } });
    await settle(300);
    ok("replay re-delivers the same event id", rp.status === 200 && received.length === before + 1 && received[received.length - 1].body.id === evId);
    const pt = await v1(`/webhooks/${whId}`, { key, method: "PATCH", body: { enabled: false } });
    ok("PATCH disables it", pt.body.data.enabled === false);
    const del = await v1(`/webhooks/${whId}`, { key, method: "DELETE" });
    ok("DELETE removes it", del.body.data.deleted === true && (await v1("/webhooks", { key })).body.data.data.length === 0);

    console.log("\n9. Rotation, revocation, operator suspension\n");
    const rot = await dev(`/orgs/${orgId}/credentials/${cr.body.credential.id}/rotate`, { grace_seconds: 0 }, tok);
    ok("rotate mints a new secret and revokes the old one", rot.status === 201 && /^mm_test_/.test(rot.body.secret) && (await v1("/account", { key })).body.error?.code === "credential_revoked");
    const key2 = rot.body.secret as string;
    ok("the new secret works", (await v1("/account", { key: key2 })).status === 200);
    await fetch(`${base}/api/admin/platform/organizations/${orgId}`, { method: "PATCH", headers: A, body: JSON.stringify({ status: "suspended", suspendedReason: "test" }) });
    ok("a suspended organization → 403 organization_suspended", (await v1("/account", { key: key2 })).body.error?.code === "organization_suspended");
    updateOrganization(orgId, { status: "active" });
    const audit = await dev(`/orgs/${orgId}/audit`, undefined, tok);
    ok("the audit trail has the credential, payment and operator actions", ["credential.created", "payment.created", "credential.rotated", "organization.operator_updated"].every((a) => audit.body.events.some((e: J) => e.action === a)));
    const orgs = await (await fetch(`${base}/api/admin/platform/organizations`, { headers: A })).json() as J;
    ok("Admin → Platform lists organizations with usage", orgs.organizations.some((o: J) => o.id === orgId && o.test.payments >= 1));

    console.log("\n10. Sandbox scenarios and the contract\n");
    const k = key2;
    const sc = await v1("/sandbox/scenarios", { key: k });
    ok("GET /v1/sandbox/scenarios lists the reserved numbers", sc.status === 200 && sc.body.data.data.some((x: J) => x.scenario === "PAYMENT_FAILED"));
    const mkPay = async (phone: string) => { const qq = await v1("/quotes", { key: k, idem: idem(), body: { source: { asset: "BTC", network: "LIGHTNING" }, destination: { country: "CM", amount: "4000" } } }); return v1("/payments", { key: k, idem: idem(), body: { quote_id: qq.body.data.id, recipient: { phone } } }); };
    const pf = await mkPay("+237670000001");
    const paid = await v1(`/sandbox/payments/${pf.body.data.id}/pay`, { key: k, body: {} });
    ok("POST /v1/sandbox/payments/:id/pay stands in for the wallet", paid.status === 200 && paid.body.data.sandbox?.paid === true, JSON.stringify(paid.body).slice(0, 100));
    const pfDone = await until(pf.body.data.id, ["REFUND_PENDING", "DELIVERED", "MANUAL_REVIEW"]);
    const pfPub = await v1(`/payments/${pf.body.data.id}`, { key: k });
    ok("PAYMENT_FAILED → REFUNDED awaiting a destination (and payment.refunded would fire)", pfDone.state === "REFUND_PENDING" && pfPub.body.data.status === "REFUNDED" && pfPub.body.data.refund?.status === "awaiting_destination", `${pfDone.state} ${pfPub.body.data.refund?.status}`);
    const retry = await v1(`/payments/${pf.body.data.id}/retry`, { key: k, idem: idem(), body: {} });
    ok("…retry is offered (and refused here: every rail rejects in this scenario)", retry.status === 409 || retry.status === 200);
    const mr = await mkPay("+237670100002");
    ok("MANUAL_REVIEW scenario payment created", mr.status === 201, JSON.stringify(mr.body).slice(0, 160));
    await v1(`/sandbox/payments/${mr.body.data.id}/pay`, { key: k, body: {} });
    const mrDone = await until(mr.body.data.id, ["MANUAL_REVIEW", "DELIVERED"]);
    ok("MANUAL_REVIEW → held for an operator", mrDone.state === "MANUAL_REVIEW" && (await v1(`/payments/${mr.body.data.id}`, { key: k })).body.data.status === "MANUAL_REVIEW", mrDone.state);
    const il = await mkPay("+237670200003");
    ok("INSUFFICIENT_LIQUIDITY → 503 at creation", il.status === 503 && il.body.error.code === "insufficient_liquidity");
    const pu = await mkPay("+237670300004");
    ok("PROVIDER_UNAVAILABLE → 503 at creation", pu.status === 503 && pu.body.error.code === "provider_unavailable");
    const to = await mkPay("+237670400005");
    ok("PAYMENT_TIMEOUT → the instruction expires within a minute", to.status === 201 && Date.parse(to.body.data.expires_at) - Date.now() < 61_000);
    const spec = await (await fetch(`${base}/v1/openapi.json`)).json() as J;
    ok("GET /v1/openapi.json is an OpenAPI 3.1 document covering every /v1 path", spec.openapi === "3.1.0" && ["/quotes", "/payments", "/payments/{id}", "/webhooks", "/settlements", "/account", "/usage", "/transactions/{id}", "/recipients/validate", "/health"].every((pth) => spec.paths[pth]) && Object.keys(spec.webhooks).includes("payment.completed"));
    const wait0 = Date.now();
    const lp = await v1(`/payments/${to.body.data.id}?wait=1&status=AWAITING_PAYMENT`, { key: k });
    ok("GET /v1/payments/:id?wait= long-polls and returns at the timeout with the current record", lp.status === 200 && Date.now() - wait0 >= 900 && lp.body.data.status === "AWAITING_PAYMENT");

    console.log("\n11. The TypeScript SDK against the live contract\n");
    const { MoMoMe, MoMoMeError, verifyWebhookSignature } = await import("../../sdk/js/src/index.js");
    const sdk = new MoMoMe(key2, { baseUrl: `${base}/v1` });
    const sq2 = await sdk.quotes.create({ source: { asset: "BTC", network: "LIGHTNING" }, destination: { country: "CM", amount: "2500" } }, { idempotencyKey: idem() });
    const sp = await sdk.payments.create({ quote_id: sq2.id, reference: "SDK-1", recipient: { phone: "+237670123456" }, metadata: { via: "sdk" } }, { idempotencyKey: "sdk-order-1" });
    ok("sdk: quote → payment (typed, unwrapped from the envelope)", sq2.status === "active" && sp.status === "AWAITING_PAYMENT" && sp.metadata.via === "sdk" && sp.payment_instructions?.method === "lightning_invoice");
    const sp2 = await sdk.payments.create({ quote_id: sq2.id, reference: "SDK-1", recipient: { phone: "+237670123456" }, metadata: { via: "sdk" } }, { idempotencyKey: "sdk-order-1" });
    ok("sdk: the same idempotency key replays the same payment", sp2.id === sp.id);
    await sdk.sandbox.pay(sp.id);
    const settled = await sdk.payments.waitUntilSettled(sp.id, { timeoutMs: 15_000 });
    ok("sdk: waitUntilSettled long-polls to COMPLETED", settled.status === "COMPLETED", settled.status);
    let caught: unknown = null;
    try { await sdk.payments.get("pay_nope"); } catch (e) { caught = e; }
    ok("sdk: errors are typed MoMoMeError with the API code and request id", caught instanceof MoMoMeError && caught.code === "payment_not_found" && caught.status === 404 && /^req_/.test(caught.requestId ?? ""));
    const tsig = Date.now(); const rawBody = JSON.stringify({ id: "evt_1", type: "ping" });
    const goodSig = `t=${tsig},v1=${crypto.createHmac("sha256", "whsec_x").update(`${tsig}.${rawBody}`).digest("hex")}`;
    ok("sdk: verifyWebhookSignature accepts a valid signature and rejects a tampered body", (await verifyWebhookSignature(rawBody, goodSig, "whsec_x")) && !(await verifyWebhookSignature(rawBody + " ", goodSig, "whsec_x")));
    const acct = await sdk.account.get();
    ok("sdk: account + health", (acct as { environment?: string }).environment === "test" && ((await sdk.health()) as { environment?: string }).environment === "test");
  } finally { server.close(); hook.close(); }
  console.log(`\n${fail ? "❌" : "✅"} ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
