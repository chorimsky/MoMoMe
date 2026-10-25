/* ============================================================
   The intelligence contract, and the first capability built on it.

   The claim being tested is not "the answer is useful" — that is a judgement. It is the one
   mechanical property that makes an LLM safe to put in front of money data:

     A CLAIM MAY ONLY CARRY A NUMBER THE ENGINE COMPUTED.

   "The model is instructed not to invent numbers" is not a control. A control fails closed,
   so the phrasing is checked against the computed facts and discarded when it does not
   match. Most of what follows exercises that guard directly — including the two ways it
   could be useless: by never firing (a fabricated figure gets through) and by always firing
   (ordinary prose is rejected over a year or a reference number, so nobody dares enable it).

   The rest asserts the properties the blueprint asks for by name: facts told apart from
   inferences and hypotheses (§23), capability scope enforced outside the capability (§20),
   unknowns stated rather than omitted (§31), and an answer that still exists with no model
   configured at all (§34).
   Run: pnpm --filter @momome/server test:intel
   ============================================================ */
import assert from "node:assert/strict";
import type { Payment } from "../../shared/types.js";
import type { Claim } from "../../shared/intelligence.js";

process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";
delete process.env.META_AI_API_KEY; // no model: the engine must answer on its own

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

async function main() {
  const { unverifiedNumbers, allowedNumbers, answer, claim, intelAuditLog, _resetIntelAudit } = await import("../src/core/intelligence/contract.js");
  const { explainPayment, TRANSACTION_INTELLIGENCE } = await import("../src/core/intelligence/transactions.js");
  const { store } = await import("../src/db/store.js");
  const { emit, _resetJournal } = await import("../src/core/journal.js");

  console.log("\nThe intelligence contract");

  /* ── THE GUARD ────────────────────────────────────────────────────────────────────── */
  const facts: Claim[] = [
    claim("fact", "The payout was 50000 XAF.", [{ id: "pay_1", kind: "payment", label: "MMM-TEST-1" }], "high",
      [{ label: "amount", value: 50_000, unit: "XAF" }, { label: "waited", value: 320_669, unit: "ms" }]),
  ];
  ok("a figure the engine computed passes", unverifiedNumbers("It was 50000 XAF.", facts).length === 0);
  ok("…in the thousands-separated form prose uses", unverifiedNumbers("It was 50,000 XAF.", facts).length === 0);
  ok("…and in the French spacing the app also uses", unverifiedNumbers("It was 50 000 XAF.", facts).length === 0);
  ok("…and a duration rounded to minutes, as a sentence would say it", unverifiedNumbers("The rail took about 5 minutes.", facts).length === 0, JSON.stringify(unverifiedNumbers("The rail took about 5 minutes.", facts)));
  // THE CASE THAT MATTERS: a plausible, fluent, completely invented figure.
  const fabricated = unverifiedNumbers("It was 50000 XAF, about 2% of today's volume.", facts);
  ok("a fabricated percentage is caught", fabricated.includes("2"), JSON.stringify(fabricated));
  ok("a fabricated amount is caught", unverifiedNumbers("The payout was 75000 XAF.", facts).includes("75000"));
  ok("a plausible-but-uncomputed count is caught", unverifiedNumbers("Three of the 14 rails were down.", facts).includes("14"));
  // AND THE OTHER FAILURE MODE: a guard that fires on everything is a guard nobody enables.
  ok("an ISO date is not mistaken for a figure", unverifiedNumbers("It was accepted on 2026-10-24T21:00:00Z.", facts).length === 0);
  ok("a cited reference's digits are not mistaken for a figure",
    unverifiedNumbers("MMM-2026-418844 is still waiting.", [claim("fact", "x", [{ id: "MMM-2026-418844", kind: "payment", label: "r" }])]).length === 0);
  ok("prose with no numbers at all passes", unverifiedNumbers("The rail has not answered.", facts).length === 0);
  ok("the allowed set is built from the values, not from the prose", allowedNumbers(facts).has("50000"));

  /* ── NO MODEL: there must still be an answer ──────────────────────────────────────── */
  _resetIntelAudit();
  const a = await answer({ def: TRANSACTION_INTELLIGENCE, question: "What happened?", askedBy: "tester", claims: facts, unknowns: ["nothing is known about the rail"] });
  ok("with no model configured the engine answers anyway", a.summary.length > 0 && a.explainedBy === "engine", a.explainedBy);
  ok("…the summary is the claims, not an empty string", a.summary.includes("50000"), a.summary);
  ok("…the unknowns are carried, not dropped", a.unknowns.length === 1);
  ok("…and the exchange is audited", intelAuditLog()[0]?.capability === "transaction" && intelAuditLog()[0]?.explainedBy === "engine");

  /* ── SCOPE, enforced outside the capability ───────────────────────────────────────── */
  const outOfScope = await answer({
    def: TRANSACTION_INTELLIGENCE, question: "q", askedBy: "tester",
    claims: [claim("fact", "The books balance.", [
      { id: "led_1", kind: "ledger", label: "a ledger row" },      // NOT in reads
      { id: "pay_2", kind: "payment", label: "a payment" },        // in reads
    ])],
  });
  ok("evidence the capability may not read is dropped", outOfScope.claims[0].evidence.length === 1, JSON.stringify(outOfScope.claims[0].evidence.map((e) => e.kind)));
  ok("…and the evidence it may read survives", outOfScope.claims[0].evidence[0].kind === "payment");
  ok("transaction intelligence declares a narrow read set", !TRANSACTION_INTELLIGENCE.reads.includes("ledger") && !TRANSACTION_INTELLIGENCE.reads.includes("settings"), TRANSACTION_INTELLIGENCE.reads.join(","));

  /* ── AUTHORIZATION goes through the console's own gate ────────────────────────────── */
  // The first version of CapabilityDef carried a role of "SUPER_ADMIN" | "ADMIN" |
  // "SUPPORT" — three names that exist nowhere else in this system and that nothing read.
  // A field shaped like an access control and never checked is worse than no field, so the
  // capability now declares a console SECTION and that is asserted against the real gate.
  const { canAccess, ADMIN_ROLES } = await import("../../shared/roles.js");
  ok("the capability declares a real console section", (["payments"] as string[]).includes(TRANSACTION_INTELLIGENCE.section), TRANSACTION_INTELLIGENCE.section);
  const allowed = ADMIN_ROLES.filter((r) => canAccess(r, TRANSACTION_INTELLIGENCE.section));
  const denied = ADMIN_ROLES.filter((r) => !canAccess(r, TRANSACTION_INTELLIGENCE.section));
  ok("…which some roles can reach", allowed.length > 0, allowed.join(", "));
  ok("…and at least one cannot, so the gate is not decorative", denied.length > 0, denied.join(", "));

  /* ── CONFIDENCE is the weakest claim's, never the average ─────────────────────────── */
  const mixed = await answer({ def: TRANSACTION_INTELLIGENCE, question: "q", askedBy: "t", claims: [
    claim("fact", "a", [{ id: "p", kind: "payment", label: "p" }], "high"),
    claim("hypothesis", "b", [{ id: "p", kind: "payment", label: "p" }], "low"),
  ] });
  ok("one low-confidence claim makes the answer low-confidence", mixed.confidence === "low", mixed.confidence);

  /* ── THE CAPABILITY, on a real payment through the real engine ────────────────────── */
  _resetJournal();
  const now = Date.now();
  const at = (s: number) => new Date(now - (600 - s) * 1000).toISOString();
  const p: Payment = {
    id: "pay_intel1", ref: "MMM-INTEL-1", quoteId: "q1",
    state: "PAYOUT_REQUESTED", displayStatus: "Pending", method: "LIGHTNING",
    recipient: { phone: "677000000", country: "CM", provider: "MTN", name: "", nameSource: "manual" },
    xaf: 50_000, feeXaf: 1_250, totalXaf: 51_250, usd: 80,
    payInstruction: { method: "LIGHTNING", code: "ln1", qr: "lightning:ln1", asset: "BTC", amount: 0.0008, amountLabel: "0.0008 BTC", expiresAt: at(0), providerRef: "ph1", provider: "sandbox" },
    events: [
      { at: at(0), state: "QUOTED" }, { at: at(0), state: "AWAITING_INBOUND" },
      { at: at(120), state: "INBOUND_CONFIRMED" }, { at: at(122), state: "FX_LOCKED" },
      { at: at(125), state: "PAYOUT_REQUESTED", note: "submitted to peexit" },
    ],
    createdAt: at(0), updatedAt: at(125), aggregator: "peexit",
  };
  await store().putPayment(p);
  emit({ type: "limit.refused", subject: { type: "payment", id: p.id }, data: { limit: "daily_limit" } });

  const x = await explainPayment("MMM-INTEL-1", "tester");
  assert.ok(x);
  ok("the capability answers by reference", x.capability === "transaction" && x.claims.length >= 3, `${x.claims.length} claims`);
  ok("…and by id too", (await explainPayment("pay_intel1", "tester"))?.claims.length === x.claims.length);
  ok("every claim cites at least one piece of evidence", x.claims.every((c) => c.evidence.length > 0));
  ok("every claim is labelled fact, inference or hypothesis", x.claims.every((c) => ["fact", "inference", "hypothesis"].includes(c.kind)));
  ok("the state is explained in words, not just named", x.claims[0].text.includes("has not confirmed it yet"), x.claims[0].text);
  ok("the engine's own note is surfaced — the line an operator never finds", x.claims.some((c) => c.text.includes("submitted to peexit")));
  ok("the timing of each step is a fact", x.claims.some((c) => c.kind === "fact" && c.text.startsWith("Timing:")));
  ok("…and 'where the time went' is an INFERENCE that says what from", x.claims.some((c) => c.kind === "inference" && c.text.includes("derived from the transition timestamps")));
  ok("the sender's two minutes is the slowest step", x.claims.find((c) => c.kind === "inference")!.text.includes("the sender took"), x.claims.find((c) => c.kind === "inference")!.text);
  ok("an unanswered payout states how long, as a fact", x.claims.some((c) => c.kind === "fact" && c.text.includes("has not reported an outcome")));
  ok("rail reliability with no samples is a HYPOTHESIS, not a verdict", x.claims.some((c) => c.kind === "hypothesis" && c.text.includes("unknown rather than good")), JSON.stringify(x.claims.filter((c) => c.kind === "hypothesis").map((c) => c.text)));
  ok("the authoritative outcome is listed as unknown", x.unknowns.some((u) => u.includes("re-query")), JSON.stringify(x.unknowns));
  ok("the journal's non-transition events are cited", x.claims.some((c) => c.text.includes("limit.refused")));
  ok("…and nothing in the answer is out of the declared scope", x.claims.every((c) => c.evidence.every((e) => TRANSACTION_INTELLIGENCE.reads.includes(e.kind))));
  ok("a payment that does not exist is not invented", (await explainPayment("MMM-NOPE-9", "tester")) === null);

  /* Every number the engine put in the answer must pass its own guard — otherwise the
     guard would reject the engine's own template, which is the embarrassing version of
     this bug. */
  ok("the engine's own summary passes the guard it enforces on the model", unverifiedNumbers(x.summary, x.claims).length === 0, JSON.stringify(unverifiedNumbers(x.summary, x.claims)));

  console.log(`\n✅ intelligence: ${passed} assertions passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
