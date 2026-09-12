# Payment intents

A `PaymentIntent` (`shared/interop.ts`) is what the user wants, independent of any rail:
destination address, amount in the destination currency, purpose, optional preferred
method. It is owner-scoped (device or partner API key) and idempotent
(`Idempotency-Key` header, 24 h).

Status is **derived** from the executing engine payment on every read, through
`toCanonicalStatus`:

| Canonical | Engine states |
|---|---|
| CREATED / VALIDATING | intent created, destination checked |
| ROUTING / QUOTED | routes discovered; viable route(s) exist |
| AUTHORIZED | route locked, payment created, awaiting the pay-in |
| PROCESSING | pay-in detected |
| PENDING_SETTLEMENT | inbound confirmed, FX locked, payout requested |
| COMPLETED | payout confirmed / delivered |
| COMPLIANCE_REVIEW | manual review |
| FAILED | payout failed / refund pending |
| REFUNDED | refunded |
| EXPIRED | pay-in window passed unpaid |
| CANCELLED | (reserved) |

Every transition of the engine payment is an `events[]` entry with a timestamp and note;
`GET /api/v1/payments/:id/status` exposes them as a timeline with the canonical status per step.
