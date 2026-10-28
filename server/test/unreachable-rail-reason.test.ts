/* A payout rail we cannot REACH must not be reported to the sender as a rail we cannot
   AFFORD. Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/unreachable-rail-reason.test.ts

   The live case this reproduces: Peexit's API hostname stopped resolving. Nothing had
   attempted a payout since, so the health tracker still called the rail eligible with a
   success rate of 1, and the send flow told senders "no funded payout rail" — which reads
   as "MoMo›Me is out of money" — while naming peexit to them as the rail that would carry
   their payment. Three separate untruths from one dead vendor. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "unreachable-rail-test";
// A LIVE peexit: this is what makes liveMoney() true, so the flow demands a real rail
// instead of accepting the simulator (which would mask the whole question).
process.env.PEEXIT_API_KEY = "test-secret-key";
process.env.PEEXIT_ENV = "production";
process.env.PEEXIT_CALLBACK_PASS = "test-callback-pass";
process.env.PEEXIT_API_URL = "https://server.peexit.invalid/api/v1";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const realFetch = globalThis.fetch;
let peexitCalls = 0;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  const J = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  // Exactly what a vanished host does: the fetch rejects before any HTTP status exists.
  if (url.includes("peexit.invalid")) { peexitCalls++; throw new TypeError("fetch failed"); }
  if (url.includes("coinbase.com") && url.includes("BTC-USD")) return J({ data: { amount: "65000.00" } });
  if (url.includes("coinbase.com") && url.includes("exchange-rates")) return J({ data: { rates: { USD: "1.08", XAF: "607" } } });
  if (url.includes("kraken.com")) return J({ result: { XXBTZUSD: { c: ["65010.0", "0.01"] } } });
  if (url.includes("open.er-api.com")) return J({ rates: { XAF: 606 } });
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const { discoverRoutes } = await import("../src/core/interop/router.js");
  const { liveMoney, peexitLive } = await import("../src/config.js");
  const { payoutHealth } = await import("../src/core/routing.js");
  const { ensureFreshRates } = await import("../src/jobs.js");
  await ensureFreshRates().catch(() => {});

  console.log("\nPreconditions — a live rail whose host does not resolve\n");
  ok("peexit is live", peexitLive());
  ok("the deployment counts as live money", liveMoney());
  // The whole point: the tracker has nothing against this rail. It has never been asked to
  // pay anyone, so it looks perfect — which is why the UI trusted it.
  ok("the health tracker still calls peexit eligible", payoutHealth("peexit").eligible,
    `successRate ${payoutHealth("peexit").successRate}, samples ${payoutHealth("peexit").samples}`);

  const dest = {
    id: "phone:237670000001", type: "PHONE" as const, value: "237670000001",
    owner: { displayName: "Test Recipient", nameVerified: false, kind: "person" as const },
    verified: true, country: "CM" as const, currency: "XAF",
    rails: [{ rail: "mobile_money" as const, provider: "MTN", currency: "XAF", available: true }],
    defaultRail: "mobile_money" as const, status: "ACTIVE" as const,
    limits: { currency: "XAF", min: 500, max: 1_000_000 },
  };
  const now = new Date().toISOString();
  const intent = {
    id: "pi_test", owner: "dev_test", destination: dest, amount: 5000,
    destinationCurrency: "XAF", sourceCurrency: null, preferredMethod: "LIGHTNING" as const,
    availableRoutes: [], routeId: null, paymentId: null, paymentRef: null,
    status: "ROUTING" as const, riskStatus: "unknown" as const, complianceStatus: "unknown" as const,
    createdAt: now, updatedAt: now,
  };
  const buildQuote = async () => ({ status: 503, body: { error: "unavailable", message: "no quote in this test" } });

  const routes = await discoverRoutes(intent, dest, buildQuote);
  const route = routes[0];
  const check = (n: string) => route.checks.find((c) => c.name === n);

  console.log("\nWhat the sender is told\n");
  ok("peexit's balance was actually attempted", peexitCalls > 0, `${peexitCalls} call(s)`);
  ok("the route is not viable", !route.viable);

  const op = check("payout_rail_operational");
  ok("a rail we cannot read is NOT reported operational", op?.ok === false, `detail: ${op?.detail}`);
  ok("and the reason names it unreachable", /unreachable/.test(op?.detail ?? ""), op?.detail);

  const liq = check("liquidity");
  ok("liquidity does not claim we are merely unfunded", !/^no funded payout rail$/.test(liq?.detail ?? ""), liq?.detail);
  ok("liquidity says the rail could not be reached", /not reachable|no payout rail reachable/.test(liq?.detail ?? ""), liq?.detail);
  ok("and it names which rail", /peexit/.test(liq?.detail ?? ""), liq?.detail);

  console.log("\nThe route shown to the sender\n");
  const destStep = route.steps.find((s) => s.role === "destination");
  ok("an unreachable rail is not named as the destination party", !/peexit/.test(destStep?.party ?? ""), destStep?.party);
  ok("nor as the destination provider", destStep?.provider !== "peexit", String(destStep?.provider));

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
