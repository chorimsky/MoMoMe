/* CamPay — the Cameroonian aggregator, wired as payout rail, collection rail and the
   provider that answers "who owns this number".

   Why it was added: on 2026-10-20 peexit went NXDOMAIN at its own authoritative
   nameserver, which took out the primary payout rail AND the only collection rail, and
   left recipient verification dead — every sender told the recipient "can't be verified
   yet", paying unchecked. CamPay's GET /holder_info/ returns a structured full_name, which
   is the only one of the three candidates (peexit, payfonte, campay) that actually does.

   These tests stub fetch rather than calling CamPay, so they pin OUR contract with it:
   the amount is never scaled, the external_reference is stable across retries, a 2xx
   without a reference is not an accepted payout, only the re-query settles, the callback
   JWT is verified and pinned to HS256, and the fee is read off app_amount.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/campay.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.CAMPAY_ENV = "production";          // exercise the LIVE paths
process.env.CAMPAY_API_URL = "https://campay.invalid/api";
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-credential";
process.env.CAMPAY_WEBHOOK_KEY = "test-webhook-key-not-a-credential";
// peexit_verify must be CONFIGURED here, or the ordering assertion at the end passes
// vacuously on a chain that never contained it.
process.env.PEEXIT_API_KEY = "test-peexit-key-not-a-credential";
process.env.IDENTITY_RESOLUTION_ENABLED = "true";

import crypto from "node:crypto";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

/** Calls CamPay would have received. */
interface Seen { url: string; method: string; body: unknown; auth?: string }
const seen: Seen[] = [];
type Reply = { status: number; body: unknown };
let replies: Array<(url: string) => Reply | null> = [];

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof URL ? input.href : typeof input === "string" ? input : (input as Request).url);
  if (!url.includes("campay.invalid")) return realFetch(input as RequestInfo, init);
  const headers = (init?.headers ?? {}) as Record<string, string>;
  seen.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization });
  for (const r of replies) { const hit = r(url); if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { "content-type": "application/json" } }); }
  return new Response(JSON.stringify({ detail: "unstubbed" }), { status: 500 });
}) as typeof fetch;

const jwt = (payload: object, key: string, alg = "HS256"): string => {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const head = `${b({ alg, typ: "JWT" })}.${b(payload)}`;
  return `${head}.${crypto.createHmac("sha256", key).update(head).digest("base64url")}`;
};

async function main() {
  const campay = await import("../src/adapters/campay.js");
  const { campayConfigured, campayLive } = await import("../src/config.js");

  console.log("\nThe rail activates on its token alone\n");
  ok("configured", campayConfigured());
  ok("live (CAMPAY_ENV=production)", campayLive());

  console.log("\nA payout: whole XAF, a stable reference, and the token header\n");
  replies = [(u) => u.endsWith("/withdraw/") ? { status: 200, body: { reference: "cp-ref-001", status: "PENDING" } } : null];
  const req = { idempotencyKey: "MMM-2026-418001", provider: "MTN" as const, country: "CM" as const, phone: "+237670000001", xaf: 5000 };
  const out = await campay.disburse(req);
  const w = seen.find((s) => s.url.endsWith("/withdraw/"))!;
  const wb = w.body as { amount: string; to: string; external_reference: string };
  ok("accepted, carrying CamPay's reference", out.status === "accepted" && out.providerRef === "cp-ref-001");
  ok("amount is 5000, NOT 500000 — XAF has no subunit", wb.amount === "5000", wb.amount);
  ok("the number carries the country code", wb.to === "237670000001", wb.to);
  ok("auth is the Token scheme", (w.auth ?? "").startsWith("Token "), (w.auth ?? "").slice(0, 6));
  ok("external_reference is a UUID4", /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(wb.external_reference), wb.external_reference);

  console.log("\nA retry never makes a second payout\n");
  const again = await campay.disburse(req);
  ok("the repeat is reported as a duplicate", again.status === "duplicate");
  ok("…with the same provider reference", again.providerRef === "cp-ref-001");
  ok("…and CamPay was not called twice", seen.filter((s) => s.url.endsWith("/withdraw/")).length === 1);

  console.log("\nA 2xx that is not an acceptance must NOT look like one\n");
  // The sender's crypto is held the moment a payout is accepted. A 200 with no reference
  // has to throw, so the caller refunds rather than stranding it in PAYOUT_REQUESTED.
  replies = [(u) => u.endsWith("/withdraw/") ? { status: 200, body: { status: "PENDING" } } : null];
  let threw = false;
  await campay.disburse({ ...req, idempotencyKey: "MMM-2026-418002" }).catch(() => { threw = true; });
  ok("a 200 without a reference throws", threw);
  replies = [(u) => u.endsWith("/withdraw/") ? { status: 200, body: { reference: "x", status: "FAILED" } } : null];
  threw = false;
  await campay.disburse({ ...req, idempotencyKey: "MMM-2026-418003" }).catch(() => { threw = true; });
  ok("a 200 that already says FAILED throws", threw);

  console.log("\nAn empty carrier float is named as such\n");
  replies = [(u) => u.endsWith("/withdraw/") ? { status: 400, body: { message: "ER301 Insufficient balance" } } : null];
  let msg = "";
  await campay.disburse({ ...req, idempotencyKey: "MMM-2026-418004" }).catch((e: Error) => { msg = e.message; });
  ok("ER301 is reported as a funding problem, not a bad request", /insufficient MTN float/i.test(msg), msg);

  console.log("\nOnly the re-query settles, and it reads the fee off app_amount\n");
  replies = [(u) => u.includes("/transaction/cp-ref-001/")
    ? { status: 200, body: { status: "SUCCESSFUL", amount: "5000", app_amount: "4950" } } : null];
  const st = await campay.queryStatus("MMM-2026-418001");
  ok("SUCCESSFUL → COMPLETED", st === "COMPLETED", String(st));
  ok("the fee is 50 XAF — 1% of 5,000, taken from app_amount", campay.feeXafFor("MMM-2026-418001") === 50, String(campay.feeXafFor("MMM-2026-418001")));
  replies = [() => ({ status: 503, body: { detail: "down" } })];
  ok("an unreachable re-query holds the last status, never invents FAILED", await campay.queryStatus("MMM-2026-418001") === "COMPLETED");

  console.log("\nCallbacks: signed, HS256-pinned, and never trusted for the status\n");
  const KEY = "test-webhook-key-not-a-credential";
  const body = (sig: string) => JSON.stringify({ status: "SUCCESSFUL", reference: "cp-ref-001", endpoint: "withdraw", external_reference: "whatever", signature: sig });
  ok("a correctly signed callback verifies", campay.verifyCallbackSignature(body(jwt({ reference: "cp-ref-001" }, KEY))));
  ok("a callback signed with the wrong key is refused", !campay.verifyCallbackSignature(body(jwt({ reference: "cp-ref-001" }, "not-the-key"))));
  ok("alg=none is refused — the classic JWT hole", !campay.verifyCallbackSignature(body(jwt({ reference: "cp-ref-001" }, KEY, "none"))));
  ok("no signature at all is refused", !campay.verifyCallbackSignature(JSON.stringify({ status: "SUCCESSFUL", endpoint: "withdraw" })));
  ok("a non-JSON body is refused", !campay.verifyCallbackSignature("not json"));

  console.log("\nOne URL, two directions — the dispatch reads `endpoint`\n");
  ok("a withdraw callback is a payout", campay.callbackEndpoint(JSON.stringify({ endpoint: "withdraw" })) === "withdraw");
  ok("a collect callback is a collection", campay.callbackEndpoint(JSON.stringify({ endpoint: "collect" })) === "collect");
  ok("anything else is neither, and must not be guessed", campay.callbackEndpoint(JSON.stringify({ endpoint: "transfer" })) === null);
  const ev = campay.parseCallbackEvents({ reference: "cp-ref-001", endpoint: "withdraw", external_reference: "x" });
  ok("the callback maps back to OUR ref", ev.length === 1 && ev[0].ref === "MMM-2026-418001", JSON.stringify(ev));
  ok("an unknown reference maps to nothing", campay.parseCallbackEvents({ reference: "nope", endpoint: "withdraw" }).length === 0);

  console.log("\nWhat we send differs per flow, and it has to\n");
  replies = [(u) => u.endsWith("/collect/") ? { status: 200, body: { reference: "cp-coll-001", ussd_code: "*126#", operator: "mtn" } } : null];
  await campay.collect({ idempotencyKey: "trf_abc_123", provider: "MTN" as const, country: "CM" as const, phone: "+237670000009", xaf: 2500 });
  const cb = seen.find((x) => x.url.endsWith("/collect/"))!.body as { amount: string; currency: string; from: string; external_reference: string };
  ok("collect sends OUR key verbatim as external_reference", cb.external_reference === "trf_abc_123", cb.external_reference);
  ok("…NOT the derived UUID the withdraw side needs", !/^[0-9a-f]{8}-[0-9a-f]{4}-4/.test(cb.external_reference));
  ok("…because the callback handler finds the transfer BY that field", cb.external_reference === "trf_abc_123");
  ok("collect carries the currency, whole XAF, and the payer", cb.currency === "XAF" && cb.amount === "2500" && cb.from === "237670000009", `${cb.amount} ${cb.currency} ${cb.from}`);

  console.log("\nBalance is per carrier, and unknown is never zero\n");
  replies = [(u) => u.endsWith("/balance/") ? { status: 200, body: { total_balance: 900_000, mtn_balance: 600_000, orange_balance: 300_000 } } : null];
  ok("MTN float", await campay.availableBalanceXaf("CM", "MTN") === 600_000);
  ok("Orange float is read separately", await campay.availableBalanceXaf("CM", "ORANGE") === 300_000);
  campay._resetBalanceCache();   // the 15 s cache would otherwise serve the figures above
  replies = [() => ({ status: 500, body: {} })];
  ok("an unreadable balance is null, not 0 — an unread rail is not a broke one",
    await campay.availableBalanceXaf("CM", "MTN") === null, String(await campay.availableBalanceXaf("CM", "MTN")));

  console.log("\nholder_info: a name, an answer that there is none, and a failure to ask\n");
  replies = [(u) => u.includes("/holder_info/") ? { status: 200, body: { full_name: "JOHN DOE" } } : null];
  ok("a name comes back", await campay.holderInfo("+237670000001") === "JOHN DOE");
  replies = [(u) => u.includes("/holder_info/") ? { status: 404, body: { message: "No name found" } } : null];
  ok("404 is null — an ANSWER about the number", await campay.holderInfo("+237670000001") === null);
  replies = [(u) => u.includes("/holder_info/") ? { status: 200, body: { full_name: "  " } } : null];
  ok("a blank name is null, never a fabricated one", await campay.holderInfo("+237670000001") === null);
  replies = [(u) => u.includes("/holder_info/") ? { status: 403, body: { detail: "nope" } } : null];
  threw = false;
  await campay.holderInfo("+237670000001").catch(() => { threw = true; });
  ok("403 throws — a failure to ASK must never reach a sender as \"not found\"", threw);

  console.log("\nThe identity provider built on it\n");
  const { campayHolder } = await import("../src/core/identityResolution/providers/campay.js");
  const ctx = { purpose: "payment" as const, requestId: "t", actor: "test", timeoutMs: 3000 };
  const nid = { identifier: "+237670000001", nationalNumber: "670000001", e164: "+237670000001" } as never;
  ok("it is authoritative", campayHolder.authoritative);
  ok("it serves CM MTN and Orange", campayHolder.supports("CM", "MTN") && campayHolder.supports("CM", "ORANGE"));
  ok("…and nothing else", !campayHolder.supports("CM", "AIRTEL") && !campayHolder.supports("CI", "MTN"));
  replies = [(u) => u.includes("/holder_info/") ? { status: 200, body: { full_name: "JOHN DOE" } } : null];
  const r1 = await campayHolder.resolve(nid, ctx);
  ok("a name → VERIFIED with the display name", r1.status === "VERIFIED" && r1.displayName === "JOHN DOE");
  // holder_info returns { full_name } and nothing else, so the wallet's standing is UNKNOWN.
  // Reporting ACTIVE here would put a fact in a caller's hands that nobody established.
  ok("…but accountStatus is UNKNOWN — CamPay never said the wallet is open",
    r1.accountStatus === "UNKNOWN", r1.accountStatus);
  replies = [(u) => u.includes("/holder_info/") ? { status: 404, body: { message: "No name found" } } : null];
  const r2 = await campayHolder.resolve(nid, ctx);
  ok("no name → NOT_FOUND, and NOT a fabricated name", r2.status === "NOT_FOUND" && !r2.displayName);
  replies = [(u) => u.includes("/holder_info/") ? { status: 403, body: {} } : null];
  let err: { code?: string; retryable?: boolean } = {};
  await campayHolder.resolve(nid, ctx).catch((e) => { err = e as typeof err; });
  ok("403 is a non-retryable auth error, so the resolver rests it", err.code === "IDENTITY_PROVIDER_AUTH_ERROR" && err.retryable === false, String(err.code));
  replies = [(u) => u.includes("/holder_info/") ? { status: 502, body: {} } : null];
  err = {};
  await campayHolder.resolve(nid, ctx).catch((e) => { err = e as typeof err; });
  ok("5xx is retryable, so the chain can fail over", err.code === "IDENTITY_PROVIDER_UNAVAILABLE" && err.retryable === true, String(err.code));

  console.log("\nIt is in the chain, ahead of the verifier whose host is gone\n");
  const { providerChain } = await import("../src/core/identityResolution/resolver.js");
  const names = providerChain("CM", "MTN").map((p) => p.name);
  ok("campay_holder is in the chain", names.includes("campay_holder"), names.join(" → "));
  ok("peexit_verify is in it too, so the ordering below is a real comparison", names.includes("peexit_verify"), names.join(" → "));
  ok("…and campay_holder comes FIRST — it returns a name, peexit's host does not resolve",
    names.indexOf("campay_holder") < names.indexOf("peexit_verify"), names.join(" → "));

  console.log("\nRegistered as a payout rail and a collection rail\n");
  const { PAYOUTS, payoutByName } = await import("../src/adapters/payouts.js");
  const { COLLECTORS, collectorByName } = await import("../src/adapters/collect.js");
  const pa = payoutByName("campay");
  ok("the payout rail exists", Boolean(pa));
  ok("…serving MTN and Orange only", Boolean(pa?.supports("MTN") && pa?.supports("ORANGE") && !pa?.supports("AIRTEL")));
  ok("…preferred over pawapay, behind peexit", (pa?.priority ?? 99) > (payoutByName("peexit")?.priority ?? 0) && (pa?.priority ?? 99) < (payoutByName("pawapay")?.priority ?? 99));
  ok("…and it verifies its own callbacks", typeof pa?.verifyCallback === "function");
  ok("the collection rail exists", Boolean(collectorByName("campay")));
  ok("…behind peexit, because CamPay's COLLECT fee is the dearer of the two",
    (collectorByName("campay")?.priority ?? 0) > (collectorByName("peexit")?.priority ?? 99));
  ok("every payout rail still has a unique name", new Set(PAYOUTS.map((p) => p.name)).size === PAYOUTS.length);
  ok("every collection rail still has a unique name", new Set(COLLECTORS.map((c) => c.name)).size === COLLECTORS.length);

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
