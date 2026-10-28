/* The operator's cash-out / cash-in must use a rail that ANSWERS.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/momo-ops-rails.test.ts

   What this encodes: railFor() returned the literal string "peexit" for every operation.
   Fine while Peexit was the only rail — until its hostname was withdrawn from DNS, after
   which every operator cash-out and cash-in went to Peexit regardless of what the console
   offered, and came back "Rail rejected the operation — fetch failed". CamPay was live,
   funded and answering, and could not be reached from this tool at all. The phrasing made
   it worse: nothing had rejected anything, because nothing had been reached. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "momo-ops-rails-test";
// Peexit: live, and its host does not resolve — exactly production.
process.env.PEEXIT_API_KEY = "test-peexit-key";
process.env.PEEXIT_ENV = "production";
process.env.PEEXIT_CALLBACK_PASS = "test-callback-pass";
process.env.PEEXIT_API_URL = "https://server.peexit.invalid/api/v1";
// CamPay: live, answering, funded.
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-real-credential";
process.env.CAMPAY_WEBHOOK_KEY = "test-webhook-key";
process.env.CAMPAY_ENV = "production";
process.env.CAMPAY_API_URL = "https://campay.test.invalid/api";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

let campayUp = true;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (url.includes("peexit.invalid")) throw new TypeError("fetch failed");          // the dead vendor
  if (url.includes("campay.test.invalid")) {
    if (!campayUp) throw new TypeError("fetch failed");
    if (url.includes("/balance/")) return J({ total_balance: 500000, mtn_balance: 300000, orange_balance: 200000 });
    if (url.includes("/withdraw/")) return J({ reference: "cp_wd_1", status: "PENDING" });
    if (url.includes("/collect/")) return J({ reference: "cp_col_1", status: "PENDING" });
    return J({});
  }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const momo = await import("../src/core/momoOps.js");
  const campay = await import("../src/adapters/campay.js");

  console.log("\nA cash-out is carried by the rail that answers\n");
  campay._resetBalanceCache();
  const out = await momo.cashout("237670000123", "CM", 5000, "tester", "Test Recipient");
  ok("the cash-out is accepted", out.ok === true, out.error ?? "");
  ok("…and it went via CamPay, not the dead rail", out.op?.rail === "campay", String(out.op?.rail));

  console.log("\nA cash-in likewise\n");
  campay._resetBalanceCache();
  const inn = await momo.cashin("237670000124", "CM", 3000, "tester", "Test Payer");
  ok("the cash-in is accepted", inn.ok === true, inn.error ?? "");
  ok("…and it went via CamPay", inn.op?.rail === "campay", String(inn.op?.rail));

  console.log("\nThe treasury view shows the float that exists\n");
  campay._resetBalanceCache();
  const bals = await momo.balances("CM");
  const labels = bals.map((b) => b.label);
  ok("CamPay's per-carrier float is listed", labels.some((l) => /CamPay.*MTN/.test(l)) && labels.some((l) => /CamPay.*Orange/.test(l)), labels.join(" | "));
  const mtn = bals.find((b) => /CamPay.*MTN/.test(b.label));
  ok("…with a real figure, not a guess", mtn?.balanceXaf === 300000, String(mtn?.balanceXaf));
  const px = bals.find((b) => /Peexit payout/.test(b.label));
  ok("an unreachable wallet reads UNKNOWN, never 0", px?.balanceXaf === null, String(px?.balanceXaf));

  console.log("\nWith nothing reachable, say that — do not blame the rail\n");
  campayUp = false; campay._resetBalanceCache();
  const none = await momo.cashin("237670000125", "CM", 1000, "tester");
  ok("cash-in refuses with rail_unavailable", none.ok === false && none.error === "rail_unavailable", String(none.error));
  // The bug in the words, not just the routing: "Rail rejected the operation — fetch failed"
  // claims a rail answered and said no. Nothing answered.
  ok("…and NOT a raw transport error presented as a rejection", !/fetch failed/.test(none.error ?? ""), String(none.error));
  campay._resetBalanceCache();
  const noneOut = await momo.cashout("237670000126", "CM", 1000, "tester");
  ok("cash-out refuses the same way", noneOut.ok === false && noneOut.error === "rail_unavailable", String(noneOut.error));

  console.log("\nThe operator is told which of the two happened\n");
  const { momoErrMessage } = await import("../src/routes/api.js");
  const unreachable = momoErrMessage("fetch failed");
  ok("a transport failure is not called a rejection", !/rejected/i.test(unreachable), unreachable);
  ok("…it says nothing answered", /couldn't reach|nothing answered/i.test(unreachable), unreachable);
  // Never invite a blind retry: a failed fetch can still have been RECEIVED, and this tool
  // moves real money.
  ok("…and does not claim the operation did not happen", !/nothing was (sent|submitted)/i.test(unreachable), unreachable);
  const rejected = momoErrMessage("INSUFFICIENT_FUND_TO_PAY_TX");
  ok("a real refusal is still reported as a rejection", /rejected the operation/i.test(rejected), rejected);

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
