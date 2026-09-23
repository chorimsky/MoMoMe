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

/* An operator's switch is not a probe candidate.
   Both of these were live: the probe cooldown applied to a manual switch-off just as it did
   to an automatic one, so a rail an operator took out came back by itself after ten minutes;
   and setUp(false) only stamped downSince when it was still 0, so switching off a rail that
   had failed earlier left a stale timestamp — often already past the cooldown, which made the
   switch a no-op. A payout or a refund would then be sent to a rail the operator had
   explicitly turned off. */
{
  const h = new HealthTracker(["a"], { probeCooldownMs: 0 });   // cooldown elapses at once
  h.setUp("a", false);
  ok("a rail an operator switched off does NOT come back when the cooldown elapses", !h.eligible("a"));
  h.record("a", true, 10);
  ok("…nor when something reports a success for it", !h.eligible("a") && !h.isUp("a"));
  h.setUp("a", true);
  ok("…and the operator switching it back on is what returns it to rotation", h.eligible("a") && h.isUp("a"));
}
{
  const h = new HealthTracker(["a"], { probeCooldownMs: 10 * 60_000 });
  h.record("a", false); h.record("a", false); h.record("a", false);   // an OLD automatic down
  const old = h.dump().a.downSince;
  h.setUp("a", false);
  ok("switching off a rail that was already down re-stamps the cooldown", h.dump().a.downSince >= old);
  ok("…and it stays out however long ago that first failure was", !h.eligible("a"));
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
