# API v1 — Liquidity, treasury and ledger

Treasury model (XAF payout float): AVAILABLE = total − RESERVED − SETTLEMENT_PENDING (`core/platform/liquidity.ts`).
`POST /v1/payments` reserves the destination XAF before the engine mints anything; the reservation is tagged
with the payment id, consumed at COMPLETED, released on any other end or after `RESERVATION_TTL_MIN` (30)
without an inbound (`expireReservations` in the job tick). Check-and-reserve runs with no await between the
balance read and the insert, so concurrent requests cannot both pass (test §45: 12 racers, 4 created).
The app's own flow is unchanged; `reservedXaf()` is available to the router for a shared AVAILABLE figure.

Ledger: `core/ledger.ts` stays the single journal. New accounts: `org_balance:<orgId>` (liability to the
organization) and `settlement_payable`. A settlement request moves the amount org_balance → settlement_payable;
completion clears the payable against `payout_float_XAF` (+ `fee_revenue`); cancel/fail is a compensating entry
back to the organization. History is never edited.
