# Risk register

| # | Risk | Mitigation in place | Open |
|---|---|---|---|
| 1 | v2 code path reaches live money by accident | All flags off; `/api/network` 404s in production unless INTEROPERABILITY_V2; saga `executionGate`; separate ledger and persist keys; `network.test.ts` asserts v1 quotes unchanged with the network on | keep the test in the pre-deploy chain |
| 2 | Accepting a payment the destination cannot fund | Destination liquidity reserved before collection; router rejects when `available < amount` | live balances for non-CM markets need real rails |
| 3 | Money lost after a mid-saga failure | Named failure states; ledger keeps the source funds; recovery retry/alternate/manual/refund; reconciliation marks `manual` | operator runbook |
| 4 | Duplicate execution | Intent → single transaction; per-leg idempotency keys; retry uses a NEW key; webhook event ids deduplicated | provider-side idempotency for new rails |
| 5 | Pricing real money on a configured FX rate | `fxLive()` refuses non-feed rates when `liveMoney()`; sandbox only rehearses | wire KES/GHS/NGN feeds before any corridor goes live |
| 6 | Lightning leg fails after collection | LIGHTNING_FAILED → REFUND_PENDING with the reservation released | automate the refund through the collection rail |
| 7 | Regulatory: cross-border remittance licensing per market (CBK, BoG, CBN, BCEAO) and BEAC Instruction 002/2026 on the Cameroon side | market `compliance[]` names the rules; regulatory reporting exists for CM | legal review per corridor before PHASE 6 |
| 8 | Partner liquidity risk (Model B) | partners declared with limits/fees; `partner_settlement` account; `disabled.partners` | partner agreements, settlement reconciliation |
| 9 | Device auth on `/api/network` uses the sender header, not the signed-device gate of `/api` | surface is off in production | wire `ownerOf()` before canary |
| 10 | Persist growth (`network_*` snapshots) | bounded slices | move the network ledger to an append-only table on Postgres (as the compliance chain) |
