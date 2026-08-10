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
};

/** True when the Postgres backend is selected (STORE_BACKEND=postgres). */
export function usingPostgres(): boolean {
  return (process.env.STORE_BACKEND ?? "").toLowerCase() === "postgres";
}

/** The active store backend for this process. */
export function store(): Store {
  return usingPostgres() ? pgStore : memoryStore;
}
