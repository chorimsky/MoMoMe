/* ============================================================
   Payment + quote store. In-memory working set, snapshotted to SQLite
   on every mutation (see persist.ts) — durable across restarts.
   ============================================================ */
import type { Payment, Quote } from "../../../shared/types.js";
import { register, touch } from "./persist.js";

export const quotes = new Map<string, Quote>();
export const payments = new Map<string, Payment>();

/** providerRef (LN payment hash / on-chain or TRC20 address) → payment id. */
const byProviderRef = new Map<string, string>();

register(
  "store",
  () => ({ quotes: [...quotes], payments: [...payments], refs: [...byProviderRef] }),
  (d: { quotes: [string, Quote][]; payments: [string, Payment][]; refs: [string, string][] }) => {
    for (const [k, v] of d.quotes) quotes.set(k, v);
    for (const [k, v] of d.payments) payments.set(k, v);
    for (const [k, v] of d.refs) byProviderRef.set(k, v);
  },
);

export function indexProviderRef(ref: string, paymentId: string) {
  byProviderRef.set(ref, paymentId);
  touch("store");
}
export function findByProviderRef(ref: string): Payment | undefined {
  const pid = byProviderRef.get(ref);
  return pid ? payments.get(pid) : undefined;
}

export function putQuote(q: Quote) {
  quotes.set(q.id, q);
  touch("store");
}
export function getQuote(qid: string): Quote | undefined {
  return quotes.get(qid);
}
/** Consume a quote so a locked rate can't be replayed into multiple payments. */
export function consumeQuote(qid: string) {
  quotes.delete(qid);
  touch("store");
}

export function putPayment(p: Payment) {
  payments.set(p.id, p);
  touch("store");
}
export function getPayment(pid: string): Payment | undefined {
  return payments.get(pid);
}

export function listPayments(): Payment[] {
  return [...payments.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function findPaymentByRef(ref: string): Payment | undefined {
  for (const p of payments.values()) if (p.ref === ref) return p;
  return undefined;
}
