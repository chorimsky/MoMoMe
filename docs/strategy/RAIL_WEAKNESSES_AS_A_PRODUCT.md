# Selling the layer, not the rail

**Written:** 2026-10-22 · Every weakness below was hit first-hand while integrating, not
collected from marketing pages.

---

## 1. Six providers, five weaknesses, and nobody is strong in all five

|  | Peexit | CamPay | Payfonte | Wallet2Cash | MTN direct | Orange direct |
|---|---|---|---|---|---|---|
| **Who owns this number** | died mid-integration (NXDOMAIN) | a name, no status | **no name field at all** | name + isActive | name + /active | **no API exists** |
| **Idempotency** | track_id | docs contradict themselves | **undocumented** | unique DB constraint | X-Reference-Id (UUID) | order_id |
| **Status truth** | — | terminal states clear | **never lists them** | "never guesses when unsure" | — | — |
| **Sandbox = production** | **cannot produce "paid"** | usable | usable | best of any | EUR-only, wrong host documented | different path AND currency |
| **Money units** | whole XAF | integers, refuses decimals | **×100 on a zero-decimal currency** | `double` | string | integer |

Each of those cost real debugging. Three would have cost money:

- Orange's `pay_token` lived only in memory, so every in-flight collection became
  permanently unreadable at the next deploy — the customer pays on Orange's page and we
  never learn of it.
- MTN's production base URL was the developer **portal**, which resolves to the same address
  as the sandbox. The first live collection would have been posted to a documentation site.
- MTN's token request set `content-length` by hand, which undici rejects, so that rail could
  never obtain a token at all. It would have failed the first time it was ever used.

A company integrating directly meets all five — and meets them **in production, with
money**. We met them in a week, with tests.

## 2. The asset is the normalisation, not the connections

Anyone can sign a contract with CamPay. What takes a year to learn is what each provider
lies about, and in which direction. What we enforce across every rail:

- **Unknown is never zero, and never healthy.** An unreadable balance is `null`, not
  "broke". Zero samples is no success rate, not 100 %. Not-yet-called is `UNKNOWN`, not
  `OPERATIONAL`. Each of those was a real report that said the opposite.
- **Only an authoritative re-query settles money.** A callback is a hint that something
  changed, never proof of what it changed to — regardless of how well it is signed.
- **Idempotency normalised per vendor.** A derived UUID4 where one is demanded, our own key
  where it is not, deterministic either way, so a retry can never become a second payout.
- **Cost measured, not modelled** — read off the provider's own settled row.
- **Verification invented where the vendor offers none.** MTN signs nothing, so the callback
  URL itself became the credential.
- **Health that steers routing**, on both legs, with "prefer, not exclude" so one bad probe
  cannot stop the business.

That list is the product. It is also, precisely, the list a buyer does not know they need
until their first bad week.

## 3. Where to point it

**Identity first.** "Who owns this number" in CEMAC is acute, poorly served, and a
one-endpoint integration for the buyer — the lowest-commitment thing we can sell. A
federated chain beats every individual source: Peexit's died, Payfonte has no name field,
Orange has no API, CamPay has a name but no status, Wallet2Cash and MTN have both. Already
live at `POST /v1/recipients/validate`, now returning the account's real standing, which
provider answered, whether it was live or cached, and a request id.

Crucially its value **does not depend on our uptime being better than a bank's** — a failed
lookup costs a retry, not a payment. That makes it the honest thing to sell first.

**Settlement second.** One API across crypto-in and Mobile-Money-out with failover the buyer
does not build. Higher value, longer sale, and it puts our reliability on the contract.

**Compliance as the moat.** The hash-chained CEMAC engine (STR/CTR, tamper-evident) is what
a competitor cannot retrofit in a quarter, and what any regulated buyer needs anyway.

## 4. What is not true yet

**We have fewer working rails than the pitch implies.** Today: IBEX live, Peexit dead,
CamPay configured but tokenless, MTN and Orange unconfigured, Payfonte and Wallet2Cash
without credentials. Multi-rail failover with one live rail is a design, not a product.

**We would be selling reliability from a single SQLite volume**, on a platform that blocked
our own deploys for two days this week. And aggregating means *owning* everyone's outages
contractually: today a Peexit NXDOMAIN is a bad afternoon; under an SLA it is a liability.

**Regulatory standing is unresolved.** Reselling settlement in CEMAC is not a thing to do on
someone else's licence by assumption.

## 5. The sequence

1. **Provision the redundancy before selling it** — CamPay's token, MTN and Orange
   credentials. Three live rails on Cameroon makes the failover story true rather than
   designed, and it is days of work, not months.
2. **Sell identity**, because it is already live and its value survives our own bad days.
3. **Fix our own single point of failure** before any settlement SLA is signed.
4. **Settle the licensing question** before the first contract, not after.

The order matters. Every step before the one after it is a thing we would otherwise have to
explain to a customer instead of to ourselves.
