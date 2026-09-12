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
| GET | `/countries` | every configured country: currency, operators (with payout providers and reachability), `active`, and what activation still needs (`readiness.payoutRail`, `readiness.numberingPlanConfirmed`) |
| POST | `/payment-addresses/resolve` | `{ address, country? }` → PaymentAddress |
| POST | `/payment-intents` | `{ destination, amount, currency?, purpose?, preferredMethod? }` + `Idempotency-Key` → 201 intent |
| GET | `/payment-intents` | the caller's intents with live status |
| GET | `/payment-intents/:id` | one intent + its routes |
| POST | `/payment-intents/:id/routes` | discover and rank routes → `{ intent, routes, recommended }` |
| POST | `/payment-intents/:id/cancel` | before the pay-in only: closes the intent and its payment (CANCELLED); 409 once anything has arrived |
| POST | `/payment-intents/:id/execute` | `{ routeId?, riskToken?, recipientName? }` + `Idempotency-Key` → 201 `{ intent, route, payment }` |
| GET | `/payments/:id/status` | canonical status, trace chain, timeline (id or MMM-ref) |
| POST | `/webhooks/subscriptions` | partner: `{ url, events? }` → 201 `{ subscription, secret }` — the `whsec_…` secret is shown once; https and a public host only (max 5 active per key) |
| GET | `/webhooks/subscriptions` | partner: its subscriptions (no secrets) + `deliveries` stats (queued / delivered / dead / recent attempts) |
| DELETE | `/webhooks/subscriptions/:id` | partner: stop receiving events |
| GET | `/webhooks/events` | admin: normalised provider events |
| GET | `/reconciliation` | admin: our records vs the provider's |
| GET | `/observability?hours=24` | admin: API latency per route class, payment funnel timings and rates per rail, provider health, webhook stats |

Authentication is the same as `/api`: signed device headers or a partner API key.
Errors are `{ error, message }` with conventional status codes (400 bad input, 401 no
identity, 404 not found / unresolvable, 409 conflict, 422 destination unavailable, 429
rate limited, 503 paused / rates unavailable).

### Outbound webhooks (we call you)

Every canonical status change on a payment owned by a subscribed API key is POSTed to the
partner's URL, at least once, with backoff (1 s, 10 s, 1 min, 10 min, 1 h; then marked
dead and visible in the stats). An endpoint failing 50 deliveries in a row is disabled,
not hammered.

```
POST <url>
Content-Type: application/json
X-MoMoMe-Event-Id: evt_…                 idempotency key — ignore an id you already processed
X-MoMoMe-Signature: t=<unix-ms>,v1=<hex>  hex = HMAC-SHA256(secret, `${t}.${rawBody}`)

{ "id": "evt_…", "type": "payment.status", "createdAt": "…",
  "data": { "paymentId", "ref", "status", "engineState", "amount", "currency": "XAF", "intentId"?, "note"? } }
```

Verify: recompute the HMAC over `t + "." + rawBody` with your secret, compare in constant
time, and reject a `t` older than a few minutes. Reply 2xx quickly; do the work after.
Nothing here is on the money path: an unreachable partner never delays a payout.
