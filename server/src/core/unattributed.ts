/* ============================================================
   Unattributed inbound — crypto that arrived with no payment to attach it to.

   The rail webhook used to end at:

       const payment = await store().findByProviderRef(event.providerRef);
       if (!payment) return res.json({ ok: true, unmatched: true });

   — a 200 and nothing else. Money had landed on an address or invoice this platform
   issued, and the platform kept no record of it at all: no ledger entry, no log, nothing
   an operator could ever see. A customer had paid and was waiting on a screen that would
   never change.

   That happens for ordinary reasons. Someone reuses a receive address from an earlier
   payment. A sender pays an invoice whose payment record was never created because the
   payout pre-flight refused it. A rail replays an event for a payment since pruned. None
   of those are exotic, and all of them are somebody's money.

   For a money transmitter it is also the wrong answer on its own terms: funds received
   without an identified purpose are exactly what anti-money-laundering rules require be
   recorded and reviewed, not discarded because a lookup missed.

   So every inbound is captured. It is booked to `refund_payable` — the account whose
   comment already reads "a non-zero balance is money that is not ours" — and listed for an
   operator to attribute or return. Nothing is auto-delivered: without a quote there is no
   recipient, no rate and no obligation, and inventing one would be worse than holding it.
   ============================================================ */
import type { Method, UnattributedInbound } from "../../../shared/types.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";

const byKey = new Map<string, UnattributedInbound>();

register(
  "unattributed",
  () => [...byKey.values()],
  (list: UnattributedInbound[]) => { for (const r of list) byKey.set(keyOf(r.rail, r.providerRef, r.eventId), r); },
);

/** Idempotency key. A rail that redelivers the same event must not create a second record,
 *  and a rail that reports a NEW deposit to the same address must not be folded into the
 *  first — so the event id participates when there is one. */
function keyOf(rail: string, providerRef: string, eventId?: string): string {
  return `${rail}:${providerRef}:${eventId ?? ""}`;
}

/**
 * Record an inbound we cannot attribute. Idempotent on (rail, ref, event): a redelivery
 * bumps `seenCount` and the timestamp rather than double-booking. Returns the record and
 * whether this was the first sighting, so the caller books the ledger exactly once.
 */
export function captureUnattributed(input: {
  rail: string;
  providerRef: string;
  eventId?: string;
  method: Method;
  asset: string;
  amount: number;
  at?: string;
}): { record: UnattributedInbound; isNew: boolean } {
  const key = keyOf(input.rail, input.providerRef, input.eventId);
  const at = input.at ?? new Date().toISOString();
  const existing = byKey.get(key);
  if (existing) {
    existing.seenCount += 1;
    existing.lastSeenAt = at;
    touch("unattributed");
    return { record: existing, isNew: false };
  }
  const record: UnattributedInbound = {
    id: id("unat"),
    rail: input.rail,
    providerRef: input.providerRef,
    eventId: input.eventId,
    method: input.method,
    asset: input.asset,
    amount: input.amount,
    firstSeenAt: at,
    lastSeenAt: at,
    seenCount: 1,
  };
  byKey.set(key, record);
  touch("unattributed");
  return { record, isNew: true };
}

/** Newest first — an operator wants the thing that just landed. */
export function listUnattributed(): UnattributedInbound[] {
  return [...byKey.values()].sort((a, b) => b.firstSeenAt.localeCompare(a.firstSeenAt));
}

export function openUnattributed(): UnattributedInbound[] {
  return listUnattributed().filter((r) => !r.resolvedAt);
}

/** Mark one dealt with. The record is KEPT — it is a receipt of funds, and the audit
 *  question is what happened to it, which an erased row cannot answer. */
export function resolveUnattributed(
  recordId: string,
  resolution: NonNullable<UnattributedInbound["resolution"]>,
  note?: string,
  at: string = new Date().toISOString(),
): UnattributedInbound | null {
  for (const r of byKey.values()) {
    if (r.id !== recordId) continue;
    if (r.resolvedAt) return r; // idempotent — an operator double-click changes nothing
    r.resolvedAt = at;
    r.resolution = resolution;
    if (note) r.note = note.slice(0, 500);
    touch("unattributed");
    return r;
  }
  return null;
}

export type { UnattributedInbound };
