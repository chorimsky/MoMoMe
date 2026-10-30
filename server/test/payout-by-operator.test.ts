/* Payout outcomes, split by rail × operator.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/payout-by-operator.test.ts

   THE CASE THIS EXISTS FOR. Peexit was paying MTN and not paying Orange. Rail health said
   "peexit: 109 samples, 47%" — degraded, operator unknown — and no screen could show which
   operator was hit, so the asymmetry was found by a person noticing it and could not be
   proved from anything we had.

   The trap is that a success rate built from VERDICTS cannot see this failure at all. A
   payout the rail accepts and never executes is never COMPLETED and never FAILED, so it
   contributes no failure and dents no rate. Counting submitted against resolved is what
   makes "accepted, then silence" visible — and `verdictRate` is deliberately null, not 1
   and not 0, when nothing has reached a verdict. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "payout-by-operator-test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const NOW = Date.parse("2026-10-30T18:00:00.000Z");
const mins = (m: number) => new Date(NOW - m * 60_000).toISOString();

function payment(o: { state: string; provider: string; rail: string; since?: string; key?: string }) {
  return {
    id: `p_${Math.random().toString(16).slice(2)}`,
    state: o.state,
    aggregator: o.rail,
    payoutKey: o.key ?? "k",
    recipient: { provider: o.provider, phone: "+237690000000", name: "Test" },
    payoutUnresolvedSince: o.since,
    updatedAt: o.since ?? mins(1),
    createdAt: mins(60),
  } as never;
}

async function main() {
  const { summarise, asymmetries } = await import("../src/core/payoutByOperator.js");

  console.log("\n  a rail paying MTN while Orange goes unanswered\n");
  const rows = summarise([
    payment({ state: "DELIVERED", provider: "MTN", rail: "peexit" }),
    payment({ state: "DELIVERED", provider: "MTN", rail: "peexit" }),
    payment({ state: "PAYOUT_CONFIRMED", provider: "MTN", rail: "peexit" }),
    payment({ state: "PAYOUT_REQUESTED", provider: "ORANGE", rail: "peexit", since: mins(358) }),
    payment({ state: "MANUAL_REVIEW", provider: "ORANGE", rail: "peexit", since: mins(120) }),
  ], NOW);

  const mtn = rows.find((r) => r.provider === "MTN")!;
  const orange = rows.find((r) => r.provider === "ORANGE")!;

  ok("MTN shows 3 submitted, 3 delivered", mtn.submitted === 3 && mtn.delivered === 3, `${mtn.submitted}/${mtn.delivered}`);
  ok("…and a verdict rate of 1", mtn.verdictRate === 1, String(mtn.verdictRate));
  ok("…with nothing unresolved", mtn.unresolved === 0 && mtn.oldestUnresolvedMin === null, `${mtn.unresolved}`);

  ok("ORANGE shows 2 submitted, 0 delivered", orange.submitted === 2 && orange.delivered === 0, `${orange.submitted}/${orange.delivered}`);
  ok("…2 unresolved", orange.unresolved === 2, String(orange.unresolved));
  ok("…oldest 358 minutes — the number a vendor cannot argue with", orange.oldestUnresolvedMin === 358, String(orange.oldestUnresolvedMin));

  console.log("\n  a rail that never answers must not read as healthy — nor as failing\n");
  ok("ORANGE verdictRate is null, not 1", orange.verdictRate === null, String(orange.verdictRate));
  ok("…and not 0 either (0 would claim verdicts we never got)", orange.verdictRate !== 0, String(orange.verdictRate));
  ok("ORANGE recorded no failures, because the rail issued none", orange.failed === 0, String(orange.failed));

  console.log("\n  the asymmetry is stated in words, not left to be inferred\n");
  const notes = asymmetries(rows);
  ok("one asymmetry is reported", notes.length === 1, String(notes.length));
  ok("…naming the silent operator", /ORANGE/.test(notes[0] ?? ""), notes[0]);
  ok("…the working one", /MTN delivered 3/.test(notes[0] ?? ""), notes[0]);
  ok("…and the age", /358 min/.test(notes[0] ?? ""), notes[0]);

  console.log("\n  no asymmetry claimed when a rail is simply down for everyone\n");
  const allStuck = summarise([
    payment({ state: "PAYOUT_REQUESTED", provider: "MTN", rail: "peexit", since: mins(30) }),
    payment({ state: "PAYOUT_REQUESTED", provider: "ORANGE", rail: "peexit", since: mins(30) }),
  ], NOW);
  ok("a rail stuck on BOTH operators reports no asymmetry", asymmetries(allStuck).length === 0, String(asymmetries(allStuck).length));

  console.log("\n  a payout never handed to a rail is not counted against one\n");
  const notSubmitted = summarise([
    { id: "x", state: "AWAITING_INBOUND", recipient: { provider: "ORANGE" }, createdAt: mins(5), updatedAt: mins(5) } as never,
    { id: "y", state: "QUOTED", aggregator: "peexit", recipient: { provider: "ORANGE" }, createdAt: mins(5), updatedAt: mins(5) } as never,
  ], NOW);
  ok("a quote with no payout key is excluded", notSubmitted.length === 0, JSON.stringify(notSubmitted));

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
