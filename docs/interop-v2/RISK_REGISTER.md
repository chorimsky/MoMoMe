# Risk register

| # | Risk | Mitigation in place | Open |
|---|---|---|---|
| 1 | v2 code path reaches live money by accident | All flags off; `/api/network` 404s in production unless INTEROPERABILITY_V2; saga `executionGate`; separate ledger and persist keys; `network.test.ts` asserts v1 quotes unchanged with the network on | keep the test in the pre-deploy chain |
| 2 | Accepting a payment the destination cannot fund | Destination liquidity reserved before collection; router rejects when `available < amount` | live balances for non-CM markets need real rails |
| 3 | Money lost after a mid-saga failure | Named failure states; ledger keeps the source funds; recovery retry/alternate/manual/refund; reconciliation marks `manual` | operator runbook |
| 4 | Duplicate execution | Intent → single transaction; per-leg idempotency keys; retry uses a NEW key; webhook event ids deduplicated | provider-side idempotency for new rails |
| 5 | Pricing real money on a configured FX rate | `fxLive()` refuses configured/stale/fallback rates when `liveMoney()`; `refreshPublicFx()` (Coinbase USD table, open.er-api fallback, 6 h max age, persisted) prices KES/GHS/NGN/UGX/TZS/RWF from a feed; the checklist shows the source per currency | a second independent venue for the fiat table (as BTC/USD has) |
| 6 | Lightning leg fails after collection | LIGHTNING_FAILED → REFUND_PENDING with the reservation released and `refund_payable` booked; `autoRefund` pays the payer back on the source rail, idempotent per transaction, confirmed by poll; a failed refund goes to the operator | keep `autoRefund` off until the source rail's payout has been rehearsed on the sandbox key |
| 13 | Payer approves after the collection expired | expiry releases the reservation; a late COMPLETED books the collection and moves to REFUND_PENDING (never unaccounted) | — |
| 7 | Regulatory: cross-border remittance licensing per market (CBK, BoG, CBN, BCEAO) and BEAC Instruction 002/2026 on the Cameroon side | market `compliance[]` names the rules; regulatory reporting exists for CM | legal review per corridor before PHASE 6 |
| 8 | Partner liquidity risk (Model B) | partners declared with limits/fees; `partner_settlement` account; `disabled.partners` | partner agreements, settlement reconciliation |
| 9 | Device auth on `/api/network` | CLOSED — `routes/api.ts` injects `ownerOf()` (`setOwnerResolver`); unsigned/un-enrolled ids get 401; another device cannot read a transaction (`network.test.ts`) | — |
| 11 | A corridor activated because the API exists | activation checklist with must/warn items (markets, providers, real rails, PawaPay active-conf agreement, FX feed, Lightning position, liquidity, flags, canary caps, shadow evidence, reconciliation, recent failures); canary admission is 0 % with an empty allowlist by default | operator runbook: walk the list, widen the rollout share in steps |
| 12 | Wrong PawaPay provider code for a new market | `PROVIDER_CODES` table checked against `GET /v2/active-conf` in the checklist; a wrong code is a REJECTED payout (funds stay) | confirm codes when the contract for a market is signed |
| 10 | Persist growth (`network_*` snapshots) | bounded slices | move the network ledger to an append-only table on Postgres (as the compliance chain) |
