/* ============================================================
   How long each stage of a payment actually takes.

   §35 of the blueprint is right that actuals come before targets, and the audit found half
   the lifecycle unmeasured: HTTP route classes, provider calls and the payout
   request→confirmation gap were instrumented, the rest was not.

   DERIVED, NOT INSTRUMENTED. Every timestamp this needs is already on the payment: each
   transition appends `{ at, state }`. Adding stopwatches to the settlement engine would be
   new writes on the money path to learn something the history already knows. So this reads
   what is there.

   What that buys, and what it costs: it is free, retrospective (it can answer about last
   month, not only about payments made since someone remembered to measure), and it cannot
   break a payment. It is also only as granular as the states — it can say how long FX_LOCKED
   → PAYOUT_REQUESTED took, not which of the six pre-flight gates inside it was slow.

   TWO HONESTY RULES, both the same rule the delivery report and the rail health tracker
   already follow:

     • a percentile over a handful of samples is noise wearing a number, so below
       MIN_SAMPLES every figure is null and `samples` says why. Not zero, not a guess.
     • a payment still in flight is EXCLUDED from the stage it has not finished. Including
       it would quietly report "time so far" as "time taken", which flatters every stage
       that is currently stuck — the exact moment the number matters most.
   ============================================================ */
import type { Payment, PaymentState } from "../../../shared/types.js";
import { store } from "../db/store.js";

/** Below this, percentiles are withheld rather than computed. */
export const MIN_SAMPLES = 5;

/** The stages worth naming, as the pair of states that bound them. */
export const STAGES: Array<{ key: string; from: PaymentState; to: PaymentState; what: string }> = [
  { key: "payer_wait", from: "AWAITING_INBOUND", to: "INBOUND_CONFIRMED", what: "invoice shown → the payer's money confirmed (mostly the payer's own time, and the rail's)" },
  { key: "fx_lock", from: "INBOUND_CONFIRMED", to: "FX_LOCKED", what: "money booked → rate locked and float earmarked (ours)" },
  { key: "payout_submit", from: "FX_LOCKED", to: "PAYOUT_REQUESTED", what: "rate locked → payout accepted by a rail (ours: gates, routing, balance reads)" },
  { key: "rail_confirm", from: "PAYOUT_REQUESTED", to: "PAYOUT_CONFIRMED", what: "payout accepted → the rail confirms it (theirs)" },
  { key: "delivery", from: "PAYOUT_CONFIRMED", to: "DELIVERED", what: "confirmed → delivered (ours: ledger, identity, notification)" },
  { key: "end_to_end", from: "AWAITING_INBOUND", to: "DELIVERED", what: "the whole thing as the sender experiences it" },
  // Ours alone: the part a service-level target could honestly be set on, since it excludes
  // both the payer's thinking time and the rail's confirmation.
  { key: "ours_only", from: "INBOUND_CONFIRMED", to: "PAYOUT_REQUESTED", what: "money in → payout accepted (the only stretch entirely ours)" },
];

export interface StageStat {
  key: string; what: string; samples: number;
  p50: number | null; p95: number | null; p99: number | null; max: number | null;
  /** Why the figures are null, when they are. */
  note?: string;
}

const pct = (sorted: number[], p: number): number =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];

/** First time the payment entered this state. A re-entry (a failover returning to
 *  PAYOUT_REQUESTED, a re-price re-locking FX) must not restart the clock for the stage
 *  that LEADS INTO it, or a retried payment would report a shorter stage than it had. */
const firstAt = (p: Payment, state: PaymentState): number | undefined => {
  const e = p.events.find((x) => x.state === state);
  return e ? Date.parse(e.at) : undefined;
};

/** Durations in ms for one stage, over the payments given. */
export function durations(payments: Payment[], from: PaymentState, to: PaymentState): number[] {
  const out: number[] = [];
  for (const p of payments) {
    const a = firstAt(p, from), b = firstAt(p, to);
    // Both ends required: a payment that has not reached `to` has no duration, only an
    // age, and the two must never be mixed.
    if (a === undefined || b === undefined) continue;
    const d = b - a;
    // A negative or absurd span means the events are not in order (a restored snapshot, a
    // clock change). Drop it rather than let one bad row move a percentile.
    if (d < 0 || d > 30 * 86_400_000) continue;
    out.push(d);
  }
  return out.sort((x, y) => x - y);
}

export function stageStats(payments: Payment[]): StageStat[] {
  return STAGES.map(({ key, from, to, what }) => {
    const d = durations(payments, from, to);
    if (d.length < MIN_SAMPLES) {
      return { key, what, samples: d.length, p50: null, p95: null, p99: null, max: null, note: `fewer than ${MIN_SAMPLES} completed samples — no percentile is meaningful yet` };
    }
    return { key, what, samples: d.length, p50: pct(d, 50), p95: pct(d, 95), p99: pct(d, 99), max: d[d.length - 1] };
  });
}

/** The whole deployment, optionally limited to a window. */
export async function latencyReport(sinceMs?: number): Promise<{ stages: StageStat[]; payments: number; window: string; minSamples: number }> {
  const all = await store().listPayments();
  const considered = sinceMs ? all.filter((p) => Date.parse(p.createdAt) >= sinceMs) : all;
  return {
    stages: stageStats(considered),
    payments: considered.length,
    window: sinceMs ? `since ${new Date(sinceMs).toISOString()}` : "all time",
    minSamples: MIN_SAMPLES,
  };
}
