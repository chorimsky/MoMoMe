/* The payout float must never become a countdown to a bricked platform.

   Production refused EVERY payment with "treasury -423041.5 XAF < 15000 XAF". That number
   was not a balance. When no rail can report one, availableFloatXaf() fell back to a
   constant-treasury model: a static 200,000,000 XAF ceiling MINUS external_recipient, the
   all-time delivered total. But external_recipient is only ever credited — settle() posts a
   delivery leg and nothing anywhere posts back, and no top-up path exists in the codebase —
   so the figure could only ever descend. The deployment was running a SANDBOX payout rail,
   so ~200,000,000 XAF of simulated payouts had consumed a ceiling denominated in real money,
   and the platform locked itself shut permanently with no way back short of wiping the ledger.

   The fallback is now an EXPOSURE ceiling: what we allow to be committed at once, less what
   is committed right now. These tests pin that shut — deliveries must not accumulate against
   future capacity, and a rail that truthfully reports 0 must stay distinguishable from a rail
   that cannot answer at all. */
process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

import { XAF_FLOAT_MAX } from "../../shared/domain.js";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => {
  if (c) { console.log(`  ✓ ${n}${d ? `  (${d})` : ""}`); pass++; }
  else { console.log(`  ✗ ${n}${d ? `  (${d})` : ""}`); fail++; }
};

const { availableFloatXaf, floatBasisNote } = await import("../src/core/stateMachine.js");
const { store } = await import("../src/db/store.js");

console.log("\nTreasury float — the fallback must not ratchet\n");

const s = store();


/** A payment in the given state, so an earmark posted against it is attributable. Only a
 *  payment in flight may hold capacity — the whole point of the change these tests pin. */
const now0 = new Date().toISOString();
const mk = async (id: string, state: string, xaf: number) => {
  await s.putPayment({
    id, ref: `MMM-${id}`, quoteId: `q_${id}`, state, displayStatus: "Pending", method: "LIGHTNING",
    recipient: { phone: "677000000", country: "CM", provider: "MTN", name: "T", nameSource: "manual" },
    xaf, feeXaf: 0, totalXaf: xaf, usd: 1,
    payInstruction: { method: "LIGHTNING", code: "ln", qr: "lightning:ln", asset: "BTC", amount: 0.001,
      amountLabel: "0.001 BTC", expiresAt: now0, providerRef: `ph_${id}`, provider: "ibex" },
    events: [{ at: now0, state: "QUOTED" }], createdAt: now0, updatedAt: now0,
  } as never);
};

/* ---- 1. No queryable rail → the full exposure ceiling, not a depleted one ---- */
const base = await availableFloatXaf();
ok("with no queryable rail the float is the exposure ceiling", base === XAF_FLOAT_MAX, `${base} vs ${XAF_FLOAT_MAX}`);
ok("the basis names it a commitment cap, not a balance", /commitment cap/i.test(floatBasisNote()), floatBasisNote().slice(0, 90));

/* ---- 2. THE REGRESSION: all-time deliveries must not consume future capacity ---- */
// Post delivery legs far exceeding the ceiling — exactly the shape of the production ledger.
await s.recordTxn("pay_history", [
  { account: "payout_payable", direction: "debit", amount: 250_000_000, currency: "XAF" },
  { account: "external_recipient", direction: "credit", amount: 250_000_000, currency: "XAF" },
]);

const delivered = await s.balance("external_recipient", "XAF");
ok("the ledger really does carry a huge all-time delivered total", delivered <= -250_000_000, `${delivered} XAF`);

const after = await availableFloatXaf();
ok("250M XAF of past deliveries does NOT reduce the float", after === XAF_FLOAT_MAX, `${after} XAF`);
ok("the float never goes negative from history alone", after > 0, `${after} XAF`);
ok("a payout of 15,000 XAF is still authorized", after >= 15_000);

/* ---- 3. Only an IN-FLIGHT earmark reduces the float ----
   A payment parked for review holds capacity for a payout that will never happen. Counting
   it understated the float by 436,482 XAF in production, against rails holding 3,440 — a
   funded rail refusing a 500 XAF payment. adminRetry re-checks this figure before it
   disburses, so excluding a parked payment costs no safety. */
await mk("pay_parked", "MANUAL_REVIEW", 9_000_000);
await s.recordTxn("pay_parked", [
  { account: "fx_position", direction: "debit", amount: 9_000_000, currency: "XAF" },
  { account: "payout_float_XAF", direction: "credit", amount: 9_000_000, currency: "XAF" },
]);
ok("a PARKED payment's earmark does not reduce the float",
   (await availableFloatXaf()) === XAF_FLOAT_MAX, `${await availableFloatXaf()} vs ${XAF_FLOAT_MAX}`);

await mk("pay_inflight", "PAYOUT_REQUESTED", 4_000_000);
await s.recordTxn("pay_inflight", [
  { account: "payout_float_XAF", direction: "credit", amount: 4_000_000, currency: "XAF" },
  { account: "payout_payable", direction: "debit", amount: 4_000_000, currency: "XAF" },
]);

const withInflight = await availableFloatXaf();
ok("an IN-FLIGHT earmark lowers the float by exactly its amount",
   withInflight === XAF_FLOAT_MAX - 4_000_000, `${withInflight} vs ${XAF_FLOAT_MAX - 4_000_000}`);
ok("the basis reports the in-flight figure", floatBasisNote().includes("4000000"), floatBasisNote().slice(0, 120));

/* ---- 4. Enough concurrent exposure still blocks — the cap must actually bind ---- */
await mk("pay_saturate", "PAYOUT_REQUESTED", XAF_FLOAT_MAX);
await s.recordTxn("pay_saturate", [
  { account: "payout_float_XAF", direction: "credit", amount: XAF_FLOAT_MAX, currency: "XAF" },
  { account: "payout_payable", direction: "debit", amount: XAF_FLOAT_MAX, currency: "XAF" },
]);

const saturated = await availableFloatXaf();
ok("committing the whole ceiling exhausts the float", saturated <= 0, `${saturated} XAF`);
ok("the cap binds on EXPOSURE, so it recovers when reservations clear — unlike history",
   saturated === XAF_FLOAT_MAX - 4_000_000 - XAF_FLOAT_MAX, `${saturated} XAF`);

/* ---- 5. A parked payment must not keep an earmark it will never spend ----
   The float used to destroy itself at the rate of attempted payments: each payment
   reserved at FX-lock, got parked for review, and kept the earmark forever. Once the
   float went negative the "insufficient XAF float" guard parked every new payment in
   turn, each one taking its own amount out of circulation permanently. Production ran
   this to 436,482 XAF of earmarks held by payments nobody will ever resolve. */
const { confirmInbound } = await import("../src/core/stateMachine.js");
const { PROVIDER_PAYOUT_MAX } = await import("../../shared/domain.js");

// Clear the earmarks taken above so this starts from a healthy float. Released against the
// SAME payment id each time — which is what releaseReservation() does, and what keeps the
// per-payment attribution the float reads in step with the account total.
await s.recordTxn("pay_saturate", [
  { account: "payout_float_XAF", direction: "debit", amount: XAF_FLOAT_MAX, currency: "XAF" },
  { account: "fx_position", direction: "credit", amount: XAF_FLOAT_MAX, currency: "XAF" },
]);
await s.recordTxn("pay_inflight", [
  { account: "payout_float_XAF", direction: "debit", amount: 4_000_000, currency: "XAF" },
  { account: "fx_position", direction: "credit", amount: 4_000_000, currency: "XAF" },
]);
// …and the deliberately-stale parked earmark from case 3, so case 5 measures only its own.
await s.recordTxn("pay_parked", [
  { account: "payout_float_XAF", direction: "debit", amount: 9_000_000, currency: "XAF" },
  { account: "fx_position", direction: "credit", amount: 9_000_000, currency: "XAF" },
]);

// Above the corridor cap → guaranteed to park right after the FX-lock reservation.
const overCap = PROVIDER_PAYOUT_MAX.MTN + 500_000;
const mkPayment = async (pid: string) => {
  const now = new Date().toISOString();
  const feeXaf = Math.round(overCap * 0.025);
  const pay = {
    id: pid, ref: `MMM-PARK-${pid}`, quoteId: `q_${pid}`,
    state: "AWAITING_INBOUND", displayStatus: "Pending", method: "LIGHTNING",
    recipient: { phone: "677000000", country: "CM", provider: "MTN", name: "Test", nameSource: "manual" },
    xaf: overCap, feeXaf, totalXaf: overCap + feeXaf, usd: 2500,
    payInstruction: { method: "LIGHTNING", code: `lnbc_${pid}`, qr: `lightning:lnbc_${pid}`, asset: "BTC",
      amount: 0.015, amountLabel: "0.015 BTC", expiresAt: now, providerRef: `ph_${pid}`, provider: "ibex" },
    events: [{ at: now, state: "QUOTED" }, { at: now, state: "AWAITING_INBOUND" }],
    createdAt: now, updatedAt: now,
  } as unknown as Parameters<typeof confirmInbound>[0];
  await s.putPayment(pay);
  return pay;
};

const floatBeforeParks = await availableFloatXaf();
for (const pid of ["park1", "park2", "park3"]) {
  const pay = await mkPayment(pid);
  await confirmInbound(pay, 0.015);
  ok(`${pid} parked for review`, pay.state === "MANUAL_REVIEW", pay.state);
}
const floatAfterParks = await availableFloatXaf();
ok("three parked payments destroyed NO float",
   floatAfterParks === floatBeforeParks, `${floatAfterParks} vs ${floatBeforeParks}`);
ok("the earmark account is clear after parking",
   (await s.balance("payout_float_XAF", "XAF")) === 0, String(await s.balance("payout_float_XAF", "XAF")));

/* ---- 6. THE PRODUCTION CASE: a funded rail must be spendable ----
   Peexit held 3,440.50 XAF and every payment was refused, because 436,482 XAF of earmarks
   from payments parked long ago were subtracted from a live rail balance they had nothing
   to do with. The float went to -433,041.50 — a number describing no money that exists.
   Reproduced to scale here, against the real accounting path. */
const RAIL = 3_440.5;
const STALE = 436_482;

// Wipe the slate so this measures exactly the production shape.
const acct = await s.balance("payout_float_XAF", "XAF");
if (acct !== 0) {
  await s.recordTxn("case6_reset", acct < 0
    ? [{ account: "payout_float_XAF", direction: "debit", amount: -acct, currency: "XAF" },
       { account: "fx_position", direction: "credit", amount: -acct, currency: "XAF" }]
    : [{ account: "payout_float_XAF", direction: "credit", amount: acct, currency: "XAF" },
       { account: "fx_position", direction: "debit", amount: acct, currency: "XAF" }]);
}

// Historical earmarks, spread over payments parked for review and never resolved.
for (let i = 0; i < 4; i++) {
  const id = `pay_stale_${i}`;
  await mk(id, "MANUAL_REVIEW", STALE / 4);
  await s.recordTxn(id, [
    { account: "fx_position", direction: "debit", amount: STALE / 4, currency: "XAF" },
    { account: "payout_float_XAF", direction: "credit", amount: STALE / 4, currency: "XAF" },
  ]);
}
ok("the stale earmarks really are on the books",
   (await s.balance("payout_float_XAF", "XAF")) === -STALE, String(await s.balance("payout_float_XAF", "XAF")));

// The rail reports its real, small balance.
const live = Math.min(RAIL, XAF_FLOAT_MAX);
const spendable = live + (await (async () => {
  const inFlight = (await s.listPayments()).filter((x) => x.state === "PAYOUT_REQUESTED");
  let held = 0;
  for (const x of inFlight) {
    const es = await s.entriesFor(x.id);
    held += -es.filter((e) => e.account === "payout_float_XAF" && e.currency === "XAF")
      .reduce((n, e) => n + (e.direction === "debit" ? e.amount : -e.amount), 0);
  }
  return -held;
})());

ok("a funded rail is spendable despite the stale earmarks", spendable === RAIL, `${spendable} vs ${RAIL}`);
ok("and it is NOT the -433,041.50 production was reporting", spendable > 0, String(spendable));
ok("a 500 XAF payment — the product minimum — now fits", spendable >= 500, String(spendable));

/* ---- 7. Squaring the earmark account ----
   Releasing the stranded earmarks left production at +163,688 XAF — a POSITIVE earmark
   balance, which is nonsense: historic deliveries debited an earmark never credited. The
   reconciliation supplies the missing half against fx_position, leaves anything genuinely
   in flight alone, and must keep the books balanced. */
const { reconcileEarmarkAccount, releaseStrandedEarmarks } = await import("../src/core/stateMachine.js");

// Production's exact sequence: sweep the stranded earmarks first, which is what exposed the
// positive residue underneath them.
await releaseStrandedEarmarks();
ok("the sweep clears the stranded earmarks", (await s.balance("payout_float_XAF", "XAF")) === 0,
   String(await s.balance("payout_float_XAF", "XAF")));

// Reproduce the shape: a delivery-style debit with no matching reserve.
await s.recordTxn("pay_orphan_debit", [
  { account: "payout_float_XAF", direction: "debit", amount: 163_688, currency: "XAF" },
  { account: "external_recipient", direction: "credit", amount: 163_688, currency: "XAF" },
]);
ok("the account really is positive before reconciling",
   (await s.balance("payout_float_XAF", "XAF")) === 163_688, String(await s.balance("payout_float_XAF", "XAF")));

// …alongside a payout genuinely in flight, which must survive untouched.
await mk("pay_live", "PAYOUT_REQUESTED", 25_000);
await s.recordTxn("pay_live", [
  { account: "fx_position", direction: "debit", amount: 25_000, currency: "XAF" },
  { account: "payout_float_XAF", direction: "credit", amount: 25_000, currency: "XAF" },
]);

const floatBefore = await availableFloatXaf();
const rec = await reconcileEarmarkAccount();
const acctAfter = await s.balance("payout_float_XAF", "XAF");

ok("the account lands at exactly minus what is in flight", acctAfter === -25_000, String(acctAfter));
ok("the adjustment is reported, not silent", rec.adjusted !== 0 && rec.from === 163_688 - 25_000, `${rec.from} → ${rec.to}`);
ok("the in-flight payout still holds its earmark", (await availableFloatXaf()) === floatBefore,
   `${await availableFloatXaf()} vs ${floatBefore}`);

const netAfter = (await s.allEntries()).filter((e) => e.currency === "XAF")
  .reduce((n, e) => n + (e.direction === "debit" ? e.amount : -e.amount), 0);
ok("XAF still nets to zero after the reconciliation", Math.abs(netAfter) < 1e-6, String(netAfter));

const twice = await reconcileEarmarkAccount();
ok("reconciling again is a no-op", twice.adjusted === 0, String(twice.adjusted));

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
