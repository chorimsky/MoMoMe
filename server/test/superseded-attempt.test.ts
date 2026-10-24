/* ============================================================
   A verdict on a SUPERSEDED payout attempt must settle nothing.

   When a payout fails and fails over, the payment gets a new idempotency key
   (`${ref}:r2`) and a new rail. The old attempt's rail does not know that: its callback,
   or a retried delivery of it, can arrive afterwards. Honouring it is a money bug in both
   directions — a late FAILED refunds a payout another rail is still carrying, and a late
   COMPLETED marks delivered while that second attempt is in flight.

   The guard originally only rejected a SUFFIXED key, so the one key that was certain to
   arrive late — the bare ref, which is what attempt 1 was submitted under — went straight
   through. These are the two assertions that distinguish the fix from the bug.
   Run: pnpm --filter @momome/server test:superseded
   ============================================================ */
import assert from "node:assert/strict";
import type { Payment } from "../../shared/types.js";

process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { store } = await import("../src/db/store.js");
  const { onPayoutResult } = await import("../src/core/stateMachine.js");

  /** A payment already on its SECOND payout attempt, in flight. */
  async function inFlightOnR2(id: string): Promise<Payment> {
    const now = new Date().toISOString();
    const xaf = 50_000, feeXaf = 1_250;
    const p: Payment = {
      id, ref: `MMM-SUP-${id}`, quoteId: `q_${id}`,
      state: "PAYOUT_REQUESTED", displayStatus: "Sending", method: "LIGHTNING",
      recipient: { phone: "677000000", country: "CM", provider: "MTN", name: "", nameSource: "manual" },
      xaf, feeXaf, totalXaf: xaf + feeXaf, usd: 80,
      payInstruction: { method: "LIGHTNING", code: `lnbc_${id}`, qr: `lightning:lnbc_${id}`, asset: "BTC", amount: 0.0008, amountLabel: "0.0008 BTC", expiresAt: now, providerRef: `ph_${id}`, provider: "sandbox" },
      events: [{ at: now, state: "QUOTED" }, { at: now, state: "PAYOUT_REQUESTED" }],
      createdAt: now, updatedAt: now,
      payoutAttempts: 2, payoutKey: `MMM-SUP-${id}:r2`, aggregator: "peexit",
    };
    await store().putPayment(p);
    return p;
  }

  console.log("\nSuperseded payout attempt — a late verdict on attempt 1 settles nothing");

  // 1. The late FAILED from attempt 1, under the BARE ref. This is the case that got
  //    through: it would have refunded a payout attempt 2 is still carrying.
  const a = await inFlightOnR2("a1");
  await onPayoutResult(a.ref, "FAILED");
  const afterStale = await store().getPayment(a.id);
  ok("a FAILED under the bare ref is ignored while :r2 is in flight", afterStale?.state === "PAYOUT_REQUESTED", afterStale?.state);

  // 2. A late COMPLETED under the bare ref is equally not this attempt's verdict.
  const b = await inFlightOnR2("b1");
  await onPayoutResult(b.ref, "COMPLETED", "stale-provider-ref");
  const afterStaleOk = await store().getPayment(b.id);
  ok("a COMPLETED under the bare ref does not deliver either", afterStaleOk?.state === "PAYOUT_REQUESTED", afterStaleOk?.state);

  // 3. The CURRENT key still settles — the guard must not have closed the live path.
  const c = await inFlightOnR2("c1");
  await onPayoutResult(`${c.ref}:r2`, "COMPLETED", "real-provider-ref");
  const settled = await store().getPayment(c.id);
  ok("the current attempt's key settles the payment", settled?.state === "DELIVERED", settled?.state);

  // 4. And a first-attempt payment (no payoutKey) still settles on its bare ref — the
  //    symmetric check must not require a suffix that a first attempt never has.
  const d = await inFlightOnR2("d1");
  d.payoutKey = undefined; d.payoutAttempts = 1;
  await store().putPayment(d);
  await onPayoutResult(d.ref, "COMPLETED", "first-attempt-ref");
  const first = await store().getPayment(d.id);
  ok("a first attempt still settles on the bare ref", first?.state === "DELIVERED", first?.state);

  console.log(`\n✅ superseded-attempt: ${passed} assertions passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
