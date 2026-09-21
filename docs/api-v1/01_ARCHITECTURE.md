# API v1 — Architecture

## Layout

```
server/src/
  core/platform/            the new bounded contexts (no money rules here)
    orgs.ts                 User, Organization, Membership (roles), Application
    credentials.ts          mm_live_/mm_test_ credentials: hashed, scoped, revocable
    idempotency.ts          persisted Idempotency-Key records (org+endpoint+key+hash)
    audit.ts                per-org audit events (actor, ip, request id)
    usage.ts                metering: requests, quotes, payments, volume, fees, webhooks
    limits.ts               configurable limits (org/country/asset/currency/operator, txn/day/month/velocity)
    liquidity.ts            atomic reservations over the XAF float (reserve → consume/release)
    settlements.ts          settlement requests over an org's balance (ledger-derived)
    billing.ts              pricing plans, tiers, usage → invoices
    compliance.ts           decision record per payment (CLEAR/REVIEW/BLOCKED), auditable
    sandbox.ts              scenario numbers (test environment only)
    mapping.ts              V1 engine ⇄ public v1 objects (states, quotes, payments, timeline)
  publicApi/                the /v1 HTTP surface
    index.ts                router: request id, auth, env check, rate limit, envelope
    quotes.ts payments.ts recipients.ts webhooks.ts settlements.ts account.ts usage.ts transactions.ts health.ts
    openapi.ts              OpenAPI 3.1 for /v1 (served at GET /v1/openapi.json)
```

`/v1` is mounted at the TOP level (not under `/api`): `https://api.momome.xyz/v1/...`.
The existing `/api/*` (apps) and `/api/v1/*` (interop intents) are untouched.

## Request pipeline

```
request → X-Request-Id (or req_…) → Authorization: Bearer mm_<env>_… → credential (hash lookup)
        → environment matches this deployment? → scope check → org rate limit (plan)
        → Idempotency-Key (POST) → handler → envelope {data, meta} / {error, meta}
        → usage meter + audit (async)
```

Errors: `{ error: { code, message, details }, meta: { request_id } }`. Codes are stable
strings (`unauthorized`, `forbidden_scope`, `environment_mismatch`, `idempotency_key_reused`,
`quote_expired`, `payment_not_found`, `limit_exceeded`, `rate_limited`, `validation_failed`,
`recipient_invalid`, `insufficient_liquidity`, `provider_unavailable`, …). The full list
is in `publicApi/errors.ts` and in the OpenAPI document.

## Environments

A deployment is one environment: `liveMoney()` true → **live**, else **test**.
`mm_live_` keys are accepted only by the live deployment; `mm_test_` only by the sandbox
deployment. The wrong one answers `401 environment_mismatch` with the right base URL in
`details.base_url` (from `PUBLIC_URL` / `SANDBOX_API_URL`).

Developers create both kinds of credential from the production dashboard. The sandbox
deployment does not share production's database, so it validates an unknown `mm_test_`
key by asking production once (`POST /v1/internal/credentials/verify`, HMAC-signed with
`PLATFORM_SYNC_SECRET`, key sent as its hash, never in clear) and caches the answer for
10 minutes (`PLATFORM_ORIGIN_URL` on the sandbox). Without that configuration the sandbox
only knows credentials created on it directly (admin console) — still usable locally.

## State mapping (engine → public)

| Engine (unchanged) | Public v1 |
|---|---|
| QUOTED | CREATED |
| AWAITING_INBOUND | AWAITING_PAYMENT (EXPIRED once the instruction has expired) |
| INBOUND_DETECTED | PAYMENT_DETECTED |
| INBOUND_CONFIRMED | PAYMENT_CONFIRMED |
| FX_LOCKED | CONVERSION_PROCESSING |
| PAYOUT_REQUESTED | PAYOUT_PROCESSING |
| PAYOUT_CONFIRMED | PAYOUT_SUBMITTED |
| DELIVERED | COMPLETED |
| REFUND_PENDING / REFUNDED | REFUNDED (`refund.status` says pending/settled) |
| FAILED | FAILED |
| MANUAL_REVIEW | MANUAL_REVIEW |
| (cancelled before funds) | CANCELLED |

The engine is never renamed: the map lives in `core/platform/mapping.ts` and the
timeline (`created_at … completed_at`) is derived from `Payment.events`.

## Money path

`POST /v1/payments` → org/credential/scope → limits → compliance decision → liquidity
reservation → `createPaymentCore()` (the SAME function the app calls) → reservation is
tagged with the payment id; it is consumed at DELIVERED and released at FAILED/REFUNDED/
EXPIRED by the existing state machine hook (`notifyPaymentChanged`). Nothing else on the
path is new.

## Ledger

The existing journal (`core/ledger.ts`) stays the single source of truth. Organization
balances are ledger-derived: an `org_balance:<orgId>` account receives credits from
collections products that credit an organization (none exist yet — pass-through
settlement holds nothing) and debits from settlements. Corrections are compensating entries.
