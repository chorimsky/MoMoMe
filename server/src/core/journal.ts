/* ============================================================
   The domain journal — one versioned record of what happened, written once.

   WHY, given that four stores already record things: they record DIFFERENT things, for
   different readers, with different retention, and none of them is a spine.

     • `payment.events`      — the row's own history. Perfect for one payment, useless for
                               "what happened in the last hour".
     • `interop/events`      — INBOUND provider callbacks only, with payload hashes.
     • `platform/audit`      — per-organization actions, capped at 5 000.
     • `core/compliance`     — the hash-chained regulatory record. Tamper-evident, and
                               deliberately narrow: it must not become a general log.

   A new consumer (an intelligence capability, an incident timeline, a partner feed) today
   has to pick one of those or invent a fifth. That is the thing to stop before it starts,
   which is why this exists BEFORE the consumers rather than after them.

   What it is not: a queue, and not a replacement for any of the four. Partner delivery
   already has retry, dead-letter and replay (core/interop/outbound). This is the internal
   record those are projections of.

   THE RULES, because an event journal on a money path fails in exactly two ways —
   by dropping what matters, and by becoming the money path:

     1. emit() NEVER throws. A sink that throws is recorded as a failed sink on the event
        and the journal carries on. Nothing here may turn an observability bug into a
        stuck payment.
     2. The envelope is VERSIONED (`v`). A consumer that cannot read v2 must be able to say
        so rather than guess, so the version is on every record from the first one.
     3. `data` is small and non-sensitive: identifiers, amounts, states, reasons. Never a
        raw provider body, never a phone number in full, never a secret. The stores that
        need the raw bytes already hash them.
     4. An unknown type is accepted and FLAGGED, not refused. Refusing would mean a new
        producer silently loses its events; flagging means the vocabulary stays honest.
   ============================================================ */
import { register, touch } from "./persist.js";
import { id } from "./ids.js";

/** Envelope version. Bump when a FIELD changes meaning, not when a type is added. */
export const JOURNAL_V = 1 as const;

export interface DomainEvent {
  id: string;
  /** Envelope schema version — see JOURNAL_V. */
  v: number;
  type: string;
  at: string;
  /** What this is about: a payment, an intent, an organization, a rail. */
  subject?: { type: string; id: string };
  /** Who or what caused it. "provider" means the counterparty told us. */
  actor?: { type: "device" | "credential" | "operator" | "system" | "provider"; id?: string };
  /** Ties related events together across stores and services. */
  correlationId?: string;
  data?: Record<string, unknown>;
  /** Sinks that threw on this event. Present only when something failed, so an empty
   *  journal entry is proof of a clean fan-out rather than of an absent check. */
  failedSinks?: string[];
  /** True when `type` is not in the declared vocabulary (rule 4). */
  unknownType?: boolean;
}

/** The declared vocabulary. Additive: a type listed here is documented, one that is not
 *  still gets recorded and is marked. */
export const EVENT_TYPES = [
  "payment.transitioned",
  "payment.created",
  "payout.submitted",
  "payout.settled",
  "callback.received",
  "rail.health_changed",
  "limit.refused",
  "delegation.refused",
  "transition.undeclared",
] as const;

const CAP = 5_000;
const journal: DomainEvent[] = [];
register("domain_journal", () => journal.slice(-CAP), (d: DomainEvent[]) => { journal.length = 0; journal.push(...(d ?? [])); });

type Sink = { name: string; fn: (e: DomainEvent) => void };
const sinks: Sink[] = [];
/** Register an additional destination. Keeps the dependency direction right: the journal
 *  knows nothing about the audit trail, the compliance chain or a partner feed — they
 *  subscribe to it. A sink must be cheap and must not await the network. */
export function onDomainEvent(name: string, fn: (e: DomainEvent) => void): void { sinks.push({ name, fn }); }

/** Write one event. Returns it (already recorded) so a caller can log its id. Never throws. */
export function emit(input: Omit<DomainEvent, "id" | "v" | "at"> & { at?: string }): DomainEvent {
  const e: DomainEvent = {
    id: id("ev"), v: JOURNAL_V, at: input.at ?? new Date().toISOString(),
    type: input.type, ...(input.subject ? { subject: input.subject } : {}),
    ...(input.actor ? { actor: input.actor } : {}),
    ...(input.correlationId ? { correlationId: input.correlationId } : {}),
    ...(input.data ? { data: input.data } : {}),
    ...((EVENT_TYPES as readonly string[]).includes(input.type) ? {} : { unknownType: true }),
  };
  const failed: string[] = [];
  for (const s of sinks) {
    try { s.fn(e); } catch (err) { failed.push(s.name); console.warn(`[journal] sink ${s.name} threw on ${e.type}:`, err instanceof Error ? err.message : err); }
  }
  if (failed.length) e.failedSinks = failed;
  journal.push(e);
  if (journal.length > CAP * 1.2) journal.splice(0, journal.length - CAP);
  touch("domain_journal");
  return e;
}

export function events(filter: { type?: string; subjectId?: string; sinceMs?: number; limit?: number } = {}): DomainEvent[] {
  const { type, subjectId, sinceMs, limit = 200 } = filter;
  return journal
    .filter((e) => (!type || e.type === type) && (!subjectId || e.subject?.id === subjectId) && (!sinceMs || Date.parse(e.at) >= sinceMs))
    .slice(-limit).reverse();
}

export function journalStats(): { total: number; byType: Record<string, number>; unknownTypes: string[]; failedSinkEvents: number; version: number } {
  const byType: Record<string, number> = {};
  const unknown = new Set<string>();
  let failed = 0;
  for (const e of journal) {
    byType[e.type] = (byType[e.type] ?? 0) + 1;
    if (e.unknownType) unknown.add(e.type);
    if (e.failedSinks?.length) failed++;
  }
  return { total: journal.length, byType, unknownTypes: [...unknown], failedSinkEvents: failed, version: JOURNAL_V };
}

export function _resetJournal(): void { journal.length = 0; sinks.length = 0; }
