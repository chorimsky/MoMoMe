/* ============================================================
   Settlement idempotency regression test.
   Guards the fix for the `rank() === -1` idempotency hole: a duplicate
   settled webhook (IBEX delivers at-least-once) must NOT re-drive settlement
   on a payment already booked + held (MANUAL_REVIEW / REFUND_PENDING / …).
   Before the fix, confirmInbound re-posted the ledger, re-reserved float and
   re-counted the fee for any held/terminal payment.
   Run: pnpm --filter @momome/server test:settle
   ============================================================ */
import assert from "node:assert/strict";
import type { Payment } from "../../shared/types.js";

process.env.DB_PATH = ":memory:"; // isolated, fresh in-memory DB
process.env.RAILS_MODE = "sandbox";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { store } = await import("../src/db/store.js");
  const { confirmInbound, markDetected, availableFloatXaf } = await import("../src/core/stateMachine.js");

  // A LIGHTNING payment ABOVE the 1,000,000 XAF corridor limit books the inbound +
  // FX-lock ledger and reserves float, then holds at MANUAL_REVIEW — a deterministic
  // "booked but held" state (no rail config needed) to test idempotency against.
  async function makePayment(id: string, xaf = 1_500_000): Promise<Payment> {
    const now = new Date().toISOString();
    const feeXaf = Math.round(xaf * 0.025);
    const p: Payment = {
      id, ref: `MMM-TEST-${id}`, quoteId: `q_${id}`,
      state: "AWAITING_INBOUND", displayStatus: "Pending", method: "LIGHTNING",
      recipient: { phone: "677000000", country: "CM", provider: "MTN", name: "Test", nameSource: "manual" },
      xaf, feeXaf, totalXaf: xaf + feeXaf, usd: 2500,
      payInstruction: { method: "LIGHTNING", code: `lnbc_${id}`, qr: `lightning:lnbc_${id}`, asset: "BTC", amount: 0.015, amountLabel: "0.015 BTC", expiresAt: now, providerRef: `ph_${id}`, provider: "ibex" },
      events: [{ at: now, state: "QUOTED" }, { at: now, state: "AWAITING_INBOUND" }],
      createdAt: now, updatedAt: now,
    };
    await store().putPayment(p);
    return p;
  }

  const snapshot = async () => ({
    float: await store().balance("payout_float_XAF", "XAF"),
    fee: await store().balance("fee_revenue", "XAF"),
    inbound: await store().balance("inbound_clearing", "BTC"),
    avail: await availableFloatXaf(),
  });

  console.log("\nSettlement idempotency — duplicate confirmInbound on a held payment");

  // 1. First confirm books the ledger + reserves float, then holds above the corridor limit.
  const p = await makePayment("dup1");
  await confirmInbound(p, p.payInstruction.amount);
  ok("held at MANUAL_REVIEW (above corridor limit)", p.state === "MANUAL_REVIEW", p.state);
  ok("booked exactly one INBOUND_CONFIRMED event", p.events.filter((e) => e.state === "INBOUND_CONFIRMED").length === 1);
  const before = await snapshot();
  // Parking for review GIVES THE EARMARK BACK. It is only there to stop concurrent
  // settlements over-committing the treasury; a payment suspended for review is not
  // concurrent, and adminRetry re-checks the corridor cap and the float before it
  // disburses. Holding it through a park destroyed float no one would ever spend.
  ok("parking for review released the float earmark", before.float === 0, String(before.float));
  ok("fee booked", before.fee !== 0, String(before.fee));

  // 2. A duplicate settled webhook re-posts confirmInbound → MUST be a no-op.
  await confirmInbound(p, p.payInstruction.amount);
  const after = await snapshot();
  ok("dup confirm did NOT re-reserve float", after.float === before.float, `${after.float} vs ${before.float}`);
  ok("dup confirm did NOT re-book fee", after.fee === before.fee, `${after.fee} vs ${before.fee}`);
  ok("dup confirm did NOT re-post inbound", after.inbound === before.inbound, `${after.inbound} vs ${before.inbound}`);
  ok("dup confirm did NOT change available float", after.avail === before.avail, `${after.avail} vs ${before.avail}`);
  ok("still exactly one INBOUND_CONFIRMED event", p.events.filter((e) => e.state === "INBOUND_CONFIRMED").length === 1);
  ok("state unchanged (still MANUAL_REVIEW)", p.state === "MANUAL_REVIEW", p.state);

  // 3. markDetected must not resurrect a held/terminal payment.
  console.log("\nmarkDetected — no resurrection of a terminal payment");
  const term = await makePayment("term1");
  term.state = "FAILED"; await store().putPayment(term);
  await markDetected(term);
  ok("FAILED payment is NOT dragged back to INBOUND_DETECTED", term.state === "FAILED", term.state);

  // 4. …but still advances a genuinely fresh AWAITING_INBOUND payment.
  const fresh = await makePayment("fresh1");
  await markDetected(fresh);
  ok("AWAITING_INBOUND advances to INBOUND_DETECTED", fresh.state === "INBOUND_DETECTED", fresh.state);

  // 5. On-chain over/under-payment guards (only the exactly-quoted band settles).
  console.log("\nconfirmInbound — on-chain amount guards (under / over / exact)");
  async function makeOnchain(id: string, amount = 0.001): Promise<Payment> {
    const now = new Date().toISOString();
    const xaf = 50_000, feeXaf = Math.round(xaf * 0.028);
    const p: Payment = {
      id, ref: `MMM-OC-${id}`, quoteId: `q_${id}`,
      state: "AWAITING_INBOUND", displayStatus: "Pending", method: "ONCHAIN",
      recipient: { phone: "677000001", country: "CM", provider: "MTN", name: "OC", nameSource: "manual" },
      xaf, feeXaf, totalXaf: xaf + feeXaf, usd: 85, estimateOnly: true,
      payInstruction: { method: "ONCHAIN", code: `bc1${id}`, qr: `bitcoin:bc1${id}`, asset: "BTC", amount, amountLabel: `${amount} BTC`, expiresAt: now, providerRef: `bc1${id}`, provider: "ibex" },
      events: [{ at: now, state: "QUOTED" }, { at: now, state: "AWAITING_INBOUND" }],
      createdAt: now, updatedAt: now,
    };
    await store().putPayment(p);
    return p;
  }
  const noteOf = (p: Payment) => p.events[p.events.length - 1]?.note ?? "";

  const under = await makeOnchain("under");
  await confirmInbound(under, under.payInstruction.amount * 0.5); // 50% short
  ok("underpaid on-chain → MANUAL_REVIEW (underpaid)", under.state === "MANUAL_REVIEW" && /underpaid/.test(noteOf(under)), noteOf(under));

  const over = await makeOnchain("over");
  await confirmInbound(over, over.payInstruction.amount * 2); // 2× fat-finger
  ok("overpaid on-chain → MANUAL_REVIEW (overpaid)", over.state === "MANUAL_REVIEW" && /overpaid/.test(noteOf(over)), noteOf(over));

  // Exact payment PASSES both guards (it then holds on the FX re-price gate in this
  // rail-less test — a DIFFERENT reason — proving the overpay guard didn't misfire).
  const exact = await makeOnchain("exact");
  await confirmInbound(exact, exact.payInstruction.amount);
  ok("exact on-chain does NOT trip the overpay guard", !/overpaid|underpaid/.test(noteOf(exact)), noteOf(exact));

  console.log(`\n✅ ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
