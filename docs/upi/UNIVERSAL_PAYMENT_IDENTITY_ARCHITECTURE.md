# Universal Payment Identity — architecture

**One identity. Any payer. Any supported rail. Local money out.** Built 2026-09-20 as an additive, flagged layer over the V1 engine (untouched), the identity module and the network layer. Code: `shared/upi.ts`, `server/src/core/upi/*`, `server/src/routes/upi.ts`.

## The four things kept apart
| concept | object | example |
|---|---|---|
| identity | `PaymentIdentity` | `+237674123456` (MSISDN), `237674123456@momome.xyz` (MOMOME_ADDRESS), `alice@wos.com` (LIGHTNING_ADDRESS, foreign), `$a@vasp` (UMA) |
| intent | `PaymentIntentV2` | 10 000 XAF to that identity |
| payment rail | `QuoteOption.sourceRail/sourceAsset/sourceNetwork` | BTC/LIGHTNING, USDT/ETHEREUM, XAF Mobile Money |
| settlement rail | `RouteV2.settlementRail` + `PaymentDestination` | MTN Mobile Money XAF |

```
identity → PaymentIdentityResolver → PaymentIdentity + PaymentDestination[]
        → PaymentIntent (CREATED → IDENTITY_RESOLVED)
        → QuoteEngine (QUOTED: one QuoteOption per funding rail, fee lines apart)
        → RoutingEngine (ROUTE_SELECTED: deterministic rule; SHADOW records beside V1)
        → LiquidityEngine (capacity / reservation)
        → PaymentRequest (the V1 pay instruction or a network transaction)
        → V1 state machine / network saga (money) → mirrored back → COMPLETED
        → reconciliation (expected vs actual → RECONCILIATION_REQUIRED, never silence)
```

## Resolver (`core/upi/identity.ts`)
`resolve()` classifies then dispatches to `resolvePhone` (libphonenumber via `identityResolution/msisdn`; holder from the identity chain — Peexit today), `resolveMomoMeAddress` (`<digits>@momome.xyz` / `momome:+…` → the same MSISDN), `resolveLightningAddress` (ours → MSISDN; foreign → a non-native identity that can only be paid as given), `resolveUMA` (refused unless `UMA_COMPATIBILITY_ENABLED`; never faked). `getDestinations()` lists Mobile Money (only when a configured rail — or the sandbox's simulated rail, V1's own rule — can pay it) and the LUD-16 address; `getCapabilities()` the funding and settlement rails.

## Settlement model
**No custody; every payment settles; the system holds nothing** (STABLECOIN_CUSTODY_MODEL.md). Lightning and stablecoins are funding rails converted at confirmation; destinations are Mobile Money (and the LUD-16 representation of the same number); never a stablecoin or bank balance.

## Data model
`phone → payment_identity → payment_destinations[]` — no `phone → lightning_wallet` relation anywhere. Destinations are computed from capability, not stored as the only truth; a stablecoin destination would be a further row when a custody model exists.

## Where it plugs into money
Nowhere new. Execution hands a domestic leg to `buildQuote` + `createPaymentCore` (the V1 path, with its idempotency, webhooks, polling, ledger, refund and review) and a cross-border leg to the network saga. `syncIntent()` mirrors their states into the intent's on every read. Every V1 test and every network test passes with the UPI flags on and off.

## Flags
`UNIVERSAL_PAYMENT_IDENTITY_ENABLED` (the surface; sandbox always reachable), `PHONE_PAYMENT_RESOLUTION_ENABLED`, `WALLET_RESOLUTION_API_ENABLED`, `PAYMENT_INTENT_V2_ENABLED`, `MULTI_RAIL_ROUTING_ENABLED` + `ROUTING_ENGINE_MODE=SHADOW|EXECUTE`, `STABLECOIN_SETTLEMENT_ENABLED` + `STABLECOIN_USDT_ENABLED` / `STABLECOIN_USDC_ENABLED`, `CROSS_BORDER_ROUTING_ENABLED` + `CORRIDOR_<SRC>_<DST>_ENABLED`, `UMA_COMPATIBILITY_ENABLED`. All default false. See ROLLBACK_PLAN.md.
