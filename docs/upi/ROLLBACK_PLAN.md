# Rollback plan (UPI)

| switch | effect when false / unset |
|---|---|
| `UNIVERSAL_PAYMENT_IDENTITY_ENABLED` | `/api/v2/*` (except `/v2/identity`) is 404 in production and V1 payments stop spawning shadow intents; nothing else changes |
| `PHONE_PAYMENT_RESOLUTION_ENABLED` | `/payment-resolution` closed; Lightning Address, V1 payments, accounts unaffected |
| `WALLET_RESOLUTION_API_ENABLED` | `/wallet/resolve` closed |
| `PAYMENT_INTENT_V2_ENABLED` | intents can be quoted/routed (shadow) but never executed |
| `MULTI_RAIL_ROUTING_ENABLED` / `ROUTING_ENGINE_MODE` | execution refused; traffic is V1's |
| `STABLECOIN_SETTLEMENT_ENABLED` (+ `_USDT_` / `_USDC_`) | stablecoin funding through intents refused; Lightning and Mobile Money unaffected; V1's direct USDT/USDC receive unaffected |
| `CROSS_BORDER_ROUTING_ENABLED`, `CORRIDOR_*_ENABLED` | cross-border options unavailable with the reason |
| `UMA_COMPATIBILITY_ENABLED` | UMA identities refused |

All read at call time; no deploy. Persisted collections (`upi_intents`, `upi_shadow`, `upi_chain_txs`) are read by nothing in V1. Code rollback: `scripts/railway-rollback.sh <deployment>`.
