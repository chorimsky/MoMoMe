# CamPay — implementation review and profitability

**Written:** 2026-10-21 · **Source:** the published Postman collection
(`documenter.gw.postman.com/api/collections/2391374/T1LV8PVA`), read in full ·
**Our numbers:** `shared/domain.ts`, `server/src/core/settings.ts`

> **Credentials:** the app id, app username, app password, permanent access token and
> webhook key for this account were pasted into a chat window on 2026-10-21. All five are
> compromised and must be rotated in the CamPay dashboard. Replacements belong in Railway
> variables, never in a file in this repository.

---

## 1. The headline: `holder_info` is the verifier we lost

```
GET /api/holder_info/?phone_number=237XXXXXXXX
  200 → { "full_name": "JOHN DOE" }
  404 → { "message": "No name found" }
```

That is an authoritative name lookup for a Cameroonian Mobile Money number, as a single GET
with one query parameter. It maps straight onto our identity-provider contract with no
interpretation required:

| CamPay | our `IdentityResolution` |
|---|---|
| `200` with `full_name` | `VERIFIED`, `displayName` = the name |
| `404 "No name found"` | `NOT_FOUND` / `IDENTITY_NOT_FOUND` |
| `200` without `full_name` | `UNKNOWN` — never a fabricated name |

This matters more than the pricing. `peexit_verify` is dead (its host is NXDOMAIN), and
Payfonte's `transfer-recipients/validate` has **no name field** in its documented schema —
only `accountLabel`, a display string. CamPay returns a structured `full_name`. Of the three,
it is the only one that can actually restore recipient verification, which today is off:
every sender is told the recipient "can't be verified yet" and pays unchecked.

**Unpriced.** The docs say nothing about whether `holder_info` is charged per lookup. We
would call it on every send, so this must be settled before it is wired in.

## 2. The rest of the surface, and how well it fits

| Endpoint | Our seam |
|---|---|
| `POST /api/withdraw/` | `PayoutAdapter.disburse()` |
| `GET /api/transaction/{reference}/` | `PayoutAdapter.queryStatus()` |
| `GET /api/balance/` (per carrier) | `PayoutAdapter.balance()` |
| callback JWT, HS256, app webhook key | `PayoutAdapter.verifyCallback()` |
| `POST /api/collect/` | `CollectAdapter.collect()` |
| `GET /api/holder_info/` | identity provider `resolve()` |
| `POST /api/mass_payout/` + status | bulk payouts (Treasury, merchant settlement) |

Four things it does **better than Payfonte**, and they are not cosmetic:

1. **No amount ambiguity.** "Decimal numbers are NOT allowed. The amount can be sent as
   integer or string" (error `ER201`). XAF is zero-decimal and CamPay is XAF-native, so
   `5000` means 5,000 XAF. Payfonte documents `amount = major × 100` for every currency and
   never mentions XAF — a 100× risk we still have outstanding with them.
2. **Idempotency is documented.** "If you make the first request with a particular
   `external_reference` … you will get the results of the first request." That is exactly our
   `disburse()` contract (idempotent on `idempotencyKey`). Payfonte documents none.
3. **Terminal statuses are stated**: `PENDING` → `SUCCESSFUL` | `FAILED`. Payfonte's webhook
   guide says to finalise "only for terminal statuses" and never lists them.
4. **The fee comes back per transaction.** The callback carries `app_amount` — 98 against an
   `amount` of 100, i.e. the 2% collection fee netted off. That feeds
   `railCostSource: "invoice"` the same way `railCosts.ts` already reads Peexit's settled fee,
   so margin reporting stays real rather than modelled.

**One contradiction to resolve.** The same `/withdraw/` page says both "you will get the
results of the first request" *and* "a request with a duplicate UUID will be rejected". Those
are opposite behaviours on the retry path that matters most. Get it in writing, then pin it
with a test.

## 3. Profitability

Our gross take is **4.00%** (FEE_PCT 2.5% + Lightning spread 150 bps). Published CamPay rates
are **2% on collections, 1% on withdrawals**.

### A. Crypto in → Mobile Money out — the actual product

| Payout rail | Cost | Margin |
|---|---|---|
| our modelled assumption (1.5%) | 1.60% | +2.40% |
| Payfonte launch rate (1.5%) | 1.60% | +2.40% |
| Payfonte 1.3% tier | 1.40% | +2.60% |
| **CamPay withdrawal (1.0%)** | **1.10%** | **+2.90%** |

Per 5,000 XAF transfer: revenue 200 XAF, cost falls from 80 to 55, **gross profit rises from
120 to 145 XAF — up 20.8%**. The payout leg is the single largest cost in the business, and
this is half a point off it.

At volume, the 0.5-point saving alone:

| Monthly volume | Saving |
|---|---|
| $25,000 (14.5M XAF) | 72,000 XAF/mo (~$125) |
| $100,000 (57.9M XAF) | 289,000 XAF/mo (~$500) |
| $1,000,000 (578.7M XAF) | 2,893,000 XAF/mo (~$5,000) |

And unlike Payfonte there is **no FX trap**: CamPay is a domestic XAF rail and does no
conversion, so the 4–7% foreign-funding spread that makes Payfonte loss-making on
crypto-funded flows simply does not arise.

### B. Mobile Money in → Mobile Money out — marginal

Both legs on CamPay costs 2% + 1% = **3.00% against a 4.00% take: +1.00% margin.** That is
identical to our 1.5%/1.5% assumption and it is thin. CamPay's 2% collection is *dearer* than
our assumed collection cost (`collectFeePct` 0.015).

So the shape of the opportunity is lopsided, and worth stating plainly: **CamPay makes the
crypto-funded direction materially more profitable and leaves the MoMo→MoMo corridor
marginal.** Price the Interop v2 corridor on its own merits; do not assume this rate card
rescues it.

## 4. What it costs that the rate card does not show

**Prefunded float, per carrier.** `ER301` is "Insufficient balance … for the specific
carrier", and `/balance/` reports per operator. Withdrawals draw on an XAF balance we must
fund in advance, in two buckets (MTN and Orange). That is idle working capital, and
mis-splitting it strands money in the wrong bucket while payouts to the other queue. Our
balance-aware routing and `insufficient_rail_balance` handling already cover the mechanics;
the treasury cost is real and belongs in the comparison.

**Cameroon only.** `ER102`: "only MTN and Orange phone numbers are accepted". One country,
two operators, XAF. This is a depth play on the home market, not breadth.

**The rates are marketing pages, not a contract.** 2%/1% comes from CamPay's own site and
third-party reviews; the API docs carry no fee schedule. A third-party guide also quotes mass
payout at 1.5% MTN / 1% Orange, which would be worse than the headline 1% on MTN. Get a
signed schedule covering withdrawal, mass payout, `holder_info` and any volume tiers.

**Settlement claims conflict.** Their homepage says next business day; their blog says
one second. Unresolved.

## 5. Verdict

Take it, for Cameroon, as **the payout rail and the identity provider** — and treat those as
two separate wins:

- 1% withdrawal against a 1.5% assumption is the cheapest payout rate on the table and lifts
  gross profit per transfer by about a fifth.
- `holder_info` is the only one of the three candidates that returns a real name, and it ends
  the verification outage.

It does **not** replace Payfonte, and the two are not competing. CamPay is depth in Cameroon;
Payfonte is breadth across 32 markets and GIMACPAY across CEMAC. The sensible shape is CamPay
primary on Cameroon with Payfonte as the second rail and the route out of the country —
which is exactly what the `priority` + balance-aware + `railHealth` failover already expresses.

Settle before any live money: the idempotency contradiction, the price of `holder_info`, the
real mass-payout rate, and a written fee schedule.
