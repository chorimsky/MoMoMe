# Payment flows

## v1 (live) — crypto in → Mobile Money out (Cameroon)
Quote (XAF + fee → sats/USDT) → payment (instruction: BOLT11 / BTC address / ERC-20) →
customer pays from a wallet → rail webhook → `confirmInbound` (ledger: inbound_clearing →
customer_wallet; fee_revenue) → `settle` → payout rail → DELIVERED (external_recipient) or
FAILED → refund (refund_payable → IBEX pay).

## v1 MoMo↔MoMo (`momoTransfer`, off) — Mobile Money in → Mobile Money out
Peexit collect (payer approves on phone) → COLLECTED → payout on the other network, or a
Lightning Address abroad via IBEX → DELIVERED / REFUND.

## v2 network — local money in → Lightning → local money out
```
intent ─► router (routes as data, scored) ─► quote (FX, fee breakdown, sats)
   confirm ─► reserve destination liquidity ─► collection request (adapter)
   COLLECTION_CONFIRMED (provider event) ─► ledger: src_collection_clearing → src_pool
   LIGHTNING_SENT ─► settlement.settle() ─► LIGHTNING_CONFIRMED
        ledger: src_pool → fx_pnl (fiat leg) · fee_revenue · fx_pnl → lightning_position (BTC)
   PAYOUT_INITIATED (reservation committed) ─► adapter.createPayout ─► PAYOUT_CONFIRMED (event)
        ledger: lightning_position → dst_pool (BTC) · dst_pool → dst_recipient (local ccy)
   COMPLETED = source confirmed + Lightning confirmed + payout confirmed + ledger balanced
```
Failure states: COLLECTION_FAILED (nothing moved), LIGHTNING_FAILED → REFUND_PENDING,
DESTINATION_SETTLEMENT_FAILED → recovery {retry (new idempotency key), alternate_provider,
manual → MANUAL_REVIEW, refund → REFUND_PENDING → REFUNDED}.
Domestic (same market) routes are AGGREGATOR_SETTLEMENT: no Lightning leg — this is the
production flow expressed in the new vocabulary, which is what shadow mode compares.
