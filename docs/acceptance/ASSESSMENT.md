# Merchant payment acceptance & multi-rail settlement — assessment of what exists

Read before building. The brief describes a programmable acceptance + settlement layer in 51
sections. Most of it is already standing in this codebase under different names; this maps
each section to the code that serves it, so the work is *extension*, not reinvention.

## The system as it is

| Layer | Where | What it already does |
|---|---|---|
| Public API | `server/src/publicApi/*` mounted at `/v1` | `{data,meta}` envelope, `Authorization: Bearer mm_live_/mm_test_`, scopes, per-plan rate limits, **Idempotency-Key** (replay, mismatch, in-progress), typed errors, OpenAPI 3.1 |
| Merchant/org model | `core/platform/orgs.ts`, `credentials.ts`, `accounts.ts`, `billing.ts` | organizations, users + roles, applications, credentials with rotation, plans/pricing tiers, KYB + live-access requests with an operator queue |
| Payment intent | `core/connect/intents.ts` | canonical intent: payer/payee, amount, purpose, permitted methods, **status vs settlement_status**, events, expiry, execution leg |
| Payment methods | `core/connect/routing.ts` + engine adapters | `momo_me`, `lightning`, `stablecoin`, `mobile_money`, `bank_transfer` as first-class method ids |
| Collection (money IN) | `core/momoTransfer.ts` → `adapters/peexit.ts collect()` | Mobile Money **collection** works today: request-to-pay to the payer's phone, payout-liquidity checked first, async approval, refund on payout failure |
| Payout (money OUT) | `adapters/payouts.ts` (registry) + `peexit`, `pawapay` | multi-provider registry with `configured()/live()/supports()/priority`, balance-aware selection, failover, authoritative re-query, statements |
| Crypto rails | `adapters/ibex.ts`, `phoenixd.ts` | Lightning invoice/LNURL, on-chain BTC, USDT/USDC deposit addresses, webhook + reconcile |
| Settlement | `core/connect/settlements.ts` | **settlement intent per payment**: momo_me settled, mobile_money/lightning auto fee-free payout (instant/daily/weekly/manual), bank_transfer via an operator queue |
| Routing | `core/connect/routing.ts`, `core/routing.ts`, `core/upi/routing.ts` | explainable policy (internal → direct → lightning → stablecoin → fallback), funded-rail selection, canary controls |
| Liquidity | `core/platform/liquidity.ts`, `core/floatPlan.ts` | reservations over the XAF float, check-and-reserve, treasury view, earmarks |
| Ledger | `core/ledger.ts`, `core/connect/ledger.ts` | double-entry accounts, per-identity balances, clearing account, compensating entries |
| Webhooks | `core/interop/outbound.ts`, `publicApi/webhooks.ts` | typed events, HMAC signature, retry with backoff, delivery history, replay, per-endpoint health/disable |
| Checkout | `app/src/pages/Checkout.tsx` + `GET/POST /v1/checkout/:id` | hosted checkout at `/p/:id`: method choice, instructions, countdown, status polling |
| Quotes | `core/quote.ts`, `publicApi/quotes.ts` | locked FX + fee breakdown, expiry, atomic claim (one quote → one payment) |
| Compliance | `core/compliance.ts`, `core/interop/compliance.ts` | hash-chained audit, CDD/velocity/watchlist flags, manual-review holds, STR/CTR |
| Sandbox | `core/platform/sandbox.ts` | scenario numbers for failure/manual-review/insufficient-liquidity/provider-unavailable/timeout/delay |
| Observability | `/health/deep`, `core/analytics.ts`, admin Reports | rail success/latency, payment funnel, failure reasons, webhook delivery, reconciliation |
| Dashboards | `app/src/pages/developers/Dashboard.tsx`, `/admin` | volume, payments, settlements, usage, invoices, webhooks, identities, payouts |

## Section-by-section

**Already served** (no new architecture needed): §3–4 payment intent · §5 payment methods ·
§11 settlement abstraction · §12–15 source/destination/settlement legs (`execution` +
settlement intent + ledger) · §16 routing · §17 liquidity states · §20 quotes · §21–22 hosted
checkout (+ headless via `/v1`) · §23 lifecycle (engine states map to public states in
`platform/mapping.ts`) · §24 webhooks · §25 idempotency · §26–27 merchant account and
settlement profile · §28 dashboard · §29 payment links · §30 invoices · §31 metadata/reference
for order systems · §32 freelancer flow (link + settlement profile) · §33 resource-shaped API ·
§34 provider adapters · §36 reconciliation · §37 ledger · §38 refunds (rail-dependent, with
`REFUND_PENDING` → manual review) · §39 compliance · §40 security · §41 sandbox · §42
observability · §43 docs + SDKs · §49 configuration-driven pricing.

**Partial**
- §6 rail abstraction: payouts have a registry with failover; **collection does not** — it is
  hard-wired to one aggregator inside `momoTransfer.ts`.
- §18/§19/§48 Lightning as interoperability: the pieces exist (Lightning payout, LN address,
  corridor flags in `core/interop`), the cross-border corridor is not switched on.
- §27 settlement preferences: an identity has one settlement profile; no fallback account,
  threshold or explicit "always MTN / always Orange" choice.

**Missing**
- §7 **direct MTN Mobile Money Collection** adapter (today: via an aggregator).
- §8 **direct Orange Money** collection adapter (today: via an aggregator).
- §35 failover *for collection* (provider choice, limits, cost, eligibility).
- Per-provider collection capabilities: limits, fees, health, supported operators.

## What this increment builds

The gap that blocks Increment 1 is not the payment model — it is that **collection has no rail
abstraction**. So:

1. `adapters/collect.ts` — a `CollectAdapter` interface and registry mirroring
   `adapters/payouts.ts`: `configured()`, `live()`, `supports(operator)`, `priority`,
   `collect()`, `status()`, `limits()`, `feePct()`, `verifyCallback()`, `health()`.
2. The existing aggregator collection becomes the first adapter — no behaviour change.
3. MTN and Orange adapters implemented against their **documented** APIs, inert until the
   operator supplies credentials (nothing is inferred about undocumented behaviour, and
   commercial onboarding with each provider stays the operator's).
4. `momoTransfer` (and therefore the Connect `momo_collection` execution kind, the hosted
   checkout and the settlement engine behind it) selects a collection rail through the
   registry, with the same availability/limits/cost/failover discipline as payouts.

Nothing above changes an existing public contract.

---

## Increment 1a — delivered: the collection rail abstraction

`server/src/adapters/collect.ts` — `CollectAdapter`, the mirror of `PayoutAdapter`:
`configured() / live() / supports(operator, country) / priority / collect() / status() /
feePct?() / limits?() / verifyCallback?() / health?() / simulates?()`, with
`collectorsFor()`, `selectCollector()` (corridor → rail, with the reason it chose or refused)
and `collectHealth()`.

Rails registered: **mtn** (MTN's own Collection API), **orange** (Orange Web Payment),
**peexit** (the aggregator already in production). Selection prefers a configured operator
rail over an aggregator, refuses a corridor no rail serves, and — the rule the sandbox
caught immediately — will not choose a rail that cannot act: an operator adapter with no
credentials is never selected, because it would fail *after* the payer had been prompted.
Only the aggregator stands in for a rail when unconfigured (`simulates()`), which is what
every demo and test already relied on.

`core/momoTransfer.ts` (and therefore the Connect `momo_collection` execution kind, the
hosted checkout behind it, and settlement) now asks the registry instead of one aggregator,
records which rail took the request, and reconciles against that same rail. `/health/deep`
reports the collection side beside payouts, and a configured collection rail that stops
answering is a `problems[]` entry like any other.

Both operator adapters are **inert without credentials** and implement only documented calls:
MTN `POST /collection/token/` → `requesttopay` (our idempotency key is `X-Reference-Id`,
stable across retries) → `GET requesttopay/{ref}`; Orange `POST /oauth/v3/token` →
`webpayment` (returns a hosted URL) → `transactionstatus`. An unrecognised status reads as
PENDING, never as success. No PIN is ever requested, seen or stored.

**Operator-owned before either can move real money:** a commercial collection/merchant
account with MTN and with Orange, the production environment names and endpoints each
assigns, callback hosts registered with them, and written confirmation of the limits and fees
on those accounts. Regulatory permission for collection in CEMAC is a separate question from
API access and is not implied by this code.

### Next increments (unchanged plan)
1b. Expose `mobile_money` as a first-class method on merchant payment intents end to end
    (checkout method list already reads `fundingAvailable()`), with per-rail limits surfaced
    in the quote.
2.  Crypto acceptance is already live; wire payment links to the same intent.
3.  Settlement preferences: fallback account, threshold, explicit operator choice.
4–6. Cross-rail routing, Lightning interoperability, developer ecosystem — the routing
    engine and `core/interop` already model these; they are switched on, not built.

---

## Collection (money in) — flow review and the configuration gaps closed

The flow: create → `selectCollector` → `rail.collect()` → `AWAITING_PAYER` → the payer
approves on their own handset → the rail's authoritative `status()` → `onCollected` → ledger
→ payout/settlement. Six gaps, all of them configuration or the lack of it:

1. **No collection callback existed.** Money out has had `/webhooks/payout/:name` since the
   beginning; money in had none, so an approval was noticed only when the 30-second reconcile
   tick next asked. `/webhooks/collect/:name` now settles the named transfer immediately,
   with the payout path's discipline: adapter-verified, acked fast, and settled ONLY on the
   rail's own status — a callback body is a hint that something changed, never proof of what.
   An inconclusive answer changes nothing and reconcile keeps ownership.
2. **The approval window was a constant** (15 minutes). Now `rails.collect.ttlMinutes`.
3. **`CONNECT_MOMO_COLLECT` was an env var**, so switching the money-in side on or off needed
   a redeploy. Now `rails.collect.enabled`; the env var remains the initial value so upgrading
   a deployment changes nothing by itself.
4. **A rail's own limits could not be recorded.** They cannot be probed, and being refused
   after the payer approves is the worst way to learn one. `rails.collect.railLimits` is
   enforced by the selector before the payer is prompted.
5. **The collection fee was a constant** (`TRANSFER_FEE_PCT`) — the one price on the platform
   that could not change without a deploy. Now `pricing.collectFeePct`, edited in Admin →
   Rates & Pricing, and a test proves a change reaches the payer's quote immediately.
6. **What a rail charges US to collect could not be recorded** (`pricing.contracts` covered
   payouts only), so every collection-side margin figure was a guess. Added
   `pricing.collectContracts`.

Everything above is managed in Admin → Payment Rails: master switch, per-operator pinned rail
with the engine's own live answer beside it, rail on/off, global bounds, approval window,
per-rail recorded limits, and payout preference. Every change is audited.
