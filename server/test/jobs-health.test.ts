/* ============================================================
   Starting up is not the same as stopped.

   The jobs loop first fires 30 s after boot. /health/deep is read by the deploy gate within
   seconds of the process answering, and `stale` treated "has never ticked" exactly like
   "ticked, but long ago" — so every fresh deploy reported "money jobs have not completed in
   the last 3 minutes". True, and meaningless: a process up for ten seconds has not FAILED
   to tick, it has not had the chance. It cost a deploy, and it is the kind of false alarm
   that teaches an operator to wave gates through.

   What must stay true is the other half: a process that really has stopped ticking must
   still be caught, whether it ticked once long ago or never ticked at all.
   Run: pnpm --filter @momome/server test:jobshealth
   ============================================================ */
import assert from "node:assert/strict";

process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.PROCESS_ROLE = "all"; // runsJobs() must be true or every assertion is vacuous

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { jobsHealth, _setJobsClockForTests } = await import("../src/jobs.js");

  console.log("\nJobs health — starting up vs stopped");

  // 1. A process that just booted and has not ticked yet.
  const fresh = jobsHealth();
  ok("a process that runs jobs is saying so", fresh.role === "all", fresh.role);
  ok("a freshly booted process is NOT stale", fresh.stale === false, JSON.stringify(fresh));
  ok("…and says it is starting up, rather than saying nothing", fresh.startingUp === true);
  ok("…with no last tick to report", fresh.lastTickAt === null);

  // 2. Up past the grace period, still never ticked: that IS broken.
  _setJobsClockForTests({ startedAt: Date.now() - 4 * 60_000 });
  const neverTicked = jobsHealth();
  ok("up for four minutes having never ticked IS stale", neverTicked.stale === true);
  ok("…and no longer claims to be starting up", neverTicked.startingUp === false);

  // 3. Ticked recently: healthy, whatever the uptime.
  _setJobsClockForTests({ startedAt: Date.now() - 60 * 60_000, lastTickAt: Date.now() - 5_000 });
  const healthy = jobsHealth();
  ok("a recent tick is healthy", healthy.stale === false && healthy.startingUp === false, JSON.stringify(healthy));
  ok("…and the tick is reported", typeof healthy.lastTickAt === "string");

  // 4. Ticked, but long ago: the original failure this check exists for, still caught.
  _setJobsClockForTests({ startedAt: Date.now() - 60 * 60_000, lastTickAt: Date.now() - 10 * 60_000 });
  const stopped = jobsHealth();
  ok("a loop that stopped ticking is still caught", stopped.stale === true);
  ok("…and is not excused as starting up", stopped.startingUp === false);

  console.log(`\n✅ jobs-health: ${passed} assertions passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
