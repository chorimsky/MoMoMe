/* The collection rail must be able to say whether it is reachable.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/campay-collect-health.test.ts

   CamPay's collector had no health() at all, so collectHealth() reported ok: null — and
   /health/deep raises a problem only for ok === false. While Peexit's hostname was gone
   CamPay was the ONLY collection rail we had, and it was the one the probe could not see:
   it could have been rejecting every call and production would have reported nothing
   wrong. Unknown is not healthy. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "campay-collect-health-test";
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-real-credential";
process.env.CAMPAY_WEBHOOK_KEY = "test-webhook-key";
process.env.CAMPAY_ENV = "production";
process.env.CAMPAY_API_URL = "https://campay.test.invalid/api";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

type Mode = "ok" | "401" | "down";
let mode: Mode = "ok";
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  if (url.includes("campay.test.invalid")) {
    if (mode === "down") throw new TypeError("fetch failed");
    if (mode === "401") return new Response("Invalid token", { status: 401 });
    return new Response(JSON.stringify({ total_balance: 12000, mtn_balance: 7000, orange_balance: 5000 }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const campay = await import("../src/adapters/campay.js");
  const { collectHealth } = await import("../src/adapters/collect.js");
  const health = async () => (await collectHealth()).find((c) => c.name === "campay")!;

  console.log("\nBefore any call — nothing is known, and nothing is claimed\n");
  const h0 = await health();
  ok("an un-probed rail is not reported DOWN", h0.ok !== false, `ok=${h0.ok}`);

  console.log("\nA reachable, authenticating CamPay\n");
  mode = "ok"; campay._resetBalanceCache(); campay._resetReachability();
  const bal = await campay.availableBalanceXaf("CM");
  ok("the balance reads", bal === 12000, String(bal));
  const h1 = await health();
  ok("the collection rail reports healthy", h1.ok === true, `ok=${h1.ok} note=${h1.note}`);

  console.log("\nCamPay rejects our token\n");
  mode = "401"; campay._resetBalanceCache();
  ok("the balance is UNKNOWN, not zero", (await campay.availableBalanceXaf("CM")) === null);
  const h2 = await health();
  ok("the collection rail reports DOWN", h2.ok === false, `ok=${h2.ok}`);
  ok("and says the token was rejected", /token/i.test(h2.note ?? ""), h2.note);

  console.log("\nCamPay unreachable\n");
  mode = "down"; campay._resetBalanceCache();
  ok("the balance is UNKNOWN, not zero", (await campay.availableBalanceXaf("CM")) === null);
  const h3 = await health();
  ok("the collection rail reports DOWN", h3.ok === false, `ok=${h3.ok}`);
  ok("and says it was unreachable", /unreachable/.test(h3.note ?? ""), h3.note);

  console.log("\nRecovery is observed, not assumed\n");
  mode = "ok"; campay._resetBalanceCache();
  await campay.availableBalanceXaf("CM");
  const h4 = await health();
  ok("a rail that comes back reports healthy again", h4.ok === true, `ok=${h4.ok} note=${h4.note}`);

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
