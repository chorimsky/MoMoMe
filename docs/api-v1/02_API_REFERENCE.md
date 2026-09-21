# API v1 — Reference summary

The authoritative contract is the OpenAPI 3.1 document at `GET /v1/openapi.json` (rendered at
https://momome.xyz/developers#reference). This file is the human map.

| Method & path | Scope | Idempotent | Notes |
|---|---|---|---|
| `POST /v1/quotes` | quotes:write | ✓ | destination- or source-amount; 201 |
| `GET /v1/quotes/{id}` | quotes:write | | `status` active / expired / used |
| `POST /v1/payments` | payments:write | ✓ | payment endpoint limit; 201; `confirmation_token` after 409 recipient_unverified |
| `GET /v1/payments` | payments:read | | `limit status reference created_after starting_after` |
| `GET /v1/payments/{id}` | payments:read | | `?wait=25&status=…` long-poll |
| `POST /v1/payments/{id}/cancel` | payments:write | ✓ | only before funds arrive |
| `POST /v1/payments/{id}/refund` | refunds:write | ✓ | only REFUNDED awaiting a destination (Lightning invoice) |
| `POST /v1/payments/{id}/retry` | payments:write | ✓ | re-attempt the payout |
| `POST /v1/recipients/validate` | recipients:validate | | 300/h per org on top of the plan limit |
| `POST /v1/webhooks` · `GET` · `GET/PATCH/DELETE /{id}` · `POST /{id}/test` · `POST /{id}/replay` · `GET /{id}/deliveries` | webhooks:manage | create ✓ | ≤10 active endpoints per org |
| `POST /v1/settlements` · `GET` · `GET /{id}` · `POST /{id}/cancel` | settlements:* | ✓ | balance-backed |
| `GET /v1/account` · `GET /v1/account/balances` | account:read | | |
| `GET /v1/usage` | usage:read | | `from to` (YYYY-MM-DD) |
| `GET /v1/transactions` · `GET /v1/transactions/{id}` | payments:read | | unified timeline |
| `GET /v1/sandbox/scenarios` · `POST /v1/sandbox/payments/{id}/pay` | payments:* | | test environment only |
| `GET /v1/health` | — | | public |
| `GET /v1/openapi.json` | — | | public |

Headers: `Authorization: Bearer mm_…` · `Idempotency-Key` (writes) · `X-Request-Id` (optional, echoed) ·
responses carry `X-Request-Id`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After` (429),
`Idempotent-Replayed: true` on a replay.

## State mapping
See 01_ARCHITECTURE. Terminal: COMPLETED, EXPIRED, FAILED, CANCELLED, REFUNDED.

## Error codes
`publicApi/errors.ts` is the vocabulary; the portal's "Error reference" lists them by status.
