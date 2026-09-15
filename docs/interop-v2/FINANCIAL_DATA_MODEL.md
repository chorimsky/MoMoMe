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

## Network ledger — the money model (reviewed 2026-09-15)

Per cross-border transaction, in order (A = source amount, F = fee breakdown, D = recipient
amount, V = settlement value):

| Step | Legs | Note |
|---|---|---|
| Collection confirmed | `src_collection_clearing` Dr A · `src_pool` Cr A | local money is in |
| Lightning confirmed | `src_pool` Dr V · `fx_pnl` Cr V (source ccy) · `fx_pnl` Dr sats · `lightning_position` Cr sats · `src_pool` Dr R · `fee_revenue` Cr R · `lightning_fees` Dr fee · `lightning_position` Cr fee (sats) | V = A − F.total + F.providerPayout (what the destination needs); R = F.total − F.providerPayout (retained at source) |
| Payout confirmed | `lightning_position` Dr sats · `dst_pool` Cr sats · `dst_pool` Dr D + fee · `dst_recipient` Cr D · `provider_fees` Cr fee | fee = the payout aggregator's, in destination currency |
| Refund (after settlement) | `lightning_position` Dr sats · `dst_pool` Cr sats · `src_pool` Dr A · `refund_payable` Cr A → on confirmation `refund_payable` Dr A · `src_collection_clearing` Cr A | the value sits in the destination pool until rebalanced |

Conversion is at **mid**; the spread is one of the itemised fees (never in the rate as well).
The source pool nets to zero per transaction; every currency balances per transaction.
