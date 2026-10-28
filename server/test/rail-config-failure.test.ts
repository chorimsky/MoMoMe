/* A refused key or a non-allowlisted egress is not a blip — stop asking every few seconds.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/rail-config-failure.test.ts

   Peexit's balance read returned 403 every 15 seconds for four days. The rail stayed
   "eligible" the whole time, because the health tracker only learns from payout ATTEMPTS
   and nothing had attempted one since the vendor's host changed. The log filled with the
   same line, every call was wasted, and the console went on presenting the rail as usable.

   401 (key refused) and 403 (IP not allowlisted) are OUR configuration: no retry fixes
   them. They take the rail out, and the tracker's probe cooldown reopens it periodically.
   A timeout or a 5xx must NOT — those are transient, and taking a rail out for one would
   be the opposite mistake. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "rail-config-failure-test";
process.env.CAMPAY_PERMANENT_TOKEN = "test-token-not-a-real-credential";
process.env.CAMPAY_WEBHOOK_KEY = "test-webhook-key";
process.env.CAMPAY_ENV = "production";
process.env.CAMPAY_API_URL = "https://campay.test.invalid/api";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

type Mode = "ok" | "403" | "500";
let mode: Mode = "ok";
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: unknown) => {
  const url = String((input as { url?: string })?.url ?? input);
  if (url.includes("campay.test.invalid")) {
    calls++;
    if (mode === "403") return new Response("<html>403 Forbidden</html>", { status: 403 });
    if (mode === "500") return new Response("upstream error", { status: 500 });
    return new Response(JSON.stringify({ total_balance: 90000, mtn_balance: 50000, orange_balance: 40000 }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return realFetch(input as RequestInfo, init as RequestInit);
}) as typeof fetch;

async function main() {
  const campay = await import("../src/adapters/campay.js");
  const routing = await import("../src/core/routing.js");
  const { setAggregatorUp } = routing;

  const reset = () => { campay._resetBalanceCache(); campay._resetReachability(); setAggregatorUp("campay", true); };

  console.log("\nA healthy rail stays in rotation\n");
  mode = "ok"; reset();
  await routing.payoutReady("MTN", "CM", 1000, true);
  ok("campay is eligible", routing.payoutHealth("campay").eligible);

  console.log("\n403 — our egress is not allowlisted. No retry fixes that.\n");
  mode = "403"; reset();
  await routing.payoutReady("MTN", "CM", 1000, true);
  ok("the rail is taken out of rotation", routing.payoutHealth("campay").eligible === false);
  // The whole point: the next payment must not re-ask.
  const before = calls;
  await routing.payoutReady("MTN", "CM", 1000, true);
  await routing.payoutReady("MTN", "CM", 1000, true);
  ok("…and is not called again while it rests", calls === before, `${calls - before} further call(s)`);

  console.log("\nA 5xx is transient and must NOT take a rail out\n");
  mode = "500"; reset();
  await routing.payoutReady("MTN", "CM", 1000, true);
  ok("campay stays eligible after a server error", routing.payoutHealth("campay").eligible === true);
  ok("…and is still being asked", calls > 0);

  console.log("\nThe refusal is still honest about what it was\n");
  mode = "403"; reset();
  const r = await routing.payoutReady("MTN", "CM", 1000, true);
  ok("payoutReady refuses", r.ok === false, String(r.reason));
  // "rails_down" or "rail_unreachable" — either is true; "insufficient_rail_balance" is NOT,
  // and that is the claim this whole line of work exists to prevent.
  ok("…and never calls it an empty wallet", r.reason !== "insufficient_rail_balance", String(r.reason));

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
