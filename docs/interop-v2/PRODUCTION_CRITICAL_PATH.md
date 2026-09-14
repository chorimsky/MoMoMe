# Production critical path — do not rewrite

Anything on this list moves real customer money today. Rule: wrap, test, observe, abstract,
then extend; never rewrite in place.

1. `POST /api/quotes` → `buildQuote()` (routes/api.ts) — rates freshness, fee floor, spread,
   merchant fee mode, quote TTL.
2. `POST /api/payments` → `createPaymentCore()` — name checks, compliance screen, quote claim
   (single use), payout pre-flight gate (kill-switch, corridor cap, float, rail readiness),
   instruction mint on the crypto rail.
3. Inbound webhooks (`routes/webhooks.ts`) → `confirmInbound()` → ledger booking → `settle()`
   → `selectFundedAggregator()` → `PayoutAdapter.disburse()` (Peexit / PawaPay) → payout
   callback / `queryStatus` re-query → DELIVERED / FAILED → refund path (`adminRefund`, IBEX
   `payInvoice`).
4. `core/ledger.ts` invariants and the accounts `inbound_clearing`, `customer_wallet`,
   `fx_position`, `payout_float_XAF`, `fee_revenue`, `external_recipient`, `refund_payable`,
   `rail_fees`, `momo_collect_clearing`, `fx_pnl`.
5. `core/treasury.ts` withdrawals (real crypto out) and `markSold`.
6. `core/momoTransfer.ts` (behind `features.momoTransfer`, off in production).
7. Reconcile tick in `jobs.ts` — every function there has a durable idempotent effect.
8. Persist layer (`core/persist.ts`, `db/store.ts`) — snapshot keys; the compliance chain
   append-only table on Postgres.

The network layer touches none of these. It reads: `store().listPayments()` (shadow), rail
balances via the same adapters, `treasuryPools()` for the BTC position, `rates.ts` for USD/XAF
and BTC/USD, `platformFee()` for the platform fee. It writes only its own persist keys
(`network_*`).
