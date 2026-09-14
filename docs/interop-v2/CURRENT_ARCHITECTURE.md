# Current architecture (audit, 2026-09-15)

Monorepo: `app/` (React/Vite, Vercel, www.momome.xyz), `server/` (Express, Railway,
`momome-api-production.up.railway.app`, SQLite on a volume — Postgres repo exists), `mobile/`
(Expo SDK 54, OTA channel production), `shared/` (types + domain constants used by all three).

## Server modules that touch money
- `routes/api.ts` — `buildQuote()` (fee floor, spread, rates freshness gate) → `/quotes`;
  `createPaymentCore()` → `/payments` (recipient name rules, risk tokens, compliance screen,
  quote claim, payout pre-flight gate, instruction mint); admin routes behind a session +
  section guard (`sectionForPath`, `ELEVATED_ONLY` step-up).
- `core/stateMachine.ts` — `confirmInbound` (books the ledger, repricing for on-chain, other
  stablecoin auto-settle), `settle` (payout via routing), refunds, float (`availableFloatXaf`
  with live rail balances or a static exposure ceiling).
- `core/routing.ts` — `selectFundedAggregator` (balance-aware, cost-aware), rail health.
- `adapters/payouts.ts` — `PayoutAdapter` (Peexit primary, PawaPay) · `adapters/peexit.ts`
  also exposes `collect`/`collectStatus` (used by MoMo↔MoMo transfers) and the fee schedule.
- `adapters/ibex.ts` (+ `phoenixd.ts`, `sandbox.ts`) — inbound crypto rails; outbound
  `payLightningAddress`, `payInvoice`, `sendOnchain`; account balances.
- `core/ledger.ts` — double-entry XAF/BTC/USDT/USDC journal (`recordTxn` balanced per currency).
- `core/treasury.ts` — pools, sweeps (`withdraw`), realized FX (`markSold`).
- `core/momoTransfer.ts` — MTN↔Orange (collect → payout) and Lightning-address route; feature
  `features.momoTransfer` (off).
- `core/interop/*` — v1 interoperability API: intents/routes over the SAME `buildQuote` /
  `createPaymentCore`, rails registry, outbound partner webhooks, reconciliation.
- `routes/webhooks.ts` — provider callbacks; authoritative re-query before settlement.
- `jobs.ts` — 30 s reconcile tick (stuck payouts/inbounds/refunds, deposits, compliance scan,
  momo transfers, outbound webhooks, quote pruning) and the FX tick (IBEX → public median).
- `core/compliance.ts`, `core/regulatory.ts` — AML cases/STR, hash chain; per-body reports.

## New, additive (this upgrade)
`shared/network.ts`; `core/network/{markets,adapters,liquidity,fx,fees,router,settlement,
saga,shadow}.ts`; `routes/network.ts`; `settings.network`; Admin → Interoperability → Network panel.
None of these are imported by the money path above. `jobs.ts` calls `shadowTick()` which is a
no-op unless `SHADOW_ROUTING` is on and only READS production records.
