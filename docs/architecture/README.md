# MoMo›Me architecture — a payment interoperability layer

> MoMo›Me does not compete with the financial system. It makes it interoperable.

## What MoMo›Me is

An orchestration layer between payment networks. A person expresses an intent — "send
5 000 XAF to this number" — and MoMo›Me finds a path that can carry it, quotes it, executes
it through regulated partners, and confirms it. The person never picks a network, chain,
wallet or provider.

## What MoMo›Me owns, and what it does not

| MoMo›Me owns (technology / orchestration) | Regulated partners own (financial activity) |
|---|---|
| The intent, route, quote and status of a payment | Custody of crypto and its conversion (IBEX Hub) |
| Address resolution: who a number belongs to, where it can receive | Mobile Money disbursement (Peexit, PawaPay → MTN, Orange) |
| Deterministic routing across rails | Lightning liquidity when not on our own node |
| A double-entry ledger of every movement it orchestrates | Holding customer balances (MoMo›Me holds none: value is in transit only) |
| Compliance checks, limits, audit chain, reconciliation | Licensing for the corridor |

The `regulatedParty` field on every rail (`GET /api/v1/rails`) and the `party` on every route
step make this split explicit in the API, not only in documents.

## The shape of a payment

```
Payment Intent  →  Address resolution  →  Routing  →  Quote  →  Route lock
      →  Execution (engine payment)  →  Settlement (rails)  →  Confirmation
```

- **Intent** (`core/interop/intents.ts`): what the user wants, owner-scoped, idempotent.
- **Address resolution** (`core/interop/addresses.ts`): a phone, Lightning Address,
  merchant code or payment link → the rails that can reach it, the owner's registered
  name, limits, status (ACTIVE / UNSUPPORTED / BLOCKED / RESERVED).
- **Routing** (`core/interop/router.ts`): deterministic checks in a fixed order; every
  route records its checks and a score; the best viable route is recommended.
- **Quote**: ONE implementation (`buildQuote` in `routes/api.ts`), consumed by `/api/quotes`
  and by every route.
- **Execution**: ONE implementation (`createPaymentCore`), consumed by `/api/payments` and
  by `/api/v1/payment-intents/:id/execute`. The intent is the double-payment lock.
- **Settlement**: the existing engine (`core/stateMachine.ts`), rails (`adapters/*`),
  webhooks (`routes/webhooks.ts`) and reconcile loops, unchanged.
- **Confirmation**: canonical status (`shared/interop.ts` `toCanonicalStatus`) derived
  from the engine state, with a trace chain (payment id → ref → provider reference →
  payout reference).

## Layers

```
 apps (web, mobile, WhatsApp bot, partners)
 ─────────────────────────────────────────────
 /api/v1  interoperability API      /api  product API (unchanged)
 ─────────────────────────────────────────────
 core/interop: rails · addresses · intents · router · events · reconcile
 ─────────────────────────────────────────────
 core: stateMachine · ledger · fx · compliance · identity · merchant · notifications
 ─────────────────────────────────────────────
 adapters: crypto rails (IBEX, phoenixd, sandbox) · payout rails (Peexit, PawaPay)
           channels (SMS, WhatsApp, push) · Meta AI
 ─────────────────────────────────────────────
 persistence: in-memory collections snapshotted to SQLite (Railway volume); Postgres repo
```

## Country-agnostic core

`shared/domain.ts` `COUNTRIES` carries dial code, currency, operators and number lengths per
country; `active` gates what is on offer. Nothing in `core/interop` names a country: it
reads the destination's country from the address and the currency from the registry.
Cameroon is the first active entry, not an assumption.

## Adding a rail

See [payment-rails](../payment-rails/README.md). In short: implement the adapter contract,
register it in its family, describe it in the registry. The payment core does not change.

## Product analytics (Admin → Insights → Audience)

First-party and anonymous by construction. The web app and the mobile app send small
batches to `POST /api/telemetry`: a page or screen view (route class, never a URL with
ids), a session start and end with its length, and named actions (`send_step` with its
step, `method_chosen`, `share_link`, `scan`, `receive_link_created`, `get_app`). Each
batch carries a random visitor id the client made up and keeps, a session id, the
platform, app version, language, timezone and a screen-size class. No phone number, no
device key, no IP address is accepted or stored; the country comes from the timezone.
The operator console and ops pages are never tracked, and a browser's Do-Not-Track is
respected. Events live in a bounded, persisted ring (`server/src/core/analytics.ts`) and
are aggregated on read by `GET /api/admin/analytics?days=N` (section `audience`: Super
Admin, Operations Manager, Finance Manager, Read Only) into sessions and people per
platform and country, session length, most visited pages with time on page and
entrances/exits, the send funnel step by step, actions with their most common value,
hour of day and day series, languages, screens, versions and referrers.

## Unit economics (the levers in code)

- **Fee floor** — `pricing.minFeeXaf` (default 100): the platform fee is `max(xaf × feePct,
  minFeeXaf)`, computed in one place (`core/pricing.ts`). At the 500 XAF minimum a flat 2.5 %
  was 12 XAF against an aggregator fee of 8.5 XAF on a real movement.
- **Partner pricing** — an API key may carry `feePct`; its quotes, previews and v1 routes use
  it. `GET /api/admin/apikeys/usage?month=` sums delivered payments, volume and fees per key:
  the invoice basis. Changing a key's rate is a step-up operation.
- **Cost-aware payout routing** — among funded, eligible rails the lower `payoutFeePct`
  (Peexit reports its MTN/Orange schedule) wins; unknown fee ranks last; ties by balance,
  then recent success.
- **Realized FX** — a treasury sweep records what customers were charged for that crypto
  (`customerXaf`) and the mid value; the operator later marks what it became in XAF
  (`POST /api/admin/treasury/withdrawals/:id/sold`). The ledger moves the crypto out of
  `fx_position` and the XAF into the float through `fx_pnl`; Rates & Pricing shows realized
  versus booked spread. Tests: `server/test/profitability.test.ts`.
