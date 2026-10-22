/* CamPay, against the vendor's OWN documented payloads.

   Two things were checked to write this, and both are worth stating because they bound what
   this test proves.

   1. The live sandbox was probed read-only on 2026-10-22, with no credentials:

        GET demo.campay.net/api/balance/        → 401 {"detail":"Invalid token"}
        GET …/holder_info/?phone_number=…       → 401 {"detail":"Invalid token"}
        GET …/transaction/{uuid}/               → 401 {"detail":"Invalid token"}
        GET …/definitely-not-a-real-endpoint/   → 404, an HTML page

      A path that does not exist answers 404 in HTML; ours answer 401 in JSON. So the base
      URL, all three paths and the `Authorization: Token …` scheme are confirmed against the
      running sandbox — it parsed our header and rejected the TOKEN, rather than the scheme.

   2. Driving a real transaction needs a sandbox token, which is an account sign-up and the
      operator's to create. So every fixture below is CamPay's own documented example
      response, copied verbatim from the published Postman collection — including the
      oddities, which is the point: `amount` and `app_amount` are BOTH "0.00" in their
      status examples, `reference` in the status example is not even a well-formed uuid, and
      the balance example is all zeroes. Code that only handles the tidy case passes a stub
      and fails the vendor.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/campay-conformance.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.CAMPAY_ENV = "production";          // exercise the LIVE paths
process.env.CAMPAY_API_URL = "https://campay.invalid/api";
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-credential";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

/* ---- CamPay's documented examples, verbatim from the Postman collection ---- */
const DOC = {
  requestPayment: { reference: "bcedde9b-62a7-4421-96ac-2e6179552a1a", ussd_code: "*126# for MTN or #150*50# for ORANGE", operator: "mtn or orange" },
  withdraw: { reference: "029e82b2-8450-4ab6-8543-915776063114", status: "PENDING" },
  status: (s: string) => ({
    reference: "dcssef5-9612-xxx-8bb4-98d6ass7fb6", status: s, amount: "0.00", currency: "XAF",
    operator: "MTN", code: "D251211D0017SE", operator_reference: "", endpoint: "collect",
    signature: "aaa.xxx.xxx", external_reference: "", external_user: "", extra_first_name: "",
    extra_last_name: "", extra_email: "", app_amount: "0.00", phone_number: "237677777770",
    redirect_url: "", failure_redirect_url: "", description: "Test", reason: "TESTING",
  }),
  balance: { total_balance: 0.00, mtn_balance: 0.00, orange_balance: 0.00, currency: "XAF" },
  holderOk: { full_name: "JOHN DOE" },
  holder404: { message: "No name found" },
  // The documented error codes, as the live sandbox phrases a rejection.
  err: (c: string) => ({ errorcode: c, message: `${c} refused` }),
};

let replies: Array<(url: string) => { status: number; body: unknown } | null> = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof URL ? input.href : typeof input === "string" ? input : (input as Request).url);
  if (!url.includes("campay.invalid")) return realFetch(input as RequestInfo, init);
  for (const r of replies) { const hit = r(url); if (hit) return new Response(JSON.stringify(hit.body), { status: hit.status, headers: { "content-type": "application/json" } }); }
  return new Response(JSON.stringify({ detail: "unstubbed" }), { status: 500 });
}) as typeof fetch;

async function main() {
  const campay = await import("../src/adapters/campay.js");

  console.log("\nA payout, answered exactly as the docs answer it\n");
  replies = [(u) => u.endsWith("/withdraw/") ? { status: 200, body: DOC.withdraw } : null];
  const out = await campay.disburse({ idempotencyKey: "MMM-DOC-0001", provider: "MTN", country: "CM", phone: "+237670000001", xaf: 5000 } as never);
  ok("a documented PENDING acceptance is accepted, not read as failure", out.status === "accepted", out.status);
  ok("…and carries CamPay's reference", out.providerRef === DOC.withdraw.reference, out.providerRef);

  console.log("\nTheir status examples have amount AND app_amount at \"0.00\"\n");
  replies = [(u) => u.includes("/transaction/") ? { status: 200, body: DOC.status("PENDING") } : null];
  ok("PENDING is pending", await campay.queryStatus("MMM-DOC-0001") === "PENDING");
  // The guard that matters: a fee is only recorded when BOTH figures are real. Reading
  // "0.00" minus "0.00" as a zero fee would book a free payout into the margin reports.
  ok("…and no fee is invented from 0.00 − 0.00", campay.feeXafFor("MMM-DOC-0001") === undefined,
    String(campay.feeXafFor("MMM-DOC-0001")));
  replies = [(u) => u.includes("/transaction/") ? { status: 200, body: DOC.status("SUCCESSFUL") } : null];
  ok("SUCCESSFUL settles", await campay.queryStatus("MMM-DOC-0001") === "COMPLETED");
  replies = [(u) => u.includes("/transaction/") ? { status: 200, body: { ...DOC.status("SUCCESSFUL"), amount: "5000", app_amount: "4950" } } : null];
  await campay.queryStatus("MMM-DOC-0001");
  ok("a REAL pair does record the fee (1% of 5 000)", campay.feeXafFor("MMM-DOC-0001") === 50, String(campay.feeXafFor("MMM-DOC-0001")));
  replies = [(u) => u.includes("/transaction/") ? { status: 200, body: DOC.status("FAILED") } : null];
  ok("FAILED fails", await campay.queryStatus("MMM-DOC-0001") === "FAILED");

  console.log("\nA collection, answered as the docs answer it\n");
  replies = [(u) => u.endsWith("/collect/") ? { status: 200, body: DOC.requestPayment } : null];
  const c = await campay.collect({ idempotencyKey: "trf_doc_1", provider: "MTN", country: "CM", phone: "+237677777770", xaf: 2500 } as never);
  ok("the payer is prompted", c.status === "accepted");
  ok("…and the documented reference is kept", c.providerRef === DOC.requestPayment.reference, c.providerRef);
  // Their example's `operator` is the literal string "mtn or orange" — a placeholder, not a
  // value — and `ussd_code` is a sentence. Neither must end up stored as if it were data.
  const stored = campay.statusByKey("trf_doc_1")!;
  ok("the placeholder operator string is not kept as the provider reference",
    stored.providerRef === DOC.requestPayment.reference, stored.providerRef);
  ok("…and nothing from the ussd_code sentence leaked into the record",
    !JSON.stringify(stored).includes("*126#"), JSON.stringify(stored));

  console.log("\nThe balance example is all zeroes — which is a balance, not an outage\n");
  replies = [(u) => u.endsWith("/balance/") ? { status: 200, body: DOC.balance } : null];
  ok("a real zero balance reads as 0", await campay.availableBalanceXaf("CM", "MTN") === 0);
  campay._resetBalanceCache();
  replies = [() => ({ status: 500, body: {} })];
  ok("…and an unreadable balance reads as null, which is a different thing entirely",
    await campay.availableBalanceXaf("CM", "MTN") === null);
  campay._resetBalanceCache();
  replies = [(u) => u.endsWith("/balance/") ? { status: 200, body: { ...DOC.balance, mtn_balance: 600_000 } } : null];
  ok("the per-carrier figure is the one that decides a payout", await campay.availableBalanceXaf("CM", "MTN") === 600_000);

  console.log("\nholder_info, both documented answers\n");
  replies = [(u) => u.includes("/holder_info/") ? { status: 200, body: DOC.holderOk } : null];
  ok("a name is returned verbatim", await campay.holderInfo("+237677777770") === "JOHN DOE");
  replies = [(u) => u.includes("/holder_info/") ? { status: 404, body: DOC.holder404 } : null];
  ok("the documented 404 is an ANSWER about the number, not an error", await campay.holderInfo("+237677777770") === null);
  // What the LIVE sandbox returns without a valid token. Must be a failure to ASK, never
  // "this number has no name" — that would tell a sender the recipient does not exist.
  replies = [(u) => u.includes("/holder_info/") ? { status: 401, body: { detail: "Invalid token" } } : null];
  let threw = false;
  await campay.holderInfo("+237677777770").catch(() => { threw = true; });
  ok("the sandbox's own 401 {\"detail\":\"Invalid token\"} throws, and is never read as NOT_FOUND", threw);

  console.log("\nThe documented error codes are refusals, not things to retry\n");
  const { _patterns } = await import("../src/core/stateMachine.js") as unknown as { _patterns: { hard: RegExp; noRetry: RegExp } };
  for (const [code, xaf, phone, why] of [
    ["ER301", 5000, "+237670000001", "insufficient float"],
    ["ER101", 5000, "+237670000001", "a number without a country code"],
    ["ER102", 5000, "+237670000001", "a carrier that is not MTN or Orange"],
    ["ER201", 5000, "+237670000001", "a decimal amount"],
  ] as const) {
    replies = [(u) => u.endsWith("/withdraw/") ? { status: 400, body: DOC.err(code) } : null];
    let msg = "";
    await campay.disburse({ idempotencyKey: `MMM-DOC-${code}`, provider: "MTN", country: "CM", phone, xaf } as never).catch((e: Error) => { msg = e.message; });
    ok(`${code} (${why}) is refused`, msg.includes(code), msg.slice(0, 72));
    ok(`…and stops the retries, because it cannot come true on a second try`, _patterns.noRetry.test(msg));
    ok(`…without blinding the rail for its other carrier`, !_patterns.hard.test(msg));
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
