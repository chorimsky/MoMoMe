/* ============================================================
   Swappable async data store — the seam the whole serverless migration turns on.
   The app talks to `store()` (async); the backend is chosen by STORE_BACKEND:
     • "postgres" → the transactional Postgres repos (db/repo.ts), for Vercel.
     • anything else (default) → memory, which DELEGATES to the existing, battle-tested
       sync core/store.ts + core/ledger.ts. No logic is duplicated — the memory backend
       is a thin async facade, so Railway + every existing test keep their exact behaviour.
   Call sites migrate from direct `store.getPayment(...)` to `await store().getPayment(...)`
   incrementally; both run on the same in-memory maps until the flip.
   ============================================================ */
import type { Payment, Quote, LedgerAccount, LedgerEntry } from "../../../shared/types.js";
import * as mem from "../core/store.js";
import * as memLedger from "../core/ledger.js";
import * as pg from "./repo.js";
import { withTx } from "./pg.js";

export type Leg = pg.Leg;

export interface Store {
  // quotes
  putQuote(q: Quote): Promise<void>;
  getQuote(id: string): Promise<Quote | undefined>;
  claimQuote(id: string): Promise<Quote | undefined>;   // atomic single-winner
  consumeQuote(id: string): Promise<void>;
  pruneExpiredQuotes(): Promise<number>;
  // payments
  putPayment(p: Payment): Promise<void>;
  getPayment(id: string): Promise<Payment | undefined>;
  findPaymentByRef(ref: string): Promise<Payment | undefined>;
  findByProviderRef(ref: string): Promise<Payment | undefined>;
  indexProviderRef(ref: string, paymentId: string): Promise<void>;
  listPayments(): Promise<Payment[]>;
  // ledger
  recordTxn(paymentId: string, legs: Leg[]): Promise<void>;
  balance(account: LedgerAccount, currency: LedgerEntry["currency"]): Promise<number>;
  reversePayment(paymentId: string): Promise<void>;
  hasDelivered(paymentId: string): Promise<boolean>;
  entriesFor(paymentId: string): Promise<LedgerEntry[]>;
  allEntries(): Promise<LedgerEntry[]>;
  // Mutual exclusion — run `fn` while holding a per-payment lock so a money-moving
  // critical section (confirmInbound / onPayoutResult / refund) is serialized across
  // CONCURRENT serverless instances. Postgres: a transaction-scoped advisory lock;
  // memory: an in-process per-key mutex. Re-read the payment INSIDE `fn` — a second
  // caller must see the first's committed result and abort. Not re-entrant per payment.
  lockPayment<T>(paymentId: string, fn: () => Promise<T>): Promise<T>;
  // Compliance chain — durable APPEND-ONLY log (Postgres compliance_chain table). The
  // coarse key→JSON snapshot is last-writer-wins and can silently lose a concurrently
  // appended STR/CTR event across instances; this table cannot (each event is its own row,
  // keyed by hash for idempotency), so the 10-year legal record is retained. No-op on memory
  // (the in-memory array + snapshot already hold it in a single process).
  appendComplianceEvent(ev: { id: string; kind: string; prevHash: string; hash: string; body: unknown }): Promise<void>;
  allComplianceEvents(): Promise<unknown[]>;
}

/** In-process per-key mutex for the memory backend (single process): chains callers
 *  for a given key so they run one-at-a-time, matching the Postgres advisory lock. */
const _memLocks = new Map<string, Promise<unknown>>();
function lockMem<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = _memLocks.get(key) ?? Promise.resolve();
  const result = prev.then(fn, fn);               // run after the prior holder settles
  const tail = result.then(() => {}, () => {});   // never-rejecting tail for the next waiter
  _memLocks.set(key, tail);
  void tail.then(() => { if (_memLocks.get(key) === tail) _memLocks.delete(key); });
  return result;
}

/** Memory backend — async facade over the existing synchronous core (identical behaviour). */
const memoryStore: Store = {
  putQuote: async (quote) => mem.putQuote(quote),
  getQuote: async (id) => mem.getQuote(id),
  claimQuote: async (id) => mem.claimQuote(id),
  consumeQuote: async (id) => mem.consumeQuote(id),
  pruneExpiredQuotes: async () => mem.pruneExpiredQuotes(),
  putPayment: async (p) => mem.putPayment(p),
  getPayment: async (id) => mem.getPayment(id),
  findPaymentByRef: async (ref) => mem.findPaymentByRef(ref),
  findByProviderRef: async (ref) => mem.findByProviderRef(ref),
  indexProviderRef: async (ref, pid) => mem.indexProviderRef(ref, pid),
  listPayments: async () => mem.listPayments(),
  recordTxn: async (pid, legs) => memLedger.recordTxn(pid, legs),
  balance: async (account, currency) => memLedger.balance(account, currency),
  reversePayment: async (pid) => memLedger.reversePayment(pid),
  hasDelivered: async (pid) => memLedger.hasDelivered(pid),
  entriesFor: async (pid) => memLedger.entriesFor(pid),
  allEntries: async () => memLedger.allEntries(),
  lockPayment: <T>(paymentId: string, fn: () => Promise<T>) => lockMem(paymentId, fn),
  appendComplianceEvent: async () => {}, // memory keeps the chain in-process (array + snapshot)
  allComplianceEvents: async () => [],
};

/** Postgres backend — the transactional repos. */
const pgStore: Store = {
  putQuote: pg.putQuote,
  getQuote: pg.getQuote,
  claimQuote: pg.claimQuote,
  consumeQuote: pg.consumeQuote,
  pruneExpiredQuotes: pg.pruneExpiredQuotes,
  putPayment: pg.putPayment,
  getPayment: pg.getPayment,
  findPaymentByRef: pg.findPaymentByRef,
  findByProviderRef: pg.findByProviderRef,
  indexProviderRef: pg.indexProviderRef,
  listPayments: pg.listPayments,
  recordTxn: pg.recordTxn,
  balance: pg.balance,
  reversePayment: pg.reversePayment,
  hasDelivered: pg.hasDelivered,
  entriesFor: pg.entriesFor,
  allEntries: pg.allEntries,
  lockPayment: <T>(paymentId: string, fn: () => Promise<T>): Promise<T> =>
    withTx(async (client) => {
      // Serialize all callers for this payment across instances until this txn commits.
      // hashtext($1) → int4; the constant namespace (42) avoids clashing with other
      // advisory-lock users. `fn`'s own reads/writes use pooled connections and see the
      // prior holder's committed state (it committed before releasing this lock).
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1), 42)", [paymentId]);
      return fn();
    }),
  appendComplianceEvent: pg.appendComplianceEvent,
  allComplianceEvents: pg.allComplianceEvents,
};

/** True when the Postgres backend is selected (STORE_BACKEND=postgres). */
export function usingPostgres(): boolean {
  return (process.env.STORE_BACKEND ?? "").toLowerCase() === "postgres";
}

/** The active store backend for this process. */
export function store(): Store {
  return usingPostgres() ? pgStore : memoryStore;
}
