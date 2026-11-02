/* The critical alarm for undelivered money must not clear because the payment was moved.
   Run: DB_PATH=:memory: RAILS_MODE=sandbox tsx test/stuck-alert.test.ts

   WHAT WENT WRONG. payments:stuck filtered on state === "PAYOUT_REQUESTED". At 30 minutes
   reconcileStuckPayouts moves an unresolved payout to MANUAL_REVIEW, so the payment stopped
   matching and the CRITICAL alarm cleared itself — not because anyone had been paid, but
   because the row had changed state. Severity fell as the problem deepened:

     20 min  payments:stuck     CRITICAL
     30 min  escalated to MANUAL_REVIEW → stuck stops firing   (nothing)
     90 min  payments:review    WARNING

   leaving a half-hour window in which undelivered money had no alarm at all, and an
   operator watching severity would have seen the problem "resolve" while the rail still
   had not paid. This was found by watching the live alert clear during the Peexit Orange
   outage, with nothing settled.

   An escalated payout still has the rail holding it — payoutUnresolvedSince is set because
   no verdict came — so it stays in the alarm until it is paid, failed or refunded. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
process.env.ADMIN_SESSION_SECRET = "stuck-alert-test";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; } else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; } };

const mins = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function main() {
  const { store } = await import("../src/db/store.js");
  const { conditions } = await import("../src/core/alerts.js");

  // A payout escalated to the operator's desk 45 minutes ago, with the rail still holding
  // it — payoutUnresolvedSince is exactly what reconcileStuckPayouts stamps on escalation.
  await store().putPayment({
    id: "p1", ref: "MMM-2026-900001", state: "MANUAL_REVIEW", aggregator: "peexit",
    payoutKey: "k1", payoutUnresolvedSince: mins(45),
    recipient: { provider: "ORANGE", phone: "+237690000000", name: "Test", country: "CM" },
    createdAt: mins(60), updatedAt: mins(45),
  } as never);

  const alerts = await conditions();
  const stuck = alerts.find((a: { key: string }) => a.key === "payments:stuck");

  console.log("\n  an escalated-but-unpaid payout keeps the critical alarm\n");
  ok("payments:stuck still fires after escalation", !!stuck, stuck ? "fired" : "MISSING — the alarm cleared itself");
  ok("…and is still CRITICAL, not downgraded", stuck?.severity === "critical", String(stuck?.severity));
  ok("…and says the rail is still holding it", /escalated to review/.test(stuck?.body ?? ""), stuck?.body?.slice(0, 120));
  ok("…and names the age", /oldest 4[45] min/.test(stuck?.body ?? ""), stuck?.body?.slice(0, 160));

  console.log(`\n${fail === 0 ? "ALL PASS" : "FAILURES"} — ${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
