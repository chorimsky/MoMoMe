# Lightning map

Today (v1): IBEX Hub is the inbound rail (BOLT11 invoices, on-chain, USDT/USDC) and the
outbound rail for refunds (`payInvoice`) and MoMo↔MoMo Lightning-address payouts
(`payLightningAddress`, LNURL-pay resolve with SSRF guard); phoenixd is an optional second
inbound node (LUD-06 description_hash). Every recipient number is a Lightning Address
(`<digits>@momome.xyz`, `routes/lnurl.ts`).

v2 settlement abstraction (`core/network/settlement.ts`):
- `partner_address` — DIRECT_PARTNER_SETTLEMENT: pay the partner's Lightning Address through
  the production IBEX adapter (real only when `LIGHTNING_SETTLEMENT_V2` and IBEX are on).
- `pool_internal` — MOMOME_LIQUIDITY_SETTLEMENT: the network's own position; a ledger move
  between the source and destination pools; a node-to-node hop is added here when each pool
  runs a node.
- `simulated` — sandbox rehearsal.
The Lightning position's liquidity = IBEX BTC withdrawable (balance − crypto owed to senders),
read through `treasuryPools()`. Standards: Lightning Address / LNURL-pay, BOLT11; BOLT12 when
the rails expose it. No proprietary protocol.
