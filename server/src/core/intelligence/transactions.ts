/* ============================================================
   Transaction intelligence — "what happened to this payment, and where did the time go".

   The first capability, chosen because it is the first question an operator actually asks,
   and because the evidence for it already exists in full: the payment carries every
   transition with its timestamp, the journal carries what was refused, the rail registry
   carries who was asked. Nothing here needs new data collection — which is also the test of
   whether the spine built in core/journal.ts was worth building.

   Every claim is grounded and LABELLED. A fact is in the records; an inference says what it
   was derived from; a hypothesis is a possible explanation the records do not settle. The
   hypotheses are the honest part: "the rail has not answered for 40 minutes" is a fact, and
   "the rail is probably down" is not — rail health would have to say so, and even then it
   describes now rather than then.
   ============================================================ */
import type { CapabilityDef, Claim, Evidence } from "../../../../shared/intelligence.js";
import type { Payment, PaymentState } from "../../../../shared/types.js";
import { store } from "../../db/store.js";
import { events as journalEvents } from "../journal.js";
import { payoutHealth } from "../routing.js";
import { answer, claim } from "./contract.js";

export const TRANSACTION_INTELLIGENCE: CapabilityDef = {
  key: "transaction",
  title: "Transaction intelligence",
  what: "What happened to one payment, in order, with where the time went and what is still unknown.",
  // Deliberately narrow. It may read the payment, its own events, the journal and rail
  // health. It may NOT cite the ledger or settings: it has no business explaining a payment
  // by reaching for the books, and a capability that can cite anything is not scoped.
  reads: ["payment", "payment_event", "journal_event", "rail"],
  // Whoever may look at payments may ask about one. Not a new permission: the console's
  // existing section gate decides, which is also why a future capability whose audience is
  // different (financial intelligence belongs to "reports") must declare that section and
  // get its own path prefix — sectionForPath keys on the first path segment.
  section: "payments",
};

const ms = (n: number): string => (n < 1000 ? `${n} ms` : n < 90_000 ? `${Math.round(n / 1000)} s` : `${Math.round(n / 60_000)} min`);

/** What a state MEANS to someone who does not read the code. */
const MEANING: Record<PaymentState, string> = {
  QUOTED: "a rate was quoted and nothing was created yet",
  AWAITING_INBOUND: "we are waiting for the sender's money",
  INBOUND_DETECTED: "the sender's money was seen but is not yet confirmed",
  INBOUND_CONFIRMED: "the sender's money is confirmed and booked",
  FX_LOCKED: "the rate is locked and the payout float is earmarked",
  PAYOUT_REQUESTED: "a Mobile Money rail accepted the payout and has not confirmed it yet",
  PAYOUT_CONFIRMED: "the rail confirmed the payout",
  DELIVERED: "the recipient has the money",
  REFUND_PENDING: "the money is going back to the sender and a destination is needed or in flight",
  REFUNDED: "the money went back to the sender",
  FAILED: "it ended without the sender's money ever arriving",
  MANUAL_REVIEW: "it is held for a person to look at",
};

export async function explainPayment(refOrId: string, askedBy: string) {
  const needle = refOrId.trim();
  const p = (await store().findPaymentByRef(needle)) ?? (await store().getPayment(needle));
  if (!p) return null;

  const ev = (e: { at: string; state: PaymentState; note?: string }, i: number): Evidence =>
    ({ id: `${p.id}#${i}`, kind: "payment_event", label: `${e.state}${e.note ? ` · ${e.note}` : ""}`, at: e.at });
  const self: Evidence = { id: p.id, kind: "payment", label: `${p.ref} · ${p.xaf} XAF to ${p.recipient.provider}`, at: p.createdAt };

  const claims: Claim[] = [];
  const unknowns: string[] = [];
  const assumptions: string[] = [];

  /* Where it stands. */
  claims.push(claim("fact",
    `${p.ref} is ${p.state} — ${MEANING[p.state]}. It is ${p.xaf} XAF to a ${p.recipient.provider} number${p.aggregator ? `, carried by ${p.aggregator}` : ""}.`,
    [self], "high",
    [{ label: "amount", value: p.xaf, unit: "XAF" }]));

  /* Why, when somebody wrote it down. The note on the terminal transition is the single
     most useful line in the record and the one an operator never finds. */
  const lastWithNote = [...p.events].reverse().find((e) => e.note);
  if (lastWithNote) {
    const i = p.events.indexOf(lastWithNote);
    claims.push(claim("fact", `The last thing the engine recorded about it: "${lastWithNote.note}".`, [ev(lastWithNote, i)], "high"));
  }

  /* Where the time went. */
  const first = (s: PaymentState) => { const i = p.events.findIndex((e) => e.state === s); return i < 0 ? null : { i, t: Date.parse(p.events[i].at) }; };
  const steps: Array<{ label: string; from: PaymentState; to: PaymentState }> = [
    { label: "the sender took", from: "AWAITING_INBOUND", to: "INBOUND_CONFIRMED" },
    { label: "locking the rate took", from: "INBOUND_CONFIRMED", to: "FX_LOCKED" },
    { label: "getting a rail to accept the payout took", from: "FX_LOCKED", to: "PAYOUT_REQUESTED" },
    { label: "the rail took to confirm", from: "PAYOUT_REQUESTED", to: "PAYOUT_CONFIRMED" },
    { label: "delivering took", from: "PAYOUT_CONFIRMED", to: "DELIVERED" },
  ];
  const timed = steps.map((s) => { const a = first(s.from), b = first(s.to); return a && b && b.t >= a.t ? { ...s, d: b.t - a.t, a, b } : null; }).filter(Boolean) as Array<typeof steps[number] & { d: number; a: { i: number }; b: { i: number } }>;
  if (timed.length) {
    claims.push(claim("fact",
      `Timing: ${timed.map((t) => `${t.label} ${ms(t.d)}`).join(", ")}.`,
      timed.flatMap((t) => [ev(p.events[t.a.i], t.a.i), ev(p.events[t.b.i], t.b.i)]).slice(0, 6), "high",
      timed.map((t) => ({ label: t.label, value: t.d, unit: "ms" }))));
    const slowest = [...timed].sort((x, y) => y.d - x.d)[0];
    // An INFERENCE, and it says what from. Calling the slowest step "the problem" would be
    // the hypothesis; that the slowest step is the slowest is arithmetic.
    claims.push(claim("inference",
      `Most of the elapsed time was "${slowest.label} ${ms(slowest.d)}" — derived from the transition timestamps on this payment, not from any separate measurement.`,
      [ev(p.events[slowest.b.i], slowest.b.i)], "high",
      [{ label: slowest.label, value: slowest.d, unit: "ms" }]));
  }

  /* Still in flight: say how long, and resist saying why. */
  if (p.state === "PAYOUT_REQUESTED") {
    const since = [...p.events].reverse().find((e) => e.state === "PAYOUT_REQUESTED");
    const waited = since ? Date.now() - Date.parse(since.at) : 0;
    const rail = p.aggregator ?? "the rail";
    const h = p.aggregator ? payoutHealth(p.aggregator) : null;
    claims.push(claim("fact", `${rail} accepted this payout ${ms(waited)} ago and has not reported an outcome.`, [self], "high", [{ label: "waiting", value: waited, unit: "ms" }]));
    if (h && h.samples === 0) {
      // Unknown is not healthy, and it is not unhealthy either.
      claims.push(claim("hypothesis", `Nothing can be said about ${rail}'s current reliability: it has no recorded outcomes on this deployment, so its success rate is unknown rather than good.`, [{ id: rail, kind: "rail", label: `${rail}: no samples` }], "low"));
      unknowns.push(`whether ${rail} is healthy — it has produced no outcomes to judge by`);
    } else if (h) {
      claims.push(claim(h.eligible ? "fact" : "hypothesis",
        h.eligible
          ? `${rail} is currently in rotation, with ${Math.round(h.successRate * 100)}% of its last outcomes successful over ${h.samples} samples.`
          : `${rail} is currently OUT of rotation on this deployment, which may or may not be why this payout is unanswered — its health reflects now, not the moment this payment was submitted.`,
        [{ id: rail, kind: "rail", label: `${rail}: ${h.samples} samples, eligible=${h.eligible}` }],
        h.eligible ? "medium" : "low",
        [{ label: "success rate", value: Math.round(h.successRate * 100), unit: "%" }, { label: "samples", value: h.samples }]));
      assumptions.push("rail health describes the rail now, not necessarily its state when this payment was submitted");
    }
    unknowns.push("the authoritative outcome — only a re-query of the rail settles it, and the reconcile backstop does that on its own schedule");
  }

  /* What the deployment refused around it, if anything. The journal is why this is possible. */
  const refusals = journalEvents({ subjectId: p.id, limit: 20 }).filter((e) => e.type !== "payment.transitioned");
  if (refusals.length) {
    claims.push(claim("fact",
      `The journal also records ${refusals.length} non-transition event(s) for this payment: ${[...new Set(refusals.map((r) => r.type))].join(", ")}.`,
      refusals.slice(0, 5).map((r) => ({ id: r.id, kind: "journal_event" as const, label: `${r.type}${r.data?.note ? ` · ${String(r.data.note)}` : ""}`, at: r.at })),
      "high", [{ label: "events", value: refusals.length }]));
  }

  if (p.state === "MANUAL_REVIEW") unknowns.push("what an operator decided — a hold is only resolved by a person, and nothing here records an intention");

  return answer({
    def: TRANSACTION_INTELLIGENCE,
    question: `What happened to ${p.ref}?`,
    askedBy, claims, assumptions, unknowns,
    dataUpdatedAt: p.updatedAt,
  });
}
