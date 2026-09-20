# Stablecoin settlement — funding rails, pass-through

Model (decided): stablecoins **fund** payments; they are never held and never sent. See STABLECOIN_CUSTODY_MODEL.md.

- Asset model (`core/upi/assets.ts`): `USDT/ETHEREUM`, `USDC/ETHEREUM` = RECEIVE_ONLY (the model); `USDT/TRON`, `USDC/BASE` = PLANNED with no deposit rail. `validateAssetNetwork` refuses `USDT` without a network and any PLANNED pair.
- Adapter (`core/upi/rails.ts stablecoinRail`): quote/health real; `initiate` mints the V1 deposit address; no send.
- Lifecycle (`core/upi/chain.ts`): the inbound deposit's own states CREATED → BROADCAST → CONFIRMING → CONFIRMED → FINALIZED (Ethereum 12 / 32 / 120 min); FAILED / EXPIRED / REORGED; a deposit that stops advancing is `reconciliation: REQUIRED`. Conversion and payout happen in V1 at confirmation (`stateMachine.ts` INBOUND_CONFIRMED → FX_LOCKED → payout).
- Monitor abstraction: `BlockchainMonitor` (Ethereum via the receipt reader); other networks → RECONCILIATION_REQUIRED until a deposit rail exists.
- Fee lines apart: network, provider, momome, fxSpread, liquidity.
- Flags `STABLECOIN_SETTLEMENT_ENABLED` + `STABLECOIN_USDT_ENABLED` / `STABLECOIN_USDC_ENABLED` gate stablecoin **funding through intents**; V1 accepts the same deposits directly today.

## When the payout fails after a stablecoin deposit
The value must still leave: the sender is refunded **over Lightning** through the same claim flow as a Lightning payment — `refundableMsat()` converts the booked dollars at the current BTC price (never more than was booked; refused while the rate feed is not fresh), the payment shows `refundSats` so the sender knows what invoice to make, `completeRefund` pays the amount-less invoice for exactly that value and reverses the ledger. The stablecoin itself stays at the rail and is swept as treasury (it was never the sender's claim on us once refunded). Only when no outbound Lightning rail exists at all is the payment held for an operator (`MANUAL_REVIEW`, out-of-band return).
