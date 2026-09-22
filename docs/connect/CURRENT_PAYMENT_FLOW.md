# Current payment flow

1. Quote (`buildQuote`): xaf + method + country → rate/fee lock (Lightning 10 min; on-chain estimate).
2. Create (`createPaymentCore`): recipient checks (numbering plan, operator, registered name, near-miss
   guard), compliance screen, quote claim, mint pay instruction on the crypto rail (IBEX invoice/address,
   phoenixd for LUD-06), ledger `QUOTED→AWAITING_INBOUND`.
3. Inbound: rail webhook or reconcile → `INBOUND_DETECTED/CONFIRMED` (ledger inbound_clearing→fx_position),
   FX lock, payout via `selectFundedAggregator` (Peexit/PawaPay) → `PAYOUT_REQUESTED/CONFIRMED` →
   `DELIVERED` (ledger payout_float_XAF→external_recipient, fee_revenue). Failover to another rail, transient
   holds retried, refund over Lightning if nothing can deliver (`REFUND_PENDING/REFUNDED`).
4. Notifications: recipient SMS/WhatsApp, sender push; outbound partner webhooks; API v1 typed events.
5. Money model: pass-through, no custody (`SETTLEMENT_MODEL = NONE_PASS_THROUGH`).

Other flows: LNURL pay to `<number>@momome.xyz` (creates a Payment with source "lnurl"); merchant link /
QR / invoice pay page (creates a Payment with merchantLinkCode); MoMo→MoMo transfer (collection on
payer's network → payout on recipient's, or Lightning address beyond corridors); refunds over Lightning.
