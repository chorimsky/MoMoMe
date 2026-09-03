/* PawaPay payout rail, end to end against a mocked v2 API.

   The adapter had no test that ever ran it LIVE — every existing case leaves it
   unconfigured, so the request it actually builds, the responses it accepts, and the
   balance read that gates every payout were all unexercised. That is how a balance
   call missing its documented ?country= parameter reached production and silently
   blocked the entire payout path: availableBalanceXaf returned null, the aggregate
   float went NaN, and every payment was refused as "payouts_unavailable".

   Here PawaPay is configured live and its HTTP surface is mocked, so the wire format
   is asserted directly. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.PAWAPAY_API_KEY = "test-key";
process.env.PAWAPAY_ENV = "production";
process.env.PAWAPAY_API_URL = "https://pawapay.test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

interface Seen { url: string; method: string; body: any; auth: string }
const seen: Seen[] = [];
let balances: Record<string, any> = {
  CMR: { balances: [{ country: "CMR", balance: "125000", currency: "XAF", provider: "" }] },
  GAB: { balances: [{ country: "GAB", balance: "77000", currency: "XAF", provider: "" }] },
};
let payoutReply: any = { status: "ACCEPTED" };
let statusReply: any = { status: "FOUND", data: { status: "COMPLETED" } };

globalThis.fetch = (async (input: unknown, init: any = {}) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  seen.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(init.body) : null, auth: init.headers?.authorization ?? "" });
  if (url.includes("/v2/wallet-balances")) {
    const c = new URL(url).searchParams.get("country") ?? "";
    return balances[c] ? J(balances[c]) : J({ balances: [] });
  }
  if (url.includes("/v2/payouts/")) return J(statusReply);
  if (url.endsWith("/v2/payouts")) return J(payoutReply);
  if (url.endsWith("/v2/deposits")) return J({ status: "ACCEPTED" });
  if (url.includes("/v2/deposits/")) return J({ status: "FOUND", data: { status: "COMPLETED" } });
  return J({}, 404);
}) as typeof fetch;

const pp = await import("../src/adapters/pawapay.js");

console.log("\nPawaPay v2 — live rail, mocked API\n");

/* ---- balance read: the call that gated every payout ---- */
const cm = await pp.availableBalanceXaf("CM");
ok("reads the Cameroon wallet balance", cm === 125000, String(cm));
const balCall = seen.find((c) => c.url.includes("wallet-balances"))!;
ok("asks per country, the way PawaPay documents it", balCall.url.includes("country=CMR"), balCall.url);
ok("authenticates with the bearer key", balCall.auth === "Bearer test-key");

// THE CACHE BUG: one country's response used to populate a shared map, so a second
// country asked inside the TTL missed it and was reported as an unfunded 0 XAF.
const ga = await pp.availableBalanceXaf("GA");
ok("a second country is not served 0 from the first country's cache", ga === 77000, String(ga));
ok("each country got its own request", seen.filter((c) => c.url.includes("wallet-balances")).length === 2);

const cm2 = await pp.availableBalanceXaf("CM");
ok("a repeat read inside the TTL is cached", cm2 === 125000 && seen.filter((c) => c.url.includes("wallet-balances")).length === 2);

// A country with no XAF wallet is a KNOWN zero — an unfunded rail, not an unreadable one.
const td = await pp.availableBalanceXaf("TD");
ok("a country with no wallet reports a known zero, not null", td === 0, String(td));

/* ---- disbursement wire format ---- */
const req = { idempotencyKey: "MMM-PP-1", provider: "MTN" as const, country: "CM" as const, phone: "677000789", xaf: 15000, name: "Test" };
const res = await pp.disburse(req);
const post = seen.find((c) => c.method === "POST" && c.url.endsWith("/v2/payouts"))!;
ok("posts to /v2/payouts", !!post);
ok("payoutId is a v4 UUID", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(post.body.payoutId), post.body.payoutId);
ok("recipient is an MMO account", post.body.recipient.type === "MMO");
ok("phone is an international MSISDN without '+'", post.body.recipient.accountDetails.phoneNumber === "237677000789", post.body.recipient.accountDetails.phoneNumber);
ok("provider is the Cameroon MTN correspondent", post.body.recipient.accountDetails.provider === "MTN_MOMO_CMR", post.body.recipient.accountDetails.provider);
ok("XAF is sent zero-decimal", post.body.amount === "15000", post.body.amount);
ok("currency is XAF", post.body.currency === "XAF");
ok("customerMessage is within PawaPay's 22-char limit", post.body.customerMessage.length <= 22, `${post.body.customerMessage.length} chars`);
ok("the payout is accepted and NOT simulated", res.status === "accepted" && res.simulated === false);

/* ---- idempotency: the same ref must never produce a second payout ---- */
const before = seen.filter((c) => c.method === "POST" && c.url.endsWith("/v2/payouts")).length;
const again = await pp.disburse(req);
ok("a repeat of the same ref is a duplicate", again.status === "duplicate");
ok("and issues NO second POST", seen.filter((c) => c.method === "POST" && c.url.endsWith("/v2/payouts")).length === before);
ok("the duplicate keeps the same payoutId", again.providerRef === res.providerRef);

// PawaPay's own idempotent reply is accepted rather than thrown on.
payoutReply = { status: "DUPLICATE_IGNORED" };
let threw = false;
try { await pp.disburse({ ...req, idempotencyKey: "MMM-PP-dup" }); } catch { threw = true; }
ok("DUPLICATE_IGNORED is accepted, not an error", !threw);

/* ---- a rejected payout must surface the provider's reason ---- */
payoutReply = { status: "REJECTED", failureReason: { failureCode: "PAYOUTS_NOT_ALLOWED", failureMessage: "not permitted" } };
let msg = "";
try { await pp.disburse({ ...req, idempotencyKey: "MMM-PP-rej" }); } catch (e) { msg = e instanceof Error ? e.message : String(e); }
ok("a rejection throws", msg.length > 0);
ok("and carries the provider's failure code", msg.includes("PAYOUTS_NOT_ALLOWED"), msg);

/* ---- authoritative status re-query (what actually settles a payout) ---- */
ok("COMPLETED maps through", (await pp.queryStatusByPayoutId(res.providerRef)) === "COMPLETED");
statusReply = { status: "FOUND", data: { status: "FAILED" } };
ok("FAILED maps through", (await pp.queryStatusByPayoutId(res.providerRef)) === "FAILED");
statusReply = { status: "FOUND", data: { status: "REJECTED" } };
ok("REJECTED is a failure", (await pp.queryStatusByPayoutId(res.providerRef)) === "FAILED");
statusReply = { status: "FOUND", data: { status: "SUBMITTED" } };
ok("an in-flight payout stays PENDING", (await pp.queryStatusByPayoutId(res.providerRef)) === "PENDING");
statusReply = { status: "NOT_FOUND" };
ok("NOT_FOUND is PENDING, never a failure — a payout we cannot see must not be written off",
   (await pp.queryStatusByPayoutId(res.providerRef)) === "PENDING");

/* ---- cash-in (deposit) ---- */
const dep = await pp.deposit({ ...req, idempotencyKey: "MMM-DEP-1" });
const depPost = seen.find((c) => c.method === "POST" && c.url.endsWith("/v2/deposits"))!;
ok("a deposit posts a payer, not a recipient", !!depPost.body.payer && !depPost.body.recipient);
ok("the deposit is accepted", dep.status === "accepted" && dep.simulated === false);
ok("customerMessage stays within the limit", depPost.body.customerMessage.length <= 22);

/* ---- callbacks fail closed on a live rail ---- */
ok("an unverified callback is REJECTED while live (RFC-9421 is not implemented)", pp.verifyCallback() === false);

/* ---- the trust layer must not invent a name once real money can move ---- */
ok("no fabricated recipient name is returned on a live rail", (await pp.lookupName("677000789")) === null);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
