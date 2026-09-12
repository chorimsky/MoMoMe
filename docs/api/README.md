# API

Two surfaces, one implementation of the money rules.

## `/api/*` — product API (unchanged, supported)

Quotes, payments, merchants, identities, vault, admin. Now also honours
`Idempotency-Key` on `POST /api/payments`, and offers `POST /api/payments/:id/cancel`
(un-paid payments only).

## `/api/v1/*` — interoperability API

| Method | Path | Purpose |
|---|---|---|
| GET | `/rails` | rail classes, capabilities, providers, limits, fees, regulated party |
| GET | `/providers` | provider health, success rate, latency, liquidity |
| POST | `/payment-addresses/resolve` | `{ address, country? }` → PaymentAddress |
| POST | `/payment-intents` | `{ destination, amount, currency?, purpose?, preferredMethod? }` + `Idempotency-Key` → 201 intent |
| GET | `/payment-intents` | the caller's intents with live status |
| GET | `/payment-intents/:id` | one intent + its routes |
| POST | `/payment-intents/:id/routes` | discover and rank routes → `{ intent, routes, recommended }` |
| POST | `/payment-intents/:id/cancel` | before the pay-in only: closes the intent and its payment (CANCELLED); 409 once anything has arrived |
| POST | `/payment-intents/:id/execute` | `{ routeId?, riskToken?, recipientName? }` + `Idempotency-Key` → 201 `{ intent, route, payment }` |
| GET | `/payments/:id/status` | canonical status, trace chain, timeline (id or MMM-ref) |
| GET | `/webhooks/events` | admin: normalised provider events |
| GET | `/reconciliation` | admin: our records vs the provider's |
| GET | `/observability?hours=24` | admin: API latency per route class, payment funnel timings and rates per rail, provider health, webhook stats |

Authentication is the same as `/api`: signed device headers or a partner API key.
Errors are `{ error, message }` with conventional status codes (400 bad input, 401 no
identity, 404 not found / unresolvable, 409 conflict, 422 destination unavailable, 429
rate limited, 503 paused / rates unavailable).
