/* ============================================================
   The domain journal — one versioned record, written once.

   The failures worth asserting are the two ways an event journal on a money path goes
   wrong: it drops what matters, or it becomes the money path. So the test cares less about
   "an event was written" than about the envelope being versioned, a throwing sink being
   survivable and visible, an unknown type being kept rather than refused, and — the one
   that matters most — a payment still settling when the journal is broken.
   Run: pnpm --filter @momome/server test:journal
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
  const { emit, events, onDomainEvent, journalStats, _resetJournal, JOURNAL_V, EVENT_TYPES } = await import("../src/core/journal.js");
  const { store } = await import("../src/db/store.js");
  const { confirmInbound } = await import("../src/core/stateMachine.js");
  const { installJournalProducers } = await import("../src/core/journalProducers.js");

  console.log("\nThe domain journal");

  /* 1. The envelope. A consumer that cannot read a future version must be able to SAY so,
        which it can only do if the version is there from the first record. */
  _resetJournal();
  const e = emit({ type: "payment.transitioned", subject: { type: "payment", id: "p1" }, data: { to: "DELIVERED" } });
  ok("every record carries the envelope version", e.v === JOURNAL_V, `v=${e.v}`);
  ok("and an id and a timestamp", /^ev_/.test(e.id) && !Number.isNaN(Date.parse(e.at)), `${e.id} ${e.at}`);
  ok("a declared type is not flagged", e.unknownType === undefined);

  /* 2. An unknown type is kept and marked — refusing it would lose a new producer's
        events silently, which is worse than an honest surprise in the stats. */
  const u = emit({ type: "something.nobody.declared", data: {} });
  ok("an undeclared type is recorded, not refused", events({ type: "something.nobody.declared" }).length === 1);
  ok("…and is marked as undeclared", u.unknownType === true);
  ok("…and shows up in the stats", journalStats().unknownTypes.includes("something.nobody.declared"), JSON.stringify(journalStats().unknownTypes));

  /* 3. A throwing sink must not take the journal with it, and must not disappear either. */
  _resetJournal();
  let goodRan = 0;
  onDomainEvent("explodes", () => { throw new Error("sink is broken"); });
  onDomainEvent("works", () => { goodRan++; });
  const withFail = emit({ type: "payout.submitted", data: { rail: "peexit" } });
  ok("a throwing sink does not stop emit", events().length === 1);
  ok("…the other sinks still run", goodRan === 1, String(goodRan));
  ok("…and the failure is recorded on the event", withFail.failedSinks?.includes("explodes") === true, JSON.stringify(withFail.failedSinks));
  ok("…and counted in the stats", journalStats().failedSinkEvents === 1);

  /* 4. Reading back: by subject, by type, by time. */
  _resetJournal();
  emit({ type: "payment.transitioned", subject: { type: "payment", id: "pA" }, data: { to: "FX_LOCKED" } });
  emit({ type: "payment.transitioned", subject: { type: "payment", id: "pB" }, data: { to: "FX_LOCKED" } });
  emit({ type: "limit.refused", subject: { type: "payment", id: "pA" }, data: { limit: "daily_limit" } });
  ok("events filter by subject", events({ subjectId: "pA" }).length === 2);
  ok("events filter by type", events({ type: "limit.refused" }).length === 1);
  ok("newest first", events()[0].type === "limit.refused");
  ok("nothing from the future is returned", events({ sinceMs: Date.now() + 60_000 }).length === 0);

  /* 5. THE ONE THAT MATTERS. A broken journal must not break a payment. Every sink throws,
        and the payment still reaches its state through the real engine. */
  _resetJournal();
  onDomainEvent("always-throws", () => { throw new Error("journal is on fire"); });
  installJournalProducers();
  const now = new Date().toISOString();
  const xaf = 1_500_000, feeXaf = Math.round(xaf * 0.025); // above the corridor cap → holds
  const p: Payment = {
    id: "jr1", ref: "MMM-JRN-1", quoteId: "q_jr1",
    state: "AWAITING_INBOUND", displayStatus: "Pending", method: "LIGHTNING",
    recipient: { phone: "677000000", country: "CM", provider: "MTN", name: "", nameSource: "manual" },
    xaf, feeXaf, totalXaf: xaf + feeXaf, usd: 2500,
    payInstruction: { method: "LIGHTNING", code: "lnbc_jr1", qr: "lightning:lnbc_jr1", asset: "BTC", amount: 0.015, amountLabel: "0.015 BTC", expiresAt: now, providerRef: "ph_jr1", provider: "ibex" },
    events: [{ at: now, state: "QUOTED" }, { at: now, state: "AWAITING_INBOUND" }],
    createdAt: now, updatedAt: now,
  };
  await store().putPayment(p);
  await confirmInbound(p, p.payInstruction.amount);
  const settled = await store().getPayment(p.id);
  ok("the payment settles with every journal sink throwing", settled?.state === "MANUAL_REVIEW", settled?.state);
  ok("…and the transitions were journalled anyway", events({ type: "payment.transitioned", subjectId: "jr1" }).length >= 2, String(events({ type: "payment.transitioned", subjectId: "jr1" }).length));
  const t = events({ type: "payment.transitioned", subjectId: "jr1" })[0];
  ok("…with the note, which is the diagnosis", typeof t.data?.note === "string" && String(t.data?.note).length > 0, String(t.data?.note));

  /* 6. The vocabulary is declared, and the producers only emit from it. */
  ok("the declared vocabulary is non-empty", EVENT_TYPES.length > 0, `${EVENT_TYPES.length} types`);
  ok("the producers emitted nothing undeclared", journalStats().unknownTypes.length === 0, JSON.stringify(journalStats().unknownTypes));

  console.log(`\n✅ journal: ${passed} assertions passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
