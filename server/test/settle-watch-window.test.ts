/* The sender must keep watching for longer than the server takes to unstick a payment.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/settle-watch-window.test.ts

   The processing screen polled for 4 minutes. resumeStalledSettlements — the backstop for
   a payment left mid-settlement, inbound booked and no payout requested — only acts once
   the payment has been idle for 5 minutes, and it is what moves that payment on to a
   payout or to REFUND_PENDING.

   So the client stopped watching ONE MINUTE before the thing that resolves it ran. Every
   time. The payment got where it was going; the sender never saw it, and sat on "Still
   working on it…" with an animated step list that was fetching nothing. That is the
   "stuck on processing" report, and neither side was wrong on its own — only the
   relationship between two numbers in two files that nothing compared. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
import { readFileSync } from "node:fs";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

/** "10 * 60_000" / "5 * 60_000" / "45_000" → milliseconds. */
function ms(expr: string): number | null {
  const m = /^\s*(\d[\d_]*)\s*(?:\*\s*(\d[\d_]*))?\s*$/.exec(expr.replace(/_/g, ""));
  if (!m) return null;
  return Number(m[1]) * (m[2] ? Number(m[2]) : 1);
}

async function main() {
  const steps = readFileSync(new URL("../../app/src/pages/send/steps.tsx", import.meta.url), "utf8");
  const machine = readFileSync(new URL("../src/core/stateMachine.ts", import.meta.url), "utf8");

  const maxPoll = ms(/const MAX_POLL_MS\s*=\s*([^;]+);/.exec(steps)?.[1] ?? "");
  const slowAfter = ms(/const SLOW_AFTER_MS\s*=\s*([^;]+);/.exec(steps)?.[1] ?? "");
  const idle = ms(/idleMs\s*=\s*([0-9_ *]+)/.exec(machine)?.[1] ?? "");

  console.log(`\n  client watches for ${maxPoll / 1000}s · server resumes after ${idle / 1000}s idle\n`);
  ok("the client poll cap was found", maxPoll !== null, String(maxPoll));
  ok("the server's resume window was found", idle !== null, String(idle));
  // Everything below compares these two numbers. If either failed to parse the comparison
  // is meaningless and would PASS — stop here instead of reporting a green that proves
  // nothing. (The first version of this file did exactly that.)
  if (maxPoll === null || idle === null) {
    console.log(`\nFAILURES — could not read both constants; the comparison would be vacuous\n`);
    process.exit(1);
  }

  // The invariant. A reconcile tick runs every 30s, so the resume lands at idle + up to one
  // tick; the client must still be watching after that, with room for the settle itself.
  const TICK = 30_000;
  ok("the sender keeps watching past the resume window",
    maxPoll > idle + TICK,
    `cap ${maxPoll / 1000}s vs resume ${(idle + TICK) / 1000}s`);

  ok("…with at least a minute of margin, not a hair",
    maxPoll - (idle + TICK) >= 60_000,
    `${(maxPoll - idle - TICK) / 1000}s of margin`);

  ok("the reassuring copy still appears long before the cap", slowAfter < maxPoll / 2,
    `slow at ${slowAfter / 1000}s, cap at ${maxPoll / 1000}s`);

  console.log("\nAnd the screen must admit when it has stopped\n");
  // A spinner that is no longer fetching reads as live progress: a resolved payment and a
  // stuck one look identical.
  ok("stopping the poll sets a state the UI can show", /setStoppedWatching\(true\)/.test(steps));
  ok("…and that state changes the copy", /proc_stopped_title/.test(steps) && /proc_stopped_sub/.test(steps));
  const i18n = readFileSync(new URL("../../app/src/lib/i18n.tsx", import.meta.url), "utf8");
  ok("…in English and French", /proc_stopped_sub:\s*\[[^\]]*",\s*"/.test(i18n));

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
