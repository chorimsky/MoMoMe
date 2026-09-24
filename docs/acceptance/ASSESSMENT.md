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

---

## Increment — API Platform, flow and UI end to end (2026-09-23)

Walked the whole platform surface as its two users see it: a developer signing up at
`/developers/dashboard`, and an operator in Admin → API Platform.

### The queue was the other door into live money

`decideRequest` applied a live-access approval as
`updateOrganization(orgId, { liveEnabled: true, kyb: "verified" })`. One click therefore did
two things: it switched on real money, and it **stamped the compliance record as verified**
without anyone having looked at a document. `PATCH /organizations/:id` had refused exactly
this since the previous increment — the activation queue was the same change by another
route, and the two requests sit next to each other in the list, so approving them in the
order they appear was enough to trigger it. It also left the company-verification request
open forever, because nothing had decided it.

Now: approving live access requires a KYB that is *already* verified, never sets `kyb`
itself, and is refused with `409 kyb_required`. The queue marks such a row `blocked`, the
console disables Approve and says why, and a decided request cannot be decided twice.

### Deciding blind

A queue row read `Bitbank · Live access · ada@bitbank.test`. Everything the decision turns on
— KYB state, plan, country, whether live was already on, how many keys are active, whether
the organization is suspended — lived one tab away. Each row now carries that state and an
**Open organization** button that opens the customer in place.

### "—" is not "0"

The four treasury tiles showed `— XAF` whenever no payout rail could report a balance. That is
honest (the figure is *unknown*), but on a money tile it is indistinguishable from broken, and
it is the state that stops new API payments. `treasuryView` now returns
`float_unknown_reason` — the per-rail reasons the float aggregator already recorded — and the
tile says **"Unknown, not zero — peexit: not configured · pawapay: not configured"**.

### The onboarding checklist dead-ended

Steps 3 and 4 ("make your first quote", "complete a sandbox payment") sent the developer to
the API keys tab, which by then had nothing left to offer: the only way to tick them off was
to copy a cURL into a terminal. Added a **sandbox console** on the Overview that runs the
three calls against the same public `/v1` any other client uses — a real `mm_test_`
credential in the Authorization header, the real bodies, the real responses, with each call
also shown as cURL. Nothing is proxied or simulated, so what the developer sees is what their
server will see. The key is sandbox-only, held for one browser tab, and listed, rotatable and
revocable under API keys like any other; the on-screen cURL carries only the key's hint, while
Copy puts the real secret on the clipboard.

### An IP allow-list that could not be set

`verifyCredential` has refused off-list addresses with `ip_not_allowed` since API v1 shipped,
and the Enterprise plan copy sells the feature — but no screen could set it, so it existed
only for whoever hand-wrote the API call. The API keys tab now sets it at creation and edits
it per credential.

### Smaller, all observed in the running app

- Completed checklist items were struck through and dimmed to 55%, which reads as *cancelled*
  rather than *done*; the green tick already carries the meaning.
- The 13-tab strip scrolls, and at phone width showed three tabs with nothing to suggest the
  other ten existed. It now fades at the edge.
- "No sandbox payments yet — run the quick start on the Overview" was a direction with no way
  through; it is now a link into the console.
- The Identity tile said Lightning was **enabled** while its own hint said an address was
  still missing. It now distinguishes *off* / *no address yet* / *enabled*.

Covered by 14 new assertions in `server/test/platform-admin.test.ts` (33 in total).

---

## Increment — Collection (money in), flow and UI end to end (2026-09-23)

Walked the money-in path as its three participants see it: the payer in the app, the
reconcile tick that drives it, and the operator who has to clean up after it. Ran it end to
end in the sandbox (MTN payer → Orange recipient, `MMT-2026-371568`, delivered) and covered
each finding with a test.

### The Lightning route's accounting was wrong, and could not be seen

`delivered()` posted the recipient's value leg — `customer_wallet → external_recipient` in
XAF — for **every** route. The Lightning route had already posted its own legs: the XAF into
the FX position, and BTC out of the FX position to the recipient. So one 5 000 XAF transfer
credited `external_recipient` 5 000 XAF **and** 0.000127 BTC, and drove `customer_wallet` to
−5 000.

It stayed invisible because every `recordTxn` balances within itself, and the ledger check
these tests use is per transaction. Nothing was per **account**. A probe of the route printed:

```
customer_wallet [XAF]        5000      ← should be 0
external_recipient [XAF]    -5000      ← paid once in XAF…
external_recipient [BTC]    -0.000127  ← …and again in BTC
```

Posting now belongs to the route that knows what moved: `postDirectDelivery()` for a direct
payout, nothing extra for Lightning, and `delivered()` only moves state and notifies. The new
`momo-lightning.test.ts` reaches this route for the first time (global `fetch` stubbed for
the LNURL resolve and the IBEX call) and asserts the per-account result, as does a new
per-account check in `momo-transfer.test.ts`.

This route is only reachable where IBEX is configured — production. Figures already written
are wrong for past Lightning-route transfers; the fix is forward-only.

### A refund that could not be made was a refund that never happened

`refund()` tried exactly once. No funded rail, or a rail that threw, meant a log line, one
operator notification, and a transfer left in `REFUND_PENDING` — a state
`reconcileTransfers` did not look at. Money taken from a payer, not paid to the recipient,
not given back, and never tried again. And when the submit *did* succeed it moved straight to
`REFUNDED` and posted the reversal, although a rail accepting a disbursement is not the same
as the payer having their money.

`REFUND_PENDING` now means exactly "we owe this payer and it is not confirmed back yet":

- the tick submits a refund that has not been submitted, up to 20 attempts;
- only the rail's own `COMPLETED` moves it to `REFUNDED` and posts the reversal, once;
- a rail that refuses clears the submission so the next tick tries afresh;
- after the cap it stops retrying but **stays** `REFUND_PENDING` — the debt is real and must
  stay visible — and says so on the record;
- an operator retries it from the console, idempotent at the rail on `refund_<id>`.

The local sandbox proved the point on real data: `MMT-2026-864068` had been sitting in
`REFUND_PENDING` since 13 September. The first boot with this change refunded it.

Admin → Mobile Money now counts what is owed above the table ("N transfers owe the payer
money — X XAF collected and not yet returned") and gives those rows a **Retry refund**
button. Previously the only actions in that table were on `HELD` rows.

### A payer who approved late was simply kept waiting — and kept paying

Our approval window (`rails.collect.ttlMinutes`) and the rail's need not agree. A payer who
approved a minute after we gave up was debited all the same, and nothing ever looked at an
`EXPIRED` transfer again: the money sat in the collection account, never delivered, never
returned, and invisible, because the payer's screen said the request lapsed and nothing was
taken. The tick now keeps asking the rail for 24 hours after a lapse; if the rail says the
payer paid, the collection is booked and returned in full, fee included. Paying it out
instead would surprise a payer who was told it had expired, and the liquidity check that
guarded that payout is long stale.

### A hosted collection rail had no way to reach the payer

Orange's Web Payment is completed by the customer on Orange's own page: the adapter gets a
`payment_url` back, and that URL *is* the rail. `CollectResult` had no field for it, so it
stopped at the adapter. The moment Orange is configured, the payer would be told to approve a
prompt that never arrives, and the request would expire. The URL now travels
adapter → `CollectResult.paymentUrl` → `MomoTransfer.checkoutUrl` → a **Open the payment
page** button, with wording that says the operator handles it on its own page.

### The payer could not see the clock that was running

The request lapses after the approval window (`rails.collect.ttlMinutes`, 15 by default). The
screen said "approve on your phone" and then, with no warning, "the request was not approved
in time". It now counts down, and turns amber under two minutes. Web and mobile.

### The one method priced in the sender's own currency showed no price

On "Choose how to pay", every crypto option says what the sender parts with — the code there
notes that without it "the sender picks blind". The Mobile Money tile, the easiest of all to
quote and the only one denominated in XAF, showed nothing. It now reads **"You pay 5 100 XAF
(includes a 100 XAF fee)"**, from the same stateless quote endpoint.

### Naming what the old posting left behind

The ledger fix is forward-only — entries already written stay written — so the question
"which transfers, and how much?" has to be answerable before a restatement can be decided.
Admin → Mobile Money now carries a **Transfer ledger audit** (Super Admin, read-only): it
walks every settled transfer, nets the ledger **per account and per currency**, and flags the
two symptoms of the defect — a customer wallet that does not return to zero, and a recipient
credited in more than one currency for one payment — with the total XAF booked to the
recipient account that no payment made. It reads; it never writes. Correcting the figures is
a decision, not something a screen should take.

### An operator's "rail off" switch did not stay off

Found by chasing an intermittent failure in `settle-or-refund.test.ts` — a case that switches
the second payout rail off and expects the payment to fall through to a refund. It passed
alone and failed inside the full chain, which is the shape of a race but was not one.

`HealthTracker.eligible()` treats a rail as selectable again once the probe cooldown has
elapsed. That is right for a rail the tracker itself took out after three failures: the probe
exists to re-test recovery. It was also being applied to `setUp(name, false)` — the operator's
own switch — so a rail an operator turned off returned to rotation by itself ten minutes
later. And `setUp(false)` stamped `downSince` only when it was still `0`, so switching off a
rail that had failed at some point earlier kept the old timestamp; if that was already past
the cooldown, the switch did **nothing**. That is the chain-versus-isolation difference: in
the chain the rail had earlier failures on record, so it was never actually taken out.

A payout or a refund could therefore be sent to a rail an operator had explicitly disabled.
An operator's decision is now recorded as such (`forcedDown`), is never eligible whatever the
cooldown says, always re-stamps, and survives a reported success — only the operator switching
it back on returns it to rotation. Four assertions in `rail-health.test.ts` pin both failure
modes, and `settle-or-refund.test.ts` now passes repeatedly rather than intermittently.

Covered by 27 assertions in the new `server/test/momo-lightning.test.ts`, 11 more in
`momo-transfer.test.ts` (42 total), 3 in `collect-rails.test.ts` (36 total) and 5 in
`rail-health.test.ts` (26 total).

---

## Increment — why "Pending" was growing, and the four holes under it (2026-09-24)

Production said this, without needing an admin session:

```
🔴 Payout float is 42,630 XAF — below 250,000
🟠 peexit wallet holds 1.8 day(s) of payouts (42,630 vs 23,616 XAF/day)
🟠 Still open (90h): 2 refund(s) unclaimed: MMM-2026-418934, MMM-2026-418911
[peexit] /disbursement/me → HTTP 500; balance is UNKNOWN, not zero
[treasury] pawapay: out of rotation (supports no corridor) — balance not counted
```

One payout rail, nearly empty, with a balance endpoint returning 500 and no failover
(PawaPay's Cameroon corridor is not activated — deliberate, and correct). That is the
operational backdrop. The code had four holes underneath it.

### Only a Lightning instruction ever expired

`reconcileOneInbound` returns immediately for anything that is not Lightning. An on-chain
BTC or USDT/USDC payment the customer simply never paid therefore sat at `AWAITING_INBOUND`
**for ever**, and since `DISPLAY[state] ?? "Pending"` makes every non-terminal state read
"Pending", each one was a permanent pending row. That is most of what a long pending list is
made of, and it is what buries the payments that are actually stuck.

`expireAbandonedDeposits()` now sweeps them. Expiring moves nothing — no funds arrived, no
ledger entry exists — so it is a triage decision, not a money one. The other half matters
just as much: the payment stays **matchable to a late deposit** for 14 days
(`DEPOSIT_RECOVERY_MS`), mirroring how a Lightning invoice already stays recoverable after
it expires. Without that, expiring would have converted a late-but-legitimate payment into
an unattributed inbound for someone to trace by hand.

### Nothing reconciled `INBOUND_CONFIRMED` or `FX_LOCKED`

`confirmInbound` books the inbound, re-prices, locks FX and requests the payout in one
inline flow. A process that stops in the middle — a deploy, a crash, an unhandled throw
inside the lock — leaves the payment at `INBOUND_CONFIRMED` or `FX_LOCKED` with our money on
the books and no payout requested. `reconcileStuckPayouts` starts at `PAYOUT_REQUESTED`;
`retryTransientHolds` only looks at `MANUAL_REVIEW`; the inbound reconcilers only look at
payments still awaiting one. Nothing would ever have touched it again.

`resumeStalledSettlements()` resumes it on the same path a held payment uses: the inbound is
already booked, `resume` skips re-booking it, and the payout key is unchanged so a rail that
already took the request answers "duplicate" rather than paying twice.

### Holds stopped retrying at twenty-four hours

Float-low, rail-down and stale-FX holds retry themselves — but `retryTransientHolds` skipped
anything held longer than 24 h as "a person's problem (paged)". These causes are all outside
the payment and can clear at any hour: an operator topping up the aggregator wallet on day
two expects the queue to drain, and it did not. Retries now continue for a week, hourly after
the first day. With the production float below its floor, this one was live.

### "Pending" meant four different things

One word covered: the customer never paid (none of our money), the money is in and
undelivered (our liability, clock running), the money is owed back, and a person has to
decide. New Super-Admin read-only `GET /admin/payments/pending-audit` and a **"What
'Pending' is made of"** card in Admin → Reports split them with the blocking reason for each,
and lead with the only figure that is a liability — `our_money_xaf`. Closed outcomes
(delivered / failed / refunded) are reported alongside, so "which failed" is answerable in
the same place.

Covered by 22 assertions in the new `server/test/pending-audit.test.ts`, including that
expiring books nothing, that a late deposit still settles its own payment, and that a
two-day-old float hold drains once the cause clears.

---

## Increment — reading the real payment export (2026-09-24)

89 production payments, exported from Admin → Payments. What they say, once the categories
are honest:

| the 44 rows marked "Failed" | |
|---|---|
| 11 | payments to sandbox test numbers (`677000789`, `677000788`, `677000798`) — our own testing |
| 9 | on-chain / stablecoin quotes nobody ever paid — closed by the sweep shipped in `78b04a7` |
| 24 | everything else, of which 23 are Lightning |

Of the 13 non-Lightning payments to real numbers, **three delivered** (all USDC), **nine were
never paid by the customer**, and **one is a genuine failure** (`MMM-2026-418928`, USDT,
10,000 XAF). A first reading of the same file called that rail "0 for 7, never once
succeeded" — counting abandonment as failure, which is exactly the defect below. The
denominator matters more than the rate.

### "Failed" is the same conflation as "Pending", one state later

`DISPLAY` maps both `FAILED` and `REFUNDED` to "Failed", and `FAILED` itself covers a quote
nobody paid (no money of ours; nothing went wrong) and money that arrived and could not be
delivered (the only failure that is ours). Measuring delivery against the two together makes
the product look far worse than it is and buries the failures worth acting on.

`GET /admin/payments/outcomes` and a **"Delivered, abandoned, or not delivered"** card now
measure the success rate against payments where money actually arrived, and list why money
that arrived did not land separately from why a quote was never paid.

### The export could not answer the question it exists for

The CSV said "Failed" and stopped: no reason, no state, no rail, no attempt count — so it
could not be used to work out what went wrong, which is the only reason anyone exports it.
It now carries **Outcome** (*Delivered / Never paid / Not delivered / Refunded to sender /
Refund owed / Held for review*), **State**, **Reason** (the payment's own last note),
**Payout rail**, **Attempts** and **Updated**.

### An unclaimed refund told the sender once, and sometimes not at all

`MMM-2026-418911` and `MMM-2026-418934` had been unclaimed for ten and four days. Only the
sender can resolve one — they have to supply a destination — and they were notified **exactly
once**, by a single push at the moment delivery failed. Push is also the only channel that
can reach a sender at all: the account is a device, we hold no number for them, and
`smsChannel` serves recipients only. A sender who never enabled alerts was told nothing,
ever, while the operator alert reminded itself hourly for ninety hours.

`remindUnclaimedRefunds()` now reminds hourly for the first day and daily for a month. And
when the sender has no push token, the audit row says so outright — *"we cannot tell them:
this sender has no way to receive a notification"* — instead of leaving an operator waiting
on a customer who will never hear from us.

Covered by 35 assertions in `server/test/pending-audit.test.ts`.

---

## Increment — NEXAH against a real deployment, and the WhatsApp webhook (2026-09-24)

### The provider does not speak the spec exactly

Pointed at `sms.wandatech.net`, two differences from the published NEXAH document, both
found without authenticating:

- the API is served at `/api/v1`, not `/bulk/public/index.php/api/v1` (which 404s);
- a rejection arrives as **HTTP 200** with `{"errorcode":401,"message":"Unauthorised"}` —
  no `responsecode` at all.

Read as the documented envelope, that second one became a bare "NEXAH refused the request",
throwing away the one word that says what is wrong. Both shapes are understood now, and an
**unrecognised** shape is still a failure, never a success.

### A placeholder is worse than a missing value

`--set NEXAH_PASSWORD='<your rotated password>'` quotes the instruction, so the shell stores
it verbatim: non-empty, so every "is it set?" check passes, and then the provider refuses
every send. The readiness console already guarded its own secrets against exactly this
(`...`, `<any long random string you pick>`); NEXAH was not covered.

The first version of the guard matched only a **leading** keyword — so
`replace-with-your-rotated-password`, a placeholder this project's own instructions produced,
sailed straight through it. And `\b` does not fire across an underscore, so `TODO_here` and
`replace_with_your_password` would have too. It now matches an instruction word anywhere in
the phrase, bounded on non-alphanumerics, and only when the value contains a word separator —
so `Demo2000@$&`, `k3Yr-8f2!x_qz` and an email login are not flagged.

### The console blamed the credentials for a switch

Every NEXAH variable set correctly, and the console still read *"nobody can verify a number.
Set NEXAH_USER / NEXAH_PASSWORD / NEXAH_SENDER_ID"* — because `otpChannels()` computed
`sms: providerConfigured && settings.channels.SMS`, one boolean over two unrelated causes.
An operator was sent to re-check credentials that were already right. Provider-readiness and
the Settings switch are now reported separately, and the message names whichever is actually
missing.

`Admin → Notifications → Check credentials` (`GET /admin/notifications/sms-check`) asks the
provider for the account balance, which authenticates **without sending anything** — so a
wrong credential is found there rather than by a customer who never receives a code.

### WhatsApp: the webhook verified a signature only when it could

`/webhooks/whatsapp` checked Meta's HMAC only `if (config.whatsapp.appSecret)`. A deployment
with an access token and a phone number but no `WHATSAPP_APP_SECRET` accepted **any** POST,
and three things followed from a forged body:

- an invented inbound made the bot reply — a WhatsApp message from our own verified business
  number to a number the caller chose, plus model spend on every one;
- `noteInbound()` opened Meta's 24 h window for that number, after which free-form text needs
  no approved template;
- invented `statuses` drove `updateDelivery`, marking a real one-time code delivered or failed
  on evidence nobody supplied.

Every other rail here refuses what it cannot verify. This one is now the same: 503 with the
reason, and a boot warning naming the variable. Not exploitable in production today —
Railway holds no `WHATSAPP_*` variables at all, so the route 404s — but it would have opened
the moment someone set the token and phone number without the secret.

### And the reply window evicted the wrong number

At 20,000 tracked numbers the tracker deleted `keys().next().value` — the number that
messaged us **first**, not longest ago, because a Map does not reorder on `set`. The most
loyal daily user was first out, and losing the entry closes their 24 h window, so their next
notice degrades to a template or is skipped when no template covers that kind. Eviction now
takes an entry whose window has already expired — already useless — and only falls back to
the genuinely oldest when none have.

Covered by 51 assertions in `server/test/nexah.test.ts`, 10 in the new
`server/test/whatsapp-unsigned.test.ts` and 37 in `server/test/whatsapp.test.ts`.

---

## Increment — the WhatsApp bot: reachable, switchable, and not a read of the whole book (2026-09-24)

### `status` answered anybody

`status MMM-2026-418921` returned the amount and state of any payment, to anyone, with no
ownership check. References are **sequential** — the production export runs 418843 → 418937
with six gaps — so walking the range read back the book: every payment's amount and state,
from a WhatsApp message, with no account and no app. Nothing else exposes a payment by
reference (`/payments/:id` goes through `ownerOf`); the bot was the only door.

A person may now ask about a payment they **received** (their number is the recipient) or one
they **sent** (their number is the one their device anchored to). Everyone else gets the reply
that a non-existent reference gets, byte for byte — a distinct "not yours" would still have
leaked which references exist.

### The bot had no entry point, and then no switch

Nothing in the product told anyone the bot existed: the only `wa.me` links were for sharing a
pay link, and the support number — a person. `company.whatsappBot` is now its own setting,
`/api/config` carries it beside (not instead of) `support.phone`, and the landing page and
Help render a **Pay on WhatsApp** button.

`features.whatsappBot` gates it, **off by default**, and off means off: the buttons disappear
**and** inbound messages get no reply. A switch that only hid the button while the bot kept
answering would be the same half-truth as a channel toggle in front of an unwired provider —
the one that sent an operator chasing NEXAH credentials that were already correct. Both the
feature and a configured number are required before anything renders.

Delivery receipts are deliberately **not** gated: those are Meta reporting on messages *we*
sent, and they belong to the notification outbox rather than to the bot. Meta still gets a
fast `200` so it does not retry into a disabled endpoint.

### Three suites shared one latent crash

`interop`, `connect` and `roadmap-e2e` all read `r.body.routes` (or `.data.id`) without
checking the response first. When route discovery answers `503` from its own stuck-guard,
`.length`/`.find` on `undefined` throws an opaque `TypeError` that takes the run down and
says nothing about what the API replied — which cost most of a day in "is this my change or
a flake?". All three assert the response before its shape now, and stop with the real cause.

Covered by 47 assertions in `server/test/whatsapp.test.ts` and 10 in
`server/test/whatsapp-unsigned.test.ts`.
