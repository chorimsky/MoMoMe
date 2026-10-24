/* ============================================================
   The legal transition table, enumerated.

   The table in core/stateMachine.ts is a backstop for the edge nobody thought to guard, so
   it is only worth having if it is kept honest in both directions:

     • every edge the engine actually takes must be DECLARED (otherwise the log-only phase
       cries wolf, and nobody will ever dare turn enforcement on);
     • every edge that would move money backwards must be REFUSED (otherwise the table
       declares everything and asserts nothing).

   The second half is the part a table can get wrong quietly: a row written as
   "everything is reachable from here" passes every test while protecting nothing. The
   forbidden-edge list below is therefore explicit, and each entry says what it would mean.
   Run: pnpm --filter @momome/server test:transitions
   ============================================================ */
import assert from "node:assert/strict";
import type { PaymentState } from "../../shared/types.js";

process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

const ALL: PaymentState[] = ["QUOTED", "AWAITING_INBOUND", "INBOUND_DETECTED", "INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED", "REFUND_PENDING", "REFUNDED", "FAILED", "MANUAL_REVIEW"];

async function main() {
  const { edgeAllowed, _legalTable, transitionViolations } = await import("../src/core/stateMachine.js");

  console.log("\nThe legal transition table");

  // 1. Every state is declared. A missing row reads as "nothing is legal from here", which
  //    would flood the log for a state the engine uses perfectly well.
  const missing = ALL.filter((s) => !(s in _legalTable));
  ok("every PaymentState has a row", missing.length === 0, missing.join(", ") || "all 12");

  // 2. The happy path end to end. If any of these were undeclared the engine could not
  //    deliver a payment without logging a violation.
  const happy: Array<[PaymentState, PaymentState]> = [
    ["QUOTED", "AWAITING_INBOUND"],
    ["AWAITING_INBOUND", "INBOUND_CONFIRMED"],
    ["INBOUND_CONFIRMED", "FX_LOCKED"],
    ["FX_LOCKED", "PAYOUT_REQUESTED"],
    ["PAYOUT_REQUESTED", "PAYOUT_CONFIRMED"],
    ["PAYOUT_CONFIRMED", "DELIVERED"],
  ];
  ok("the happy path is declared end to end", happy.every(([f, t]) => edgeAllowed(f, t)), happy.map(([f, t]) => `${f}→${t}`).join(" "));

  // 3. The edges that exist because of a real incident or a real product decision.
  ok("failover keeps the payment in PAYOUT_REQUESTED", edgeAllowed("PAYOUT_REQUESTED", "PAYOUT_REQUESTED"));
  ok("a rejected payout can open a refund claim", edgeAllowed("PAYOUT_REQUESTED", "REFUND_PENDING"));
  ok("the sender can ask for delivery instead of a refund", edgeAllowed("REFUND_PENDING", "PAYOUT_REQUESTED"));
  ok("a held payment is released to payout by an operator", edgeAllowed("MANUAL_REVIEW", "PAYOUT_REQUESTED"));
  ok("a held re-price resumes at FX_LOCKED", edgeAllowed("MANUAL_REVIEW", "FX_LOCKED"));
  ok("a refund whose payout failed comes back for a new invoice", edgeAllowed("REFUNDED", "REFUND_PENDING"));
  ok("an unpaid invoice can expire", edgeAllowed("AWAITING_INBOUND", "FAILED"));
  // Both of these were found by the log-only phase on the first full suite run — the table
  // was written from reading the code and got them wrong, which is the whole argument for
  // logging before enforcing.
  ok("a re-price re-locks FX without changing state", edgeAllowed("FX_LOCKED", "FX_LOCKED"));
  ok("a late payment on an expired invoice still settles", edgeAllowed("FAILED", "INBOUND_CONFIRMED"));

  // 4. THE FORBIDDEN EDGES. Each one is money moving backwards or twice.
  const forbidden: Array<[PaymentState, PaymentState, string]> = [
    ["DELIVERED", "PAYOUT_REQUESTED", "paying a delivered payment a second time"],
    ["DELIVERED", "REFUND_PENDING", "refunding money the recipient already has"],
    ["DELIVERED", "PAYOUT_CONFIRMED", "re-confirming a finished payout"],
    ["REFUNDED", "DELIVERED", "delivering money already returned to the sender"],
    ["REFUNDED", "PAYOUT_REQUESTED", "paying out after refunding — both legs, one inbound"],
    ["FAILED", "PAYOUT_REQUESTED", "paying out an invoice that was never paid"],
    ["FAILED", "DELIVERED", "delivering a payment that never had an inbound"],
    ["AWAITING_INBOUND", "PAYOUT_REQUESTED", "paying out before the money arrived"],
    ["AWAITING_INBOUND", "DELIVERED", "delivering before the money arrived"],
    ["QUOTED", "PAYOUT_REQUESTED", "paying out on a quote alone"],
    ["INBOUND_CONFIRMED", "PAYOUT_REQUESTED", "paying out without a locked rate"],
    ["INBOUND_CONFIRMED", "DELIVERED", "delivering without a payout"],
    ["PAYOUT_CONFIRMED", "PAYOUT_REQUESTED", "re-requesting a confirmed payout"],
    ["PAYOUT_REQUESTED", "DELIVERED", "delivering without the rail confirming"],
    ["FX_LOCKED", "DELIVERED", "delivering without a payout at all"],
    ["FX_LOCKED", "PAYOUT_CONFIRMED", "confirming a payout never requested"],
  ];
  const admitted = forbidden.filter(([f, t]) => edgeAllowed(f, t));
  ok("no edge that moves money backwards or twice is declared", admitted.length === 0, admitted.map(([f, t, why]) => `${f}→${t} (${why})`).join("; ") || `${forbidden.length} checked`);

  // 5. The table must actually REFUSE things — a row listing all twelve states asserts
  //    nothing. The operator's desk is the widest row and still refuses the finished states.
  const widest = Math.max(...ALL.map((s) => (_legalTable[s] ?? []).length));
  ok("no row is a blanket allow", widest < ALL.length, `widest row has ${widest} of ${ALL.length}`);
  ok("MANUAL_REVIEW cannot reach DELIVERED directly", !edgeAllowed("MANUAL_REVIEW", "DELIVERED"));
  ok("MANUAL_REVIEW cannot reach PAYOUT_CONFIRMED directly", !edgeAllowed("MANUAL_REVIEW", "PAYOUT_CONFIRMED"));

  // 6. DELIVERED is the only truly terminal state. FAILED deliberately is not (a late
  //    payment resurrects it), but it must reach the money path ONLY through the inbound —
  //    never straight to a payout, which is asserted in the forbidden list above.
  ok("DELIVERED leads only to MANUAL_REVIEW", JSON.stringify(_legalTable.DELIVERED) === JSON.stringify(["MANUAL_REVIEW"]), (_legalTable.DELIVERED ?? []).join(","));
  ok("FAILED reaches the money path only via the inbound", JSON.stringify(_legalTable.FAILED) === JSON.stringify(["INBOUND_CONFIRMED", "MANUAL_REVIEW"]), (_legalTable.FAILED ?? []).join(","));

  // 7. Importing the engine must not itself have tripped the counter.
  ok("no violation recorded by merely loading the engine", transitionViolations().length === 0, JSON.stringify(transitionViolations()));

  console.log(`\n✅ transition-table: ${passed} assertions passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
