/* ============================================================
   Payout outcomes split by RAIL × OPERATOR.

   Why this exists. Rail health is per-rail: `peexit` had 109 samples at 47% and a five
   minute average latency, which says "Peexit is degraded" and nothing more. It cannot say
   what an operator actually hit — that Peexit was paying MTN and not paying Orange. That
   asymmetry was found by a person noticing it, and then could not be proved from any
   screen we had.

   The execution log cannot answer it either, and for a reason worth stating: an execution
   is recorded only on COMPLETED or FAILED. A payout the rail accepts and never executes
   reaches NEITHER, so the exact failure we care about — accepted, then silence — is
   invisible to a success-rate built from verdicts. A rail that never answers scores no
   failures at all.

   So this counts what was SUBMITTED against what REACHED A VERDICT, per rail per operator.
   "Submitted 7, resolved 0, oldest 358 minutes" is the shape of a rail that accepts and
   does not pay — and it is the evidence to put in front of the aggregator, because it is
   their own track_ids and their own clock.
   ============================================================ */
import type { Payment, ProviderId, Aggregator } from "../../../shared/types.js";
import { store } from "../db/store.js";

export interface PayoutOperatorStat {
  rail: Aggregator;
  provider: ProviderId;
  /** Payouts submitted to this rail for this operator (any outcome, including none yet). */
  submitted: number;
  delivered: number;
  failed: number;
  /** Submitted, still without a verdict: PAYOUT_REQUESTED, or escalated to MANUAL_REVIEW
   *  with the payout still live at the rail. */
  unresolved: number;
  /** Minutes since the OLDEST unresolved payout was submitted — the number a vendor
   *  cannot argue with. null when nothing is unresolved. */
  oldestUnresolvedMin: number | null;
  /** delivered / (delivered + failed). Null when nothing has reached a verdict — which is
   *  the whole point: a rail that never answers must not read as 100%, nor as 0%. */
  verdictRate: number | null;
}

/** Payouts that were submitted but have not reached a verdict. */
const UNRESOLVED_STATES = new Set(["PAYOUT_REQUESTED", "MANUAL_REVIEW"]);
const DELIVERED_STATES = new Set(["PAYOUT_CONFIRMED", "DELIVERED"]);
const FAILED_STATES = new Set(["FAILED", "REFUND_PENDING", "REFUNDED"]);

/** A payout only counts once it was actually handed to a rail. */
function wasSubmitted(p: Payment): boolean {
  return !!p.aggregator && (!!p.payoutKey || !!p.payoutRef || DELIVERED_STATES.has(p.state) || FAILED_STATES.has(p.state));
}

export function summarise(payments: Payment[], now = Date.now()): PayoutOperatorStat[] {
  const by = new Map<string, PayoutOperatorStat>();
  for (const p of payments) {
    if (!wasSubmitted(p)) continue;
    const rail = p.aggregator as Aggregator;
    const provider = p.recipient?.provider as ProviderId | undefined;
    if (!rail || !provider) continue;
    const key = `${rail}|${provider}`;
    let s = by.get(key);
    if (!s) { s = { rail, provider, submitted: 0, delivered: 0, failed: 0, unresolved: 0, oldestUnresolvedMin: null, verdictRate: null }; by.set(key, s); }
    s.submitted++;
    if (DELIVERED_STATES.has(p.state)) s.delivered++;
    else if (FAILED_STATES.has(p.state)) s.failed++;
    else if (UNRESOLVED_STATES.has(p.state)) {
      s.unresolved++;
      // The clock starts when the payout went out, not when the payment was created.
      const since = Date.parse(p.payoutUnresolvedSince ?? p.updatedAt ?? p.createdAt);
      if (Number.isFinite(since)) {
        const mins = Math.floor((now - since) / 60_000);
        if (s.oldestUnresolvedMin == null || mins > s.oldestUnresolvedMin) s.oldestUnresolvedMin = mins;
      }
    }
  }
  for (const s of by.values()) {
    const verdicts = s.delivered + s.failed;
    s.verdictRate = verdicts ? s.delivered / verdicts : null; // never 1 for "never answered"
  }
  return [...by.values()].sort((a, b) => a.rail.localeCompare(b.rail) || a.provider.localeCompare(b.provider));
}

export async function payoutByOperator(): Promise<PayoutOperatorStat[]> {
  return summarise(await store().listPayments());
}

/** One line per rail×operator pair that looks stuck, for an operator-facing alert: a rail
 *  with unresolved payouts and no verdicts at all for that operator, while it IS resolving
 *  another. That shape — works for one operator, silent for the other — is the one a
 *  per-rail success rate cannot express. */
export function asymmetries(stats: PayoutOperatorStat[]): string[] {
  const out: string[] = [];
  for (const rail of new Set(stats.map((s) => s.rail))) {
    const rows = stats.filter((s) => s.rail === rail);
    const working = rows.filter((r) => r.delivered > 0);
    const silent = rows.filter((r) => r.unresolved > 0 && r.delivered === 0);
    if (working.length && silent.length) {
      for (const s of silent) {
        out.push(
          `${rail}: ${s.provider} has ${s.unresolved} payout(s) with no verdict` +
          (s.oldestUnresolvedMin != null ? ` (oldest ${s.oldestUnresolvedMin} min)` : "") +
          ` while ${working.map((w) => `${w.provider} delivered ${w.delivered}`).join(", ")}` +
          ` — the rail is paying one operator and not the other.`,
        );
      }
    }
  }
  return out;
}
