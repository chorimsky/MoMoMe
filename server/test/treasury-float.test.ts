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

/* ---- 3. In-flight reservations DO reduce it — that is the real exposure ---- */
await s.recordTxn("pay_inflight", [
  { account: "payout_float_XAF", direction: "credit", amount: 4_000_000, currency: "XAF" },
  { account: "payout_payable", direction: "debit", amount: 4_000_000, currency: "XAF" },
]);

const withInflight = await availableFloatXaf();
ok("an in-flight reservation lowers the float by exactly its amount",
   withInflight === XAF_FLOAT_MAX - 4_000_000, `${withInflight} vs ${XAF_FLOAT_MAX - 4_000_000}`);
ok("the basis reports the in-flight figure", floatBasisNote().includes("4000000"), floatBasisNote().slice(0, 120));

/* ---- 4. Enough concurrent exposure still blocks — the cap must actually bind ---- */
await s.recordTxn("pay_saturate", [
  { account: "payout_float_XAF", direction: "credit", amount: XAF_FLOAT_MAX, currency: "XAF" },
  { account: "payout_payable", direction: "debit", amount: XAF_FLOAT_MAX, currency: "XAF" },
]);

const saturated = await availableFloatXaf();
ok("committing the whole ceiling exhausts the float", saturated <= 0, `${saturated} XAF`);
ok("the cap binds on EXPOSURE, so it recovers when reservations clear — unlike history",
   saturated === XAF_FLOAT_MAX - 4_000_000 - XAF_FLOAT_MAX, `${saturated} XAF`);

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
