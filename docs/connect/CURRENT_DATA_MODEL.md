# Current data model (persisted through register()/touch snapshots; Postgres repos for payments/quotes/ledger)

- `Quote`, `Payment` (+events, payInstruction, recipient snapshot, payout attempt keys), `LedgerEntry`
  (accounts: inbound_clearing, customer_wallet, fx_position, payout_float_XAF, fee_revenue,
  external_recipient, refund_payable, rail_fees, momo_collect_clearing, fx_pnl, org_balance:<id>,
  settlement_payable).
- Identity families: `Identity` (recipient, phone-keyed, claimable), `MerchantAccount` (+`MerchantLink`),
  `Organization`/`User`/`Application`/`Credential` (API v1), device accounts, `Merchant` graph (codes).
- Intents: interop `PaymentIntent`, UPI `PaymentIntentV2` (+quote options, route), API v1 `PaymentMeta`.
- Platform: idempotency records, usage days, plans, invoices (billing), limit rules, reservations,
  settlements (org), requests (KYB/plan/live), audit, email outbox.
- Network: markets, corridors, liquidity sources/reservations, network transactions.
