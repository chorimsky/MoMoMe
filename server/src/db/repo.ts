/* ============================================================
   Postgres repositories for the money-critical collections — the async equivalents of
   the in-memory core/store.ts + core/ledger.ts. Every atomic operation is a single SQL
   statement or a transaction, so concurrent serverless instances stay correct:
     • claimQuote → DELETE … RETURNING (exactly one winner)
     • ledger post → balanced legs INSERTed in one txn (unbalanced ⇒ throw ⇒ ROLLBACK)
     • payment upsert → ON CONFLICT(id); ref/provider_ref UNIQUE enforce idempotency
   These are NOT yet wired into the app (that's the async-call-site rewrite); they're
   proven in isolation against real Postgres first (test/pg-store.test.ts).
   ============================================================ */
import type { Quote, Payment, LedgerEntry, LedgerAccount } from "../../../shared/types.js";
import { q, withTx } from "./pg.js";

/* ---------------- quotes ---------------- */
export async function putQuote(quote: Quote): Promise<void> {
  await q(
    `INSERT INTO quotes(id, method, expires_at, body) VALUES($1,$2,$3,$4)
     ON CONFLICT(id) DO UPDATE SET method=excluded.method, expires_at=excluded.expires_at, body=excluded.body`,
    [quote.id, quote.method, quote.expiresAt, JSON.stringify(quote)],
  );
}
export async function getQuote(id: string): Promise<Quote | undefined> {
  const rows = await q<{ body: Quote }>(`SELECT body FROM quotes WHERE id=$1`, [id]);
  return rows[0]?.body;
}
/** Atomic single-winner claim: the row is DELETEd and returned to exactly one caller;
 *  a racing instance gets 0 rows → undefined (→ the API's "quote already used" 404). */
export async function claimQuote(id: string): Promise<Quote | undefined> {
  const rows = await q<{ body: Quote }>(`DELETE FROM quotes WHERE id=$1 RETURNING body`, [id]);
  return rows[0]?.body;
}
export async function pruneExpiredQuotes(): Promise<number> {
  const rows = await q(`DELETE FROM quotes WHERE expires_at < now() RETURNING id`);
  return rows.length;
}
export async function consumeQuote(id: string): Promise<void> {
  await q(`DELETE FROM quotes WHERE id=$1`, [id]);
}

/* ---------------- payments ---------------- */
export async function putPayment(p: Payment): Promise<void> {
  await q(
    `INSERT INTO payments(id, ref, state, method, provider_ref, sender_id, quote_id, aggregator, merchant_id, body, updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
     ON CONFLICT(id) DO UPDATE SET
       state=excluded.state, provider_ref=excluded.provider_ref, sender_id=excluded.sender_id,
       aggregator=excluded.aggregator, merchant_id=excluded.merchant_id, body=excluded.body, updated_at=now()`,
    [p.id, p.ref, p.state, p.method, p.payInstruction?.providerRef ?? null, p.senderId ?? null,
     p.quoteId ?? null, p.aggregator ?? null, p.merchantId ?? null, JSON.stringify(p)],
  );
}
export async function getPayment(id: string): Promise<Payment | undefined> {
  const rows = await q<{ body: Payment }>(`SELECT body FROM payments WHERE id=$1`, [id]);
  return rows[0]?.body;
}
export async function findPaymentByRef(ref: string): Promise<Payment | undefined> {
  const rows = await q<{ body: Payment }>(`SELECT body FROM payments WHERE ref=$1`, [ref]);
  return rows[0]?.body;
}
export async function findByProviderRef(providerRef: string): Promise<Payment | undefined> {
  const rows = await q<{ body: Payment }>(`SELECT body FROM payments WHERE provider_ref=$1`, [providerRef]);
  return rows[0]?.body;
}
export async function listPayments(): Promise<Payment[]> {
  const rows = await q<{ body: Payment }>(`SELECT body FROM payments ORDER BY created_at DESC`);
  return rows.map((r) => r.body);
}
/** Point a providerRef at a payment (when the instruction is minted after the row).
 *  The provider_ref UNIQUE index makes a second payment claiming the same ref throw —
 *  the same "no webhook fan-out" guarantee putPayment gives. */
export async function indexProviderRef(providerRef: string, paymentId: string): Promise<void> {
  await q(`UPDATE payments SET provider_ref=$1, updated_at=now() WHERE id=$2`, [providerRef, paymentId]);
}

/* ---------------- ledger (append-only, double-entry) ---------------- */
export interface Leg { account: LedgerAccount; direction: "debit" | "credit"; amount: number; currency: LedgerEntry["currency"] }
const signed = (l: Leg) => (l.direction === "debit" ? l.amount : -l.amount);

/** Append a BALANCED journal transaction (debits == credits per currency) in one txn.
 *  Amount stored SIGNED (debit +, credit −) so a balance is a trivial SUM. */
export async function recordTxn(paymentId: string, legs: Leg[], at = new Date().toISOString(), txnId = `txn_${paymentId}_${legs.length}`): Promise<void> {
  const net = new Map<string, number>();
  for (const l of legs) net.set(l.currency, (net.get(l.currency) ?? 0) + signed(l));
  for (const [ccy, n] of net) if (Math.abs(n) > 1e-9) throw new Error(`Unbalanced ledger txn for ${paymentId}: ${ccy} nets ${n}`);
  await withTx(async (client) => {
    for (const l of legs) {
      await client.query(
        `INSERT INTO ledger(payment_id, account, currency, amount, memo, at, body)
         VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [paymentId, l.account, l.currency, signed(l), null, at, JSON.stringify({ txnId, ...l })],
      );
    }
  });
}
/** Live balance of an account — SUM of signed amounts (never a stored column). */
export async function balance(account: LedgerAccount, currency: LedgerEntry["currency"]): Promise<number> {
  const rows = await q<{ sum: string | null }>(
    `SELECT COALESCE(sum(amount),0)::text AS sum FROM ledger WHERE account=$1 AND currency=$2`, [account, currency],
  );
  return Number(rows[0]?.sum ?? 0);
}
export async function entriesFor(paymentId: string): Promise<Array<{ account: string; direction: string; amount: number; currency: string }>> {
  const rows = await q<{ account: string; currency: string; amount: string }>(
    `SELECT account, currency, amount FROM ledger WHERE payment_id=$1 ORDER BY seq`, [paymentId],
  );
  return rows.map((r) => { const a = Number(r.amount); return { account: r.account, currency: r.currency, direction: a >= 0 ? "debit" : "credit", amount: Math.abs(a) }; });
}
