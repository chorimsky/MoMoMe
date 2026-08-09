/* ============================================================
   HealthTracker unit + parity test.
   Guards the shared availability/failover module (core/railHealth.ts) that
   BOTH the payout router (routing.ts) and the crypto-inbound registry
   (adapters/index.ts) delegate to — the behaviour extracted verbatim from
   the original routing.ts must be preserved.
   Run: pnpm --filter @momome/server test:health
   ============================================================ */
import assert from "node:assert/strict";
import { HealthTracker } from "../src/core/railHealth.js";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

console.log("\nHealthTracker — 3-strikes / probe-cooldown / recovery");

// Fresh rail: up, eligible, perfect success rate, zero latency.
{
  const h = new HealthTracker(["a", "b"], { probeCooldownMs: 10 * 60_000 });
  ok("fresh rail is up", h.isUp("a"));
  ok("fresh rail is eligible", h.eligible("a"));
  ok("fresh successRate = 1", h.successRate("a") === 1);
  ok("fresh avgLatency = 0", h.avgLatency("a") === 0);
}

// 3 strikes → out; still eligible after 2, out after 3 (long cooldown = not eligible).
{
  const h = new HealthTracker(["a"], { probeCooldownMs: 10 * 60_000 });
  h.record("a", false); h.record("a", false);
  ok("2 failures: still up", h.isUp("a"));
  ok("2 failures: still eligible", h.eligible("a"));
  h.record("a", false); // third strike
  ok("3 failures: down", !h.isUp("a"));
  ok("3 failures: not eligible during cooldown", !h.eligible("a"));
  // A success recovers immediately and resets the streak.
  h.record("a", true, 50);
  ok("success recovers to up", h.isUp("a"));
  ok("success clears cooldown → eligible", h.eligible("a"));
}

// Probe allowed once the cooldown elapses (cooldown 0 = eligible immediately after down).
{
  const h = new HealthTracker(["a"], { probeCooldownMs: 0 });
  h.record("a", false); h.record("a", false); h.record("a", false);
  ok("down but past-cooldown → eligible (one probe)", h.eligible("a"));
}

// Hard down = one strike, immediate out.
{
  const h = new HealthTracker(["a"], { probeCooldownMs: 10 * 60_000 });
  h.markHardDown("a");
  ok("hard-down: down after ONE strike", !h.isUp("a"));
  ok("hard-down: not eligible during cooldown", !h.eligible("a"));
}

// Admin force up/down.
{
  const h = new HealthTracker(["a"], { probeCooldownMs: 10 * 60_000 });
  h.setUp("a", false);
  ok("setUp(false) → down + not eligible", !h.isUp("a") && !h.eligible("a"));
  h.setUp("a", true);
  ok("setUp(true) → up + eligible", h.isUp("a") && h.eligible("a"));
}

// Success rate + latency maths.
{
  const h = new HealthTracker(["a"], { probeCooldownMs: 10 * 60_000 });
  h.record("a", true, 100); h.record("a", true, 200); h.record("a", true, 300); h.record("a", false);
  ok("successRate 3/4 = 0.75", h.successRate("a") === 0.75, String(h.successRate("a")));
  ok("avgLatency = 200 (avg of 100/200/300)", h.avgLatency("a") === 200, String(h.avgLatency("a")));
  const c = h.counts("a");
  ok("counts = 3 success / 1 failure", c.success === 3 && c.failure === 1);
}

// dump/load round-trips (persistence parity).
{
  const h = new HealthTracker(["a", "b"], { probeCooldownMs: 10 * 60_000 });
  h.record("a", true, 100); h.record("b", false); h.record("b", false); h.record("b", false);
  const snap = h.dump();
  const h2 = new HealthTracker(["a", "b"], { probeCooldownMs: 10 * 60_000 });
  h2.load(snap);
  ok("load restores up-state", h2.isUp("a") && !h2.isUp("b"));
  ok("load restores counts", h2.counts("a").success === 1 && h2.counts("b").failure === 3);
  // Unknown rail in snapshot is added on load (forward-compatible persistence).
  const h3 = new HealthTracker([], { probeCooldownMs: 10 * 60_000 });
  h3.load({ z: { success: 5, failure: 0, totalLatencyMs: 0, consecFail: 0, up: true, downSince: 0 } });
  ok("load adds unknown rail", h3.counts("z").success === 5);
}

console.log(`\n✅ ${passed} assertions passed`);
