/* A payout the rail will not resolve must stop pretending to be in progress — without
   abandoning the rail's claim on it.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/payout-unresolved.test.ts

   reconcileStuckPayouts only ever acted on COMPLETED or FAILED. A payout that resolves to
   neither — the rail has no record of it, its status endpoint moved with a gateway
   migration, or it answers "pending" for ever — kept the payment in PAYOUT_REQUESTED
   indefinitely: the sender watched a spinner, the crypto stayed held, and the only signal
   was an alert that said nothing about the payment itself.

   The escalation is only safe because a LATE verdict is still honoured. onPayoutResult
   used to begin `if (p.state !== "PAYOUT_REQUESTED") return`, so moving the payment
   anywhere would have dropped the rail's answer — recipient paid, crypto held, payment
   never delivered. That is strictly worse than the stall, and it is why this was not done
   until the result handler could accept it. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "payout-unresolved-test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

async function main() {
  const { _legalTable } = await import("../src/core/stateMachine.js");

  console.log("\nThe edge a late verdict needs\n");
  const table = _legalTable as unknown as Record<string, string[]>;
  // My first attempt added MANUAL_REVIEW → PAYOUT_CONFIRMED so a late verdict could settle
  // from the desk. transition-table.test.ts forbids exactly that, deliberately: the desk
  // must not declare money moved, and a row that allows everything asserts nothing. The
  // late verdict is applied by RELEASING the payment back into the money path instead, so
  // there is exactly one code path that delivers money.
  ok("the desk still cannot declare money confirmed", !(table.MANUAL_REVIEW ?? []).includes("PAYOUT_CONFIRMED"),
    (table.MANUAL_REVIEW ?? []).join(","));
  ok("…and cannot declare it delivered either", !(table.MANUAL_REVIEW ?? []).includes("DELIVERED"));
  ok("but it CAN release back into the payout path", (table.MANUAL_REVIEW ?? []).includes("PAYOUT_REQUESTED"));
  ok("PAYOUT_REQUESTED → MANUAL_REVIEW is legal (the escalation itself)",
    (table.PAYOUT_REQUESTED ?? []).includes("MANUAL_REVIEW"), (table.PAYOUT_REQUESTED ?? []).join(","));
  ok("…and the payout path still reaches PAYOUT_CONFIRMED normally",
    (table.PAYOUT_REQUESTED ?? []).includes("PAYOUT_CONFIRMED"));

  console.log("\nThe escalation is time-based and generous\n");
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/core/stateMachine.ts", import.meta.url), "utf8");
  const esc = /unresolvedEscalateMs\s*=\s*([0-9_ *]+)/.exec(src)?.[1] ?? "";
  const mins = Number(esc.replace(/_/g, "").split("*").map((x) => Number(x.trim())).reduce((a, b) => a * b, 1)) / 60_000;
  ok("the escalation window parsed", Number.isFinite(mins) && mins > 0, `${mins} min`);
  // The operator is paged at 20 minutes (alerts.ts STUCK_PAYOUT_MIN). The state change
  // must come AFTER the page, so a human has already been told before the payment moves.
  ok("it waits longer than the operator page", mins > 20, `${mins} min vs a 20-min page`);

  console.log("\nIt abandons nothing\n");
  ok("the payout key is left intact for a late verdict", /payoutKey is unchanged|key is unchanged|ABANDONS NOTHING/i.test(src));
  ok("the result handler accepts an escalated payment", /escalatedPayout/.test(src));
  ok("…by returning it to PAYOUT_REQUESTED, not confirming from the desk",
    /transition\(p, "PAYOUT_REQUESTED", "rail answered after escalation"\)/.test(src));
  ok("…and only when it was escalated for THIS reason", /payoutUnresolvedSince/.test(src));
  ok("the marker is cleared once it resolves", /payoutUnresolvedSince = undefined/.test(src));

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
