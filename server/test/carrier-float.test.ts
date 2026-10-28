/* Money in the account is not money on the float the payout debits.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/carrier-float.test.ts

   The live case: CamPay's account held 4 900 XAF while the MTN and Orange floats it
   actually debits held almost nothing. /health/deep read the TOTAL — it called
   p.balance("CM") with no carrier — and reported "4 900 XAF, routable". The router reads
   the CARRIER float, because that is what CamPay debits (ER301 is "insufficient balance
   for the specific carrier"), and refused every payment. The operator saw a healthy
   balance and an unexplained "payouts to this number aren't available right now".

   Two things have to be true: the console must report the figure the router gates on, and
   the refusal must name the carrier that is short. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "carrier-float-test";
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-real-credential";
process.env.CAMPAY_WEBHOOK_KEY = "test-webhook-key";
process.env.CAMPAY_ENV = "production";
process.env.CAMPAY_API_URL = "https://campay.carrier.invalid/api";
process.env.HEALTH_DETAIL_TOKEN = "carrier-float-detail-token";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (url.includes("campay.carrier.invalid")) {
    // Exactly the shape production returned.
    if (url.includes("/balance/")) return J({ total_balance: 4900, mtn_balance: 0, orange_balance: 0 });
    return J({});
  }
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com")) return J({ data: { rates: { USD: "1.08", XAF: "607" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  if (url.includes("open.er-api.com")) return J({ rates: { XAF: 606 } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const campay = await import("../src/adapters/campay.js");
  const { campayConfigured, campayLive } = await import("../src/config.js");
  campay._resetBalanceCache();

  console.log("\nThe two readings that disagreed\n");
  ok("campay is live", campayConfigured() && campayLive());
  const total = await campay.availableBalanceXaf("CM");
  const mtn = await campay.availableBalanceXaf("CM", "MTN");
  const orange = await campay.availableBalanceXaf("CM", "ORANGE");
  ok("the account total reads 4 900", total === 4900, String(total));
  ok("the MTN float reads 0", mtn === 0, String(mtn));
  ok("the Orange float reads 0", orange === 0, String(orange));
  // This is the whole bug in one line: the console asked the first question, the router
  // asked the second, and only one of them decides whether a payment can go.
  ok("the total is NOT what a payout can spend", total !== mtn && (mtn ?? 0) === 0, `total=${total} mtn=${mtn}`);

  console.log("\nThe router refuses, correctly\n");
  const { payoutReady } = await import("../src/core/routing.js");
  const r = await payoutReady("MTN", "CM", 1000, true);
  ok("a 1 000 XAF payout is refused", r.ok === false, String(r.reason));
  ok("…as an empty float, not an unreachable rail", r.reason === "insufficient_rail_balance", String(r.reason));

  console.log("\nThe deep probe names the misconfiguration\n");
  const { createApp } = await import("../src/app.js");
  const { AddressInfo } = await import("node:net") as unknown as { AddressInfo: unknown };
  void AddressInfo;
  const server = createApp().listen(0);
  await new Promise<void>((res) => server.once("listening", () => res()));
  const port = (server.address() as { port: number }).port;
  const h = await (await fetch(`http://127.0.0.1:${port}/health/deep`, { headers: { "x-health-token": "carrier-float-detail-token" } })).json() as Record<string, any>;
  server.close();
  const rail = (h.rails ?? []).find((x: { name: string }) => x.name === "campay");
  ok("the rail reports its per-carrier floats", rail && rail.byProvider && rail.byProvider.MTN === 0, JSON.stringify(rail?.byProvider));
  ok("spendable is 0, not 4 900", rail?.spendableXaf === 0, String(rail?.spendableXaf));
  ok("…so the rail is NOT called routable", rail?.routable === false, String(rail?.routable));
  ok("and the problem is named for the operator", (h.problems ?? []).some((p: string) => /not allocated to a carrier float/.test(p)), JSON.stringify(h.problems));
  // A rail that serves NO corridor has no carrier float to strand money on. Reporting it
  // as a funding misconfiguration is noise, and it false-alarmed the deploy gate.
  const strandedMsg = (h.problems ?? []).find((p: string) => /not allocated to a carrier float/.test(p)) ?? "";
  ok("a rail that supports no corridor is NOT called stranded", !/pawapay/i.test(strandedMsg), strandedMsg);

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
