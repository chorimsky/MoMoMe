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
import { randomUUID } from "node:crypto";
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
/** Patch ONE field on a payment atomically, without a read-modify-write.
 *  `senderLocation` is backfilled asynchronously (a geo lookup takes up to 3.5s) while the
 *  settlement state machine may be advancing the SAME row. A read-modify-write would need
 *  the per-payment lock to be safe — but taking that lock here means holding a `withTx`
 *  connection across the backfill while the inner read/write needs a SECOND pooled
 *  connection, which exhausts PG_POOL_MAX under concurrency and deadlocks payment
 *  creation. jsonb_set touches only this key in a single pooled statement, so it can
 *  neither clobber a concurrent state/event write nor hold a transaction open.
 *  updated_at is deliberately NOT bumped — the reconcile backstops key off it. */
export async function setSenderLocation(paymentId: string, loc: unknown): Promise<void> {
  await q(`UPDATE payments SET body = jsonb_set(body, '{senderLocation}', $2::jsonb, true) WHERE id=$1`,
    [paymentId, JSON.stringify(loc)]);
}
export async function getPayment(id: string): Promise<Payment | undefined> {
  const rows = await q<{ body: Payment }>(`SELECT body FROM payments WHERE id=$1`, [id]);
  return rows[0]?.body;
}
export async function findPaymentByRef(ref: string): Promise<Payment | undefined> {
  const rows = await q<{ body: Payment }>(`SELECT body FROM payments WHERE ref=$1`, [ref]);
  return rows[0]?.body;
}
export async function linkProviderRef(ref: string, paymentId: string, method: string): Promise<void> {
  // ON CONFLICT DO NOTHING: re-linking the same ref is a no-op, and the PRIMARY KEY still
  // stops a DIFFERENT payment from ever claiming a ref that is already spoken for.
  await q(`INSERT INTO payment_refs(ref, payment_id, method) VALUES($1,$2,$3) ON CONFLICT (ref) DO NOTHING`, [ref, paymentId, method]);
}

export async function findByProviderRef(providerRef: string): Promise<Payment | undefined> {
  const rows = await q<{ body: Payment }>(
    `SELECT p.body FROM payments p WHERE p.provider_ref=$1
     UNION ALL
     SELECT p.body FROM payment_refs r JOIN payments p ON p.id = r.payment_id WHERE r.ref=$1
     LIMIT 1`, [providerRef]);
  return rows[0]?.body;
}
/** Newest-first payments, BOUNDED. This is called by roughly ten admin views and by both
 *  reconcile ticks, and it used to select the entire table and deserialize every row on each
 *  one — fine at hundreds of payments, fatal at a hundred thousand. The cap keeps the newest
 *  rows, which is what every caller actually wants (recent activity, reconcile windows).
 *  It LOGS when the cap is reached, because a silently truncated total would read as a real
 *  figure on a dashboard — the same class of lie the fabricated ops numbers were. */
const PAYMENTS_SCAN_MAX = Number(process.env.PAYMENTS_SCAN_MAX || "10000");
export async function listPayments(): Promise<Payment[]> {
  const rows = await q<{ body: Payment }>(`SELECT body FROM payments ORDER BY created_at DESC LIMIT $1`, [PAYMENTS_SCAN_MAX]);
  if (rows.length === PAYMENTS_SCAN_MAX) {
    console.warn(`[store] listPayments hit the ${PAYMENTS_SCAN_MAX}-row cap — totals derived from it are UNDERSTATED. Move aggregates to SQL or raise PAYMENTS_SCAN_MAX.`);
  }
  return rows.map((r) => r.body);
}
/** Point a providerRef at a payment (when the instruction is minted after the row).
 *  The provider_ref UNIQUE index makes a second payment claiming the same ref throw —
 *  the same "no webhook fan-out" guarantee putPayment gives. */
export async function indexProviderRef(providerRef: string, paymentId: string): Promise<void> {
  await q(`UPDATE payments SET provider_ref=$1, updated_at=now() WHERE id=$2`, [providerRef, paymentId]);
}

/** Next payment reference number, from a Postgres SEQUENCE — the only counter genuinely
 *  shared across serverless instances. nextval() is atomic and never blocks, so concurrent
 *  payment creations cannot collide the way the per-instance in-memory counter did. */
export async function nextRefNumber(): Promise<number> {
  const rows = await q<{ n: string }>(`SELECT nextval('payment_ref_seq')::text AS n`);
  return Number(rows[0]?.n ?? 0);
}

/* ---------------- ledger (append-only, double-entry) ---------------- */
export interface Leg { account: LedgerAccount; direction: "debit" | "credit"; amount: number; currency: LedgerEntry["currency"] }
const signed = (l: Leg) => (l.direction === "debit" ? l.amount : -l.amount);

/** Append a BALANCED journal transaction (debits == credits per currency) in one txn.
 *  Amount stored SIGNED (debit +, credit −) so a balance is a trivial SUM. */
/** A journal transaction id must be UNIQUE per posting: it is how the ledger view groups
 *  legs into the transaction they belong to. The old default, `txn_<paymentId>_<legCount>`,
 *  collided by construction — a payment's inbound booking, its FX conversion and its
 *  delivery leg are all 2-leg postings, so three distinct transactions shared one id and the
 *  audit trail merged them. (The in-memory ledger always used a unique id; only Postgres
 *  had this.) */
export async function recordTxn(paymentId: string, legs: Leg[], at = new Date().toISOString(), txnId = `txn_${randomUUID()}`): Promise<void> {
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
interface LedgerRow { seq: number; at: Date | string; payment_id: string; body: { txnId: string; account: LedgerAccount; direction: "debit" | "credit"; amount: number; currency: LedgerEntry["currency"] } }
const toEntry = (r: LedgerRow): LedgerEntry => ({
  id: `le_${r.seq}`, txnId: r.body.txnId, paymentId: r.payment_id, account: r.body.account,
  direction: r.body.direction, amount: r.body.amount, currency: r.body.currency, at: new Date(r.at).toISOString(),
});
/** Full journal entries for a payment (the /ledger view) — reconstructed from the JSONB body. */
export async function entriesFor(paymentId: string): Promise<LedgerEntry[]> {
  const rows = await q<LedgerRow>(`SELECT seq, at, payment_id, body FROM ledger WHERE payment_id=$1 ORDER BY seq`, [paymentId]);
  return rows.map(toEntry);
}
export async function allEntries(): Promise<LedgerEntry[]> {
  const rows = await q<LedgerRow>(`SELECT seq, at, payment_id, body FROM ledger ORDER BY seq`);
  return rows.map(toEntry);
}

/** Has this payment's payout hit the recipient (a delivery leg to external_recipient)? */
export async function hasDelivered(paymentId: string): Promise<boolean> {
  const rows = await q(`SELECT 1 FROM ledger WHERE payment_id=$1 AND account='external_recipient' LIMIT 1`, [paymentId]);
  return rows.length > 0;
}

/** Post the inverse of every entry for a payment — nets its ledger contribution to zero
 *  (refund unwind). Inverting the SIGNED amount flips direction while keeping magnitude. */
export async function reversePayment(paymentId: string): Promise<void> {
  const rows = await q<{ account: string; currency: string; amount: string }>(
    `SELECT account, currency, amount FROM ledger WHERE payment_id=$1 ORDER BY seq`, [paymentId]);
  if (!rows.length) return;
  const inverse: Leg[] = rows.map((r) => { const a = Number(r.amount); return { account: r.account as LedgerAccount, currency: r.currency as LedgerEntry["currency"], direction: a >= 0 ? "credit" : "debit", amount: Math.abs(a) }; });
  await recordTxn(paymentId, inverse);
}

/* ---------------- snapshots (non-money collections: settings/routing/merchants/…) ----------------
   Coarse key→JSON blobs with optimistic version bump. Money data never lives here — it's
   in the quotes/payments/ledger tables. Last-writer-wins is acceptable for config-ish state. */
/** Write a snapshot. When `expected` is supplied the write is CONDITIONAL on the row still
 *  being at that version; the returned version is null if another instance had already moved
 *  it on. The caller decides what to do — see persist.touch(), which force-writes but LOGS.
 *
 *  This matters because the snapshot is a whole-collection blob written from per-instance
 *  memory. Two serverless instances that both hydrated at their own cold start will each
 *  write their entire view, so one silently erases the other's additions — the contact
 *  vault, device enrolments and admin users all live here. The schema claimed "reject on
 *  stale" but nothing ever compared the version, so the loss was invisible. */
export async function setSnapshot(key: string, json: string, expected?: number): Promise<number | null> {
  if (expected === undefined) {
    const rows = await q<{ version: string }>(
      `INSERT INTO snapshots(key, json, version, updated_at) VALUES($1, $2::jsonb, 1, now())
       ON CONFLICT(key) DO UPDATE SET json = excluded.json, version = snapshots.version + 1, updated_at = now()
       RETURNING version::text`,
      [key, json],
    );
    return Number(rows[0]?.version ?? 0);
  }
  const rows = await q<{ version: string }>(
    `UPDATE snapshots SET json = $2::jsonb, version = version + 1, updated_at = now()
     WHERE key = $1 AND version = $3 RETURNING version::text`,
    [key, json, expected],
  );
  return rows.length ? Number(rows[0].version) : null; // null = someone else wrote first
}
export async function allSnapshots(): Promise<Array<{ key: string; json: unknown; version: number }>> {
  const rows = await q<{ key: string; json: unknown; version: string }>(`SELECT key, json, version::text FROM snapshots`);
  return rows.map((r) => ({ key: r.key, json: r.json, version: Number(r.version) }));
}

/* ---------------- compliance chain (append-only, tamper-evident legal log) ----------------
   Each event is its OWN row (unlike the coarse snapshot, which is last-writer-wins and can
   drop a concurrently-appended STR/CTR event across serverless instances). Keyed by the
   event hash so a re-delivered append is idempotent (ON CONFLICT DO NOTHING). Append-only:
   no UPDATE/DELETE — the retained legal record is exported/verified from here. */
export async function appendComplianceEvent(ev: { id: string; kind: string; prevHash: string; hash: string; body: unknown }): Promise<void> {
  await q(
    `INSERT INTO compliance_chain(id, kind, prev_hash, hash, body) VALUES($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT(id) DO NOTHING`,
    [ev.id, ev.kind, ev.prevHash, ev.hash, JSON.stringify(ev.body)],
  );
}
export async function allComplianceEvents(): Promise<unknown[]> {
  const rows = await q<{ body: unknown }>(`SELECT body FROM compliance_chain ORDER BY seq ASC`);
  return rows.map((r) => r.body);
}

/** Read ONE snapshot key (for cross-instance freshness re-reads — e.g. the settings
 *  kill-switch a warm serverless instance would otherwise serve stale). undefined if absent. */
export async function getSnapshot(key: string): Promise<{ json: unknown; version: number } | undefined> {
  const rows = await q<{ json: unknown; version: string }>(`SELECT json, version::text FROM snapshots WHERE key = $1`, [key]);
  return rows.length ? { json: rows[0].json, version: Number(rows[0].version) } : undefined;
}

/* ---------------- momo_ops (admin Mobile-Money ops — real money, one row per op) ----------------
   Per-row upsert (keyed by op id) so a concurrent op's audit record is never clobbered by the
   coarse snapshot, and reconcile/AML-screen can read the COMPLETE cross-instance set. */
export async function upsertMomoOp(op: { id: string; kind: string; status: string; transferId?: string; at: string }): Promise<void> {
  await q(
    `INSERT INTO momo_ops(id, kind, status, transfer_id, at, body, updated_at)
     VALUES($1, $2, $3, $4, $5, $6::jsonb, now())
     ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, status = excluded.status,
       transfer_id = excluded.transfer_id, body = excluded.body, updated_at = now()`,
    [op.id, op.kind, op.status, op.transferId ?? null, op.at, JSON.stringify(op)],
  );
}
/** Most-recent momo_ops, newest first. Bounded to mirror the in-memory OP_CAP (5000) so
 *  dedup checks / reconcile / AML scans don't load and deserialize the entire table as
 *  money-op history accumulates over months. Recency covers every caller: recent-duplicate
 *  detection, pending-cashin reconcile, and the compliance window all look back, not forward. */
export async function allMomoOps(limit = 5000): Promise<unknown[]> {
  const rows = await q<{ body: unknown }>(`SELECT body FROM momo_ops ORDER BY at DESC LIMIT $1`, [limit]);
  return rows.map((r) => r.body);
}

/* ---------------- rate limits (durable fixed-window counters, shared across instances) ----------------
   Atomic bump in a single statement so concurrent serverless instances share one counter —
   the in-memory limiter is per-instance and lets an attacker spread brute-force across them. */
export async function bumpRateLimit(key: string, windowMs: number): Promise<{ count: number; resetInMs: number }> {
  const secs = windowMs / 1000;
  const rows = await q<{ count: number; reset_in_ms: number }>(
    `INSERT INTO rate_limits(key, count, expires_at)
       VALUES($1, 1, now() + make_interval(secs => $2))
     ON CONFLICT(key) DO UPDATE SET
       count = CASE WHEN rate_limits.expires_at <= now() THEN 1 ELSE rate_limits.count + 1 END,
       expires_at = CASE WHEN rate_limits.expires_at <= now() THEN now() + make_interval(secs => $2) ELSE rate_limits.expires_at END
     RETURNING count, GREATEST(0, EXTRACT(EPOCH FROM (expires_at - now())) * 1000)::bigint AS reset_in_ms`,
    [key, secs],
  );
  const r = rows[0];
  return { count: Number(r?.count ?? 1), resetInMs: Number(r?.reset_in_ms ?? windowMs) };
}
export async function resetRateLimit(key: string): Promise<void> {
  await q(`DELETE FROM rate_limits WHERE key = $1`, [key]);
}
export async function pruneRateLimits(): Promise<void> {
  await q(`DELETE FROM rate_limits WHERE expires_at < now()`);
}
