/* "Automatically switch to a payout rail that is UP and HAS BALANCE."

   Three rails now serve Cameroon, two of them prefunded (CamPay holds float per carrier;
   Peexit holds a disbursement wallet). That makes two questions load-bearing, and this
   file answers both against the real selector rather than by reading the code:

     1. Is a rail with no money, or whose balance we cannot READ, kept out?
why it matters: a payout sent to an empty float is refused AFTER the sender's crypto
        is held. The gate is `bal != null && bal >= amount` in BOTH selectFundedAggregator
        and payoutReady — a null balance is UNKNOWN, and unknown is not spendable.

     2. When a rail refuses mid-flight anyway (its float drained between the balance read
        and the submit), does the payment move to one that can pay — at once?
        Before 2026-10-21 an "insufficient float" refusal was treated as transient and
        retried three times with 1.5 s + 3 s backoff before failing over: 4.5 seconds of
        waiting for money that could not arrive in 4.5 seconds.

   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/payout-switching.test.ts */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import type { PayoutAdapter } from "../src/adapters/payouts.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

/** A stand-in rail we can give any balance, including "cannot be read". */
function fakeRail(name: string, opts: { priority?: number; balance: number | null; live?: boolean }): PayoutAdapter {
  return {
    name, priority: opts.priority ?? 1,
    configured: () => true,
    live: () => opts.live ?? true,
    supports: (p) => p === "MTN" || p === "ORANGE",
    disburse: async () => ({ status: "accepted", providerRef: `${name}-ref`, simulated: false }),
    queryStatus: async () => "PENDING",
    balance: async () => opts.balance,
    statusByKey: () => null,
  };
}

async function main() {
  const payouts = await import("../src/adapters/payouts.js");
  const { selectFundedAggregator, payoutReady, setAggregatorUp } = await import("../src/core/routing.js");
  const original = [...payouts.PAYOUTS];
  const setRails = (...rails: PayoutAdapter[]) => { payouts.PAYOUTS.length = 0; payouts.PAYOUTS.push(...rails); };
  const AMOUNT = 10_000;

  try {
    console.log("\nA rail is only chosen when it is UP and its balance COVERS the payout\n");
    setRails(fakeRail("rich", { priority: 0, balance: 500_000 }), fakeRail("poor", { priority: 1, balance: 100 }));
    ok("the funded rail is chosen", (await selectFundedAggregator("MTN", "CM", AMOUNT, true))?.name === "rich");
    setRails(fakeRail("poor", { priority: 0, balance: 100 }), fakeRail("rich", { priority: 1, balance: 500_000 }));
    ok("…even when the SHORT rail is the preferred one — priority never overrides funding",
      (await selectFundedAggregator("MTN", "CM", AMOUNT, true))?.name === "rich");

    console.log("\nA balance we cannot READ is not a balance we can spend\n");
    setRails(fakeRail("unreadable", { priority: 0, balance: null }), fakeRail("rich", { priority: 1, balance: 500_000 }));
    ok("a rail whose balance is null is skipped, not gambled on",
      (await selectFundedAggregator("MTN", "CM", AMOUNT, true))?.name === "rich");
    setRails(fakeRail("unreadable", { priority: 0, balance: null }));
    ok("with ONLY an unreadable rail, live money holds rather than being sent blind",
      (await selectFundedAggregator("MTN", "CM", AMOUNT, true)) === null);
    ok("…and the pre-flight says rail_unreachable, not insufficient_rail_balance",
      (await payoutReady("MTN", "CM", AMOUNT, true)).reason === "rail_unreachable",
      (await payoutReady("MTN", "CM", AMOUNT, true)).reason);
    setRails(fakeRail("broke", { priority: 0, balance: 100 }));
    ok("an EMPTY rail is reported as empty — the two need different fixes",
      (await payoutReady("MTN", "CM", AMOUNT, true)).reason === "insufficient_rail_balance",
      (await payoutReady("MTN", "CM", AMOUNT, true)).reason);

    console.log("\nA rail that is DOWN is skipped even when it is funded\n");
    setRails(fakeRail("down", { priority: 0, balance: 500_000 }), fakeRail("up", { priority: 1, balance: 500_000 }));
    setAggregatorUp("down", false);
    ok("the down rail is passed over for the one that is up",
      (await selectFundedAggregator("MTN", "CM", AMOUNT, true))?.name === "up");
    ok("…and the pre-flight still says a payout can land", (await payoutReady("MTN", "CM", AMOUNT, true)).ok === true);
    setRails(fakeRail("down", { priority: 0, balance: 500_000 }));
    ok("with every rail down, the pre-flight refuses with rails_down",
      (await payoutReady("MTN", "CM", AMOUNT, true)).reason === "rails_down");
    setAggregatorUp("down", true);

    console.log("\nA rail must be BOTH: funded but down, or up but empty, is not enough\n");
    setRails(fakeRail("fundedButDown", { priority: 0, balance: 500_000 }), fakeRail("upButEmpty", { priority: 1, balance: 0 }));
    setAggregatorUp("fundedButDown", false);
    ok("neither qualifies, so live money holds", (await selectFundedAggregator("MTN", "CM", AMOUNT, true)) === null);
    setAggregatorUp("fundedButDown", true);

    console.log("\nAn empty float refuses the RETRY, not the rail — float is held per carrier\n");
    const { _patterns } = await import("../src/core/stateMachine.js") as unknown as
      { _patterns?: { hard: RegExp; noRetry: RegExp } };
    if (_patterns) {
      for (const msg of ["CamPay withdrawal refused: insufficient MTN float (ER301)", "simulated: INSUFFICIENT_FUND_TO_PAY_TX"]) {
        ok(`"${msg.slice(0, 38)}…" stops the retries`, _patterns.noRetry.test(msg));
        ok("…but does NOT blind the rail (its other carrier may still be funded)", !_patterns.hard.test(msg));
      }
      ok("a real config block DOES blind the rail", _patterns.hard.test("PAYOUTS_NOT_ALLOWED"));
    } else {
      ok("stateMachine exports its payout-failure patterns for this test", false, "add `export const _patterns`");
    }
  } finally {
    setRails(...original);
  }

  console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
