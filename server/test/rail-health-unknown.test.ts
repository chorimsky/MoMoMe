/* A rail nobody has ever called was reported as a perfect rail.

   Measured on production 2026-10-20, while checking whether Peexit's API was up:

     GET /health/deep → rails: [ { name: "peexit", live: true, eligible: true,
                                   successRate: 1, avgLatencyMs: 320669 }, … ]

   server.peexit.com does not resolve. NXDOMAIN at Google's resolver and at Peexit's own
   authoritative Route 53 nameserver — the hostname has been removed from DNS, so not one
   call has ever completed. The tracker returns 1 from `successRate` when there are zero
   attempts, which is right for the ROUTER (never used is not the same as broken) and a
   lie in every report built on top of it.

   Same principle the delivery report already states in shared/types.ts: "successRatePct is
   null when the provider had no payments in the window: no rate, not 100."

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/rail-health-unknown.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
// A configured-but-sandbox rail is exactly the case under test: configured() so it is
// REPORTED, not live() so nothing here can reach a real API. The value is a fixture.
process.env.PEEXIT_API_KEY = "test-secretkey-not-a-credential";
process.env.PEEXIT_ENV = "sandbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { HealthTracker } = await import("../src/core/railHealth.js");

  console.log("\nThe tracker tells the two apart\n");
  const h = new HealthTracker(["never_called", "worked", "failed"]);
  ok("a rail never called has 0 samples", h.samples("never_called") === 0);
  ok("…and successRate still answers 1, so the router does not demote it", h.successRate("never_called") === 1);
  ok("…and avgLatency is 0, which is not a latency either", h.avgLatency("never_called") === 0);

  h.record("worked", true, 240);
  ok("one success → 1 sample", h.samples("worked") === 1);
  ok("…rate 1, and this one is earned", h.successRate("worked") === 1);
  h.record("failed", false, 0);
  ok("one failure → 1 sample, rate 0", h.samples("failed") === 1 && h.successRate("failed") === 0);
  ok("a rate of 0 is distinguishable from no rate", h.samples("failed") > 0 && h.samples("never_called") === 0);

  console.log("\n/health/deep reports unknown as unknown\n");
  const { createApp } = await import("../src/app.js");
  const server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as { port: number };
  try {
    const body = await (await fetch(`http://127.0.0.1:${port}/health/deep`)).json() as
      { rails?: Array<{ name: string; samples: number; successRate: number | null; avgLatencyMs: number | null }> };
    const rails = body.rails ?? [];
    ok("rails are listed", rails.length > 0, rails.map((r) => r.name).join(", "));
    ok("every rail carries its sample count", rails.every((r) => typeof r.samples === "number"));
    for (const r of rails.filter((x) => x.samples === 0)) {
      ok(`${r.name} has no samples → successRate is null, not 1`, r.successRate === null, String(r.successRate));
      ok(`${r.name} has no samples → avgLatencyMs is null, not 0`, r.avgLatencyMs === null, String(r.avgLatencyMs));
    }
    ok("…and a rail with samples does report a number", rails.every((r) => r.samples === 0 || typeof r.successRate === "number"));

    console.log("\nThe public /v1 health endpoint publishes the same honesty\n");
    // /v1 wraps handler results in its own envelope; accept either shape.
    const raw = await (await fetch(`http://127.0.0.1:${port}/v1/health`)).json() as Record<string, unknown>;
    const pub = (raw.data ?? raw) as { payout_providers?: Array<{ provider: string; success_rate: number | null }> };
    const pp = pub.payout_providers ?? [];
    if (!pp.length) console.log("    (public health body: " + JSON.stringify(raw).slice(0, 200) + ")");
    ok("payout_providers are listed", pp.length > 0);
    ok("no provider claims a rate it has not earned", pp.every((x) => x.success_rate === null || (x.success_rate >= 0 && x.success_rate <= 1)));
    const unproven = rails.filter((r) => r.samples === 0).map((r) => r.name);
    ok("an unproven rail publishes success_rate: null",
      pp.filter((x) => unproven.includes(x.provider)).every((x) => x.success_rate === null),
      unproven.join(", ") || "none unproven");
  } finally { server.close(); }

  console.log("\nThe DOWN alert does not say \"success 100 %\" about a rail never reached\n");
  const { conditions } = await import("../src/core/alerts.js");
  const { setAggregatorUp } = await import("../src/core/routing.js");
  setAggregatorUp("peexit", false);
  const railAlerts = (await conditions()).filter((c) => c.key.startsWith("rail:"));
  if (railAlerts.length) {
    ok("it does not claim a success percentage", !/success \d+ %/.test(railAlerts[0].body), railAlerts[0].body.slice(0, 120));
    ok("…it says the rail was never reached", /never|not one call/i.test(railAlerts[0].body));
  } else {
    ok("a forced-down configured rail raises an alert", false, "no rail alert — peexit is not configured in sandbox");
  }
  setAggregatorUp("peexit", true);

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
