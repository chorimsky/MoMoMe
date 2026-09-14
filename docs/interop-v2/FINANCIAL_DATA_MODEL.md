# Financial data model

## v1 (untouched)
`Payment` (xaf delivered, feeXaf, totalXaf, feeBy, spreadBps, payInstruction, aggregator,
events[]), `Quote`, `LedgerEntry` (currency ∈ XAF/BTC/USDT/USDC), `TreasuryWithdrawal`,
`MomoTransfer`, `ComplianceCase`/`STR`/chain events, `RegulatoryFiling`.

## v2 network (`shared/network.ts`, persisted under `network_*` keys)
- `NetworkIntent` — what the user wants; never executes.
- `NetworkQuote` — FX (`FxQuote`: mid, spread, source, expiry), `FeeBreakdown` (provider
  collect, provider payout, FX spread, Lightning, liquidity, MoMo›Me; all inside the source
  amount), destination amount, settlement sats, expiry. Expired quotes are never executed.
- `NetworkRoute` — steps as data, actors (adapter / source ids), score components, reasons.
- `LiquiditySource` / `LiquidityPosition` (balance, reserved, committed, available, state) /
  `LiquidityReservation` (RESERVED → COMMITTED → RELEASED).
- `NetworkTransaction` — the saga: state, refs per leg (reservation, collection, provider
  refs, Lightning payment id, payout id, settlement id, refund ref), appliedEvents (webhook
  dedup), recovery, events[] with timestamps.
- Network ledger — multi-currency, balanced per currency per booking: accounts
  `src_collection_clearing`, `src_pool`, `lightning_position`, `dst_pool`, `dst_recipient`,
  `fee_revenue`, `fx_pnl`, `partner_settlement`, `refund_payable`. SEPARATE from the v1 XAF
  ledger by design: v2 never writes to the live books.
- `ShadowComparison` — production (rail, fee, delivered, seconds) vs v2 (route type, adapter,
  fees, destination amount, availability, reasons), `agrees`.
- `NetworkReconciliation` — per transaction: source/Lightning/payout confirmed, ledger
  balanced, liquidity released → settled / in_flight / stuck / unmatched / manual.
