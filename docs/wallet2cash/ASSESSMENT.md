# Wallet2Cash Partner Gateway — API review

**Written:** 2026-10-21 · **Source:** `docs.staging.wallet2cash.com`, read in full (index,
auth, idempotency, webhooks, errors, sandbox, and the endpoint reference) · **Status:** we
have no implementation of this — what follows reviews THEIRS.

---

## 1. What it is

A partner gateway for **crypto ↔ Mobile Money in Cameroon (MTN, XAF)**. Five services,
each granted individually: `MOMO_DEPOSIT`, `MOMO_WITHDRAWAL`, `CRYPTO_BUY`, `CRYPTO_SELL`,
`KYC_MOMO`.

That is momome's own product, offered as an API. It is the first candidate that covers
**both legs** of what we do rather than just the fiat one — which makes it the most useful
and the most strategically loaded of the three we have now looked at.

Base URL: `https://gateway.staging.wallet2cash.com/api/v1/…` (resolves). There is **no
documented production host**; `api.staging.wallet2cash.com` is NXDOMAIN and
`wallet2cash.com` did not answer. Treat this as pre-production.

## 2. The engineering is the best of the three

Not a compliment I expected to be writing. Specifics, each of which is something we have
had to work around elsewhere:

**Idempotency is real, and they say why.** Every creating call takes a `partnerOrderId`,
enforced by *a unique database constraint on (PartnerId, PartnerOrderId)* — not an
application check. A repeat returns `duplicate: true` alongside the original transaction's
current state, so a retry doubles as a free status read. They spell out the concurrent-race
case: both requests pass the "does it exist" check, one wins the insert, the loser's write
fails on the constraint and the gateway re-reads the winner's row rather than surfacing a
database error. Compare CamPay, whose `/withdraw/` docs promise idempotency in one
paragraph and reject duplicate UUIDs in the next, and Payfonte, which documents none.

**Money-out is signed; money-in is not.** `MOMO_WITHDRAWAL` and `CRYPTO_SELL` require
`X-Timestamp` + `X-Signature`, HMAC-SHA256 over `"{timestamp}.{raw_json_body}"`, keyed with
the AppKey, over *the literal bytes sent*. ±5 minutes, and **a future timestamp is treated
exactly as suspiciously as a stale one** — which is the half most implementations get
wrong. Asymmetry by direction is the right call: a forged deposit costs them nothing, a
forged withdrawal costs real money.

**They refuse to guess a terminal status.** `GW-00-PENDING` is documented as "also the
default when an upstream status can't be confidently mapped — the gateway never guesses
Success/Failed when unsure." That is our own rule, in their docs, which I have not seen a
provider state before.

**403 vs 404 is deliberate.** A resource belonging to another partner returns **403, not
404**, so an id's existence is never confirmed; an ungranted service returns 403 rather
than 404 for the same reason. They also note the converse trap — don't read a 403 as proof
the thing exists.

**Live IP whitelisting fails closed.** Zero entries means every Live request is rejected.
Sandbox is open. That is the correct default and the opposite of a footgun.

**The sandbox can actually rehearse.** Deterministic outcomes keyed on magic MSISDNs, using
**MTN's own vocabulary** (`PAYER_NOT_FOUND`, `NOT_ENOUGH_FUNDS`, `SERVICE_UNAVAILABLE`), so
error handling written against it needs no rewrite for production:

| MSISDN | Outcome |
|---|---|
| `+237670000001` | succeeds on the first poll |
| `+237670000002` / `3` / `4` | PAYER/PAYEE_NOT_FOUND / NOT_ENOUGH_FUNDS / SERVICE_UNAVAILABLE |
| `+237670000005` | **never resolves** — for testing our own timeout handling |
| `+237670000006` | pending ~5 s then succeeds — realistic async, not instant-or-never |
| `+237670000007` / `8` | KYC only: active / inactive account |
| anything else | `400` — sandbox never reaches the real network |

Separate sandbox balance and daily limits, and callbacks can be re-fired on demand for an
already-resolved transaction. **Peexit's sandbox cannot produce a "paid" state at all**, so
we have never been able to rehearse a full settlement; this one can, including the two
cases that actually hurt (never resolves, resolves late).

**Webhook delivery is specified.** 10 s to return any 2xx; retries at 1 m, 5 m, 30 m, 2 h,
6 h, 24 h; dead-letter after the 7th with no alert (their words), manual redelivery, and
deliveries isolated from one another. `X-Signature` is HMAC-SHA256 over the raw body keyed
with a **separate** `callbackSecret` — correctly not the AppKey.

**The ledger is event-sourced double-entry**, and a money-out request that would take the
balance below zero is rejected *before it reaches a provider*.

## 3. What to ask before writing any adapter

1. **`amount` is typed `number / double`.** XAF has no subunit. A double is the wrong type
   for money and invites `4999.999999`; their own signing example uses an integer (`500`).
   Ask what happens to a non-integer XAF amount — reject, round, or truncate. We would
   always send integers (`isWholeXaf` already guards our side), but the answer decides
   whether their rounding can ever disagree with our ledger.
2. **Every request field is marked optional/nullable** in the reference
   (`partnerOrderId?`, `msisdn?`, `amount?`, `currency?`), which contradicts the prose. That
   is a generated-schema artifact; get the real required set in writing.
3. **No fees, no limits, anywhere.** Not a rate, not a cap, not a settlement time. CamPay at
   least publishes 2% / 1% on marketing pages. There is no commercial basis to compare this
   against CamPay's 1% withdrawal yet.
4. **No production host.** Staging only. When is Live, and on what hostname?
5. **The crypto quote looks unbound.** `GET /crypto/quote` returns `quote`, `avgPrice`,
   `slippage`, `exchangeRate` — and **no quote id and no expiry**. Nothing documented ties a
   quote to the `buy`/`sell` that follows, so the price quoted may not be the price dealt.
   Our own `/quotes` mint a binding id for exactly this reason. Ask how a quote is honoured.
6. **The AppKey is both identity and integrity.** They present this as a simplification
   ("no separate signing secret to manage"), and it is defensible, but one leaked key gives
   an attacker both halves. Their outbound `callbackSecret` *is* separate, so the asymmetry
   is a choice rather than an oversight — worth asking whether a distinct signing key is
   available for money-out.
7. **`callbackSecret` is optional**, and unsigned deliveries are allowed. We would always
   set one; our adapters fail closed on a live rail regardless.

## 4. How it would map to our interfaces

| Our seam | Wallet2Cash |
|---|---|
| `PayoutAdapter.disburse()` | `POST /momo/withdraw` (signed) |
| `PayoutAdapter.queryStatus()` | `GET /transactions/{orderId}` |
| `PayoutAdapter.balance()` | `GET /ledger/balance` (prefunded, per environment) |
| `PayoutAdapter.verifyCallback()` | `X-Signature`, HMAC-SHA256 over the raw body, `callbackSecret` |
| `PayoutAdapter.listPayouts?()` | `GET /partner/transactions` |
| `CollectAdapter.collect()` | `POST /momo/deposit` (unsigned) |
| identity `resolve()` | `GET /kyc/momo/{msisdn}` → `{ name, isActive }` |

**The KYC endpoint is better than CamPay's.** CamPay returns `full_name` alone; this
returns `{ name, isActive }`, and `isActive` maps straight onto the `accountStatus`
distinction our provider contract already models — a reachable-but-suspended wallet is
`INACTIVE`, which is an answer, not a name we failed to get. The sandbox even gives us a
number that resolves to a suspended account, which is the case nobody can otherwise test.

**The crypto leg overlaps IBEX**, and that is where I would not go. Routing both legs
through one vendor concentrates the whole payment in a counterparty who is in our business
and would then see our complete flow. Take the legs that beat what we have; keep the crypto
side on IBEX, where we control it.

## 5. Verdict

The best-engineered of the three vendors reviewed, and the only one whose sandbox could
actually rehearse a settlement end to end. But it is **staging-only with no published
commercial terms**, so it cannot be compared with CamPay's 1% on price, and nothing can be
decided until there is a Live host and a rate card.

Worth pursuing as: a **second KYC provider** (`{ name, isActive }` is a better answer than
`full_name`), and a **payout rail to evaluate against CamPay** once there are rates. Not
worth routing the crypto leg through.
