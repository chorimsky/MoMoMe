/* An unhandled rejection must NOT kill the process.

   Since Node 15 the default is to terminate. src/index.ts installed handlers; the Vercel
   entrypoint never did, so on serverless a single rejected promise killed the whole
   function — and on Fluid Compute one instance serves MANY concurrent requests, so it took
   every other in-flight payment down with it. That presented as a load problem (sequential
   fine, concurrent failing), which is exactly the wrong diagnosis.

   Verified by running a real child process, because the behaviour under test IS process
   termination — it cannot be asserted in-process. */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const BOOT = new URL("../src/boot.ts", import.meta.url).pathname;
const GUARD = new URL("../src/core/processGuards.ts", import.meta.url).pathname;

function run(src: string): { code: number | null; out: string } {
  const f = "/tmp/.guard-probe.ts";
  writeFileSync(f, src);
  const r = spawnSync("npx", ["tsx", f], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", DB_PATH: ":memory:", RAILS_MODE: "sandbox" },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

console.log("\nUnhandled rejection must not terminate the process");

// Baseline: Node's default really does kill the process. If this ever stops being true the
// guard is less critical — but the assertion documents WHY the guard exists.
const bare = run(`
Promise.reject(new Error("boom"));
setTimeout(() => { console.log("SURVIVED"); }, 300);
`);
ok("without the guard Node exits non-zero", bare.code !== 0 && !bare.out.includes("SURVIVED"), `exit=${bare.code}`);

// With the guard installed the process survives and logs the reason.
const guarded = run(`
import { installProcessGuards } from ${JSON.stringify(GUARD)};
installProcessGuards();
Promise.reject(new Error("boom"));
setTimeout(() => { console.log("SURVIVED"); }, 300);
`);
ok("with the guard the process SURVIVES", guarded.code === 0 && guarded.out.includes("SURVIVED"), `exit=${guarded.code}`);
ok("and the reason is still logged, not swallowed", guarded.out.includes("[unhandledRejection]") && guarded.out.includes("boom"));

// The guard must be installed by runBootChecks itself, so neither entrypoint can forget it.
const viaBoot = run(`
import { runBootChecks } from ${JSON.stringify(BOOT)};
runBootChecks();
Promise.reject(new Error("boom"));
setTimeout(() => { console.log("SURVIVED"); }, 300);
`);
ok("runBootChecks() installs it (both runtimes call it)", viaBoot.code === 0 && viaBoot.out.includes("SURVIVED"), `exit=${viaBoot.code}`);

console.log(fail ? `\n❌ ${fail} failed, ${pass} passed` : `\n✅ ${pass} assertions passed`);
if (fail) process.exit(1);
