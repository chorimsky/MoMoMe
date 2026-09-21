# MoMo›Me API v1 — Audit of the existing system (2026-09-21)

Rule 61 of the mandate: analyse before building, preserve what works, reuse what exists.
This is what the live backend already has, what it lacks against the API v1 blueprint,
and the one architectural decision the blueprint forces us to state.

## The stack decision

The blueprint names Laravel / PostgreSQL / Next.js, and in the same breath (§4, §61) says
"use the existing MoMo›Me backend ecosystem where possible" and "do not rewrite working
infrastructure unnecessarily". The working infrastructure is:

- `server/` — TypeScript, Express, one process on Railway, live money since 2026-09-03.
  IBEX (Lightning + on-chain + USDT/USDC deposits), PawaPay and Peexit (payouts),
  Peexit Get-KYC (recipient names), the payment state machine, the double-entry ledger,
  routing with failover, reconciliation loops, the admin console, alerts and Sentry.
- `app/` — React/Vite on Vercel (the public site, the send flow, `/developers`, `/admin`).
- `mobile/` — Expo.

API v1 is therefore built **on this stack, additively**: a new public surface at `/v1`
that speaks the blueprint's contract and delegates every money rule to the same functions
the app uses (`buildQuote`, `createPaymentCore`, the state machine). Rewriting the
settlement engine in PHP would re-implement, untested, the code that currently moves real
money. The PHP deliverable is honoured as an SDK (`momome-php`), generated from the same
OpenAPI document as the TypeScript SDK.

Storage: production is SQLite on a Railway volume, with a tested Postgres cutover
(`scripts/`, `db/repo.ts`, `STORE_BACKEND=postgres`). New API v1 collections use the same
`register()/touch()` persistence seam so they ride either backend; the Postgres schema for
them is in `db/schema.sql` (appended, not rewritten).

## What exists and is reused as-is

| Blueprint section | Existing implementation | Reuse |
|---|---|---|
| §8 API credentials (hashed, one-time secret) | `core/apiKeys.ts` — `mk_…`, SHA-256 hash, `lastUsedAt`, revoke, per-key fee | Superseded by `core/platform/credentials.ts` (`mm_live_/mm_test_`, org/app/env/scopes); `mk_` keys keep working on `/api/*` |
| §9 Idempotency | `core/interop/intents.ts` `idemLookup/idemStore` (intents only) | Generalised: `core/platform/idempotency.ts` persists org + endpoint + key + request hash + response |
| §11 Quote engine | `buildQuote()` in `routes/api.ts`; FX from `core/rates.ts` + `core/fx.ts`; fees from `core/pricing.ts` | Called directly; the v1 quote is a projection of the V1 quote |
| §12–14 Payment engine, state machine, attempts | `core/stateMachine.ts` (`transition`, `payoutKeyOf`, `failoverPayout`, refunds), `Payment.events` | Called directly; states are MAPPED to the blueprint's names (below) — the engine is not renamed |
| §15 Routing engine | `core/routing.ts` (balance-aware aggregator choice) + `core/upi/routing.ts` (rule-driven, shadow) | Called directly |
| §16 Mobile Money provider interface | `adapters/payouts.ts` `PayoutAdapter` (pawapay, peexit, simulator) | Is the interface; adapter list is configuration |
| §17–18 Digital asset interface, IBEX | `adapters/index.ts` `RailAdapter` + `adapters/ibex/*` | Is the interface; IBEX objects never leave the adapter |
| §19–20 Liquidity, treasury | `core/floatPlan.ts`, `core/treasury.ts`, `core/upi/liquidity.ts`, `payout_float_XAF` ledger account | Reservation is added (`core/platform/liquidity.ts`) around the existing float check |
| §21 FX engine | `core/rates.ts` (feeds, freshness), rate locked on the payment (`FX_LOCKED`) | As-is: effective rate is immutable on the payment |
| §22 Fee engine | `core/pricing.ts` + Settings → Pricing + per-key fee | Extended with org pricing plans |
| §23 Webhooks | `core/interop/outbound.ts` — HMAC `X-MoMoMe-Signature`, 1s→1h backoff, dead-letter, persisted queue, SSRF guard | Reused; blueprint event types are emitted alongside `payment.status`; test/replay endpoints added |
| §24 Reconciliation | `core/interop/reconcile.ts`, `core/depositReconcile.ts`, `core/upi/ledger.ts` | Reused; exceptions surfaced on the v1 timeline |
| §33 Ledger | `core/ledger.ts` — balanced journal, append-only | As-is |
| §34–35 Security, rate limits | `core/ratelimit.ts` (durable), device signatures, admin step-up, egress allow-list | Reused; per-plan limits added |
| §36 Observability | `/health/deep`, `core/alerts.ts`, Sentry, `core/interop/metrics.ts` | Reused |
| §30 Sandbox | `RAILS_MODE=sandbox` simulator, `/payments/:id/simulate`, `peexit.simulatePayoutOutcome`, identity magic numbers | Reused; scenario numbers added |
| §31 Docs | `openapi.ts` (4 paths), `app/src/pages/Developers.tsx` | New `/v1` OpenAPI 3.1 document + portal rewrite |
| §39 Admin | `/admin` console (Rails, Liquidity, Reports, Interoperability, Identities…) | Extended with Organizations / API usage / Settlements |
| §44 Critical flow | `test/lightning.e2e.ts`, `settle-or-refund.test.ts` | Re-run through `/v1` in `test/api-v1.test.ts` |

## What is missing (built in the phases that follow)

1. **Identity context**: users, organizations, applications, credentials with
   environment + scopes, roles/permissions, per-org audit — today one flat key list.
2. **Public `/v1` surface** with the blueprint contract: `{data, meta.request_id}` /
   `{error:{code,message,details}, meta}` envelope, `Authorization: Bearer mm_…`,
   generalised `Idempotency-Key`, per-plan rate limits with `Retry-After`.
3. **Environments**: `mm_test_` vs `mm_live_`. A process is one environment
   (`liveMoney()`); see 01_ARCHITECTURE for how the sandbox deployment validates test
   credentials issued by production.
4. **Settlements** (org balance → destination), **usage metering**, **billing**
   (plans, tiers, invoices), **limit engine** (configurable dimensions), **liquidity
   reservation** (atomic, per payment), **compliance decision record** per payment.
5. **Developer dashboard** (`/developers/dashboard`) and admin Organizations view.
6. **Sandbox scenarios** by reserved recipient numbers.
7. **SDKs** generated from the OpenAPI document (TypeScript, PHP), Python after.

## Money-path rule

Nothing in API v1 duplicates a money rule. Every `/v1` write ends in the same core call
the app makes; the only additions on the path are (a) the org/credential/limit gate
before `createPaymentCore`, and (b) the liquidity reservation, which wraps — not
replaces — the existing float check.
