# CamPay — what is built, and what the operator must still do

Built 2026-10-21. Three surfaces, all **dark until `CAMPAY_PERMANENT_TOKEN` is set**: with
no token `campayConfigured()` is false, the payout rail is not registered, the collection
rail only simulates, and the identity provider is skipped.

## What exists

| Surface | Code | CamPay |
|---|---|---|
| payout rail `campay` (priority 5) | `adapters/payouts.ts` | `POST /withdraw/` |
| collection rail `campay` (priority 20) | `adapters/collect.ts` | `POST /collect/` |
| identity provider `campay_holder` | `identityResolution/providers/campay.ts` | `GET /holder_info/` |
| authoritative status, both directions | `adapters/campay.ts` | `GET /transaction/{ref}/` |
| per-carrier float | `adapters/campay.ts` | `GET /balance/` |
| one callback URL, both directions | `routes/webhooks.ts` → `POST /webhooks/campay` | `endpoint: collect\|withdraw` |

51 assertions in `server/test/campay.test.ts`, wired into `pnpm test`.

## Decisions worth knowing

**Priorities run in opposite directions on the two legs, deliberately.** CamPay's published
payout fee (1%) is *cheaper* than Peexit's; its collection fee (2%) is *dearer*. So it sits
ahead of PawaPay but behind Peexit on payouts (priority 5), and behind Peexit on
collections (priority 20). Once it has settled real volume, promoting it to payout priority
0 is a one-line change — and worth about 0.5% of every transfer.

**`external_reference` is a deterministic UUID4** derived from our payment ref via
`payoutIdFor()` — the same trick PawaPay needed. CamPay demands a UUID4 and our refs are
not; deriving it from the ref keeps a retry idempotent rather than minting a second payout.

**Nothing scales by 100.** CamPay refuses decimals (`ER201`) and XAF has no subunit, so
`5000` means 5,000 XAF end to end. (Payfonte's docs say `amount = major × 100` for every
currency and never mention XAF — that ambiguity is still open with them, and is the reason
no Payfonte adapter has been written yet.)

**The status is never read from a callback.** The callback says something changed;
`GET /transaction/{ref}/` says what it changed to. Same discipline as every other rail here.

**The JWT is pinned to HS256.** A token claiming `alg: none` is refused — otherwise anyone
who learns the callback URL can settle a payout.

**`ER301` is reported as a funding problem**, naming the carrier, because the fix (top up
that operator's float) is nothing like the fix for a malformed payout.

## What the operator must provision

1. **Rotate the credentials that were pasted into a chat window on 2026-10-21** — app id,
   app username, app password, permanent access token and webhook key. All five are burned.
2. **Set on Railway** (never in a file, never in chat):
   - `CAMPAY_PERMANENT_TOKEN` — APP KEYS → permanent access token
   - `CAMPAY_WEBHOOK_KEY` — APP KEYS → webhook key (a *different* secret)
   - `CAMPAY_ENV=production` when going live; unset/anything else uses the demo host
   - `CAMPAY_API_URL` only if the production base differs from `https://www.campay.net/api`
3. **In the CamPay dashboard:** set the callback URL to
   `https://<api-host>/webhooks/campay`, and set its method to **POST** (CamPay can send
   GET; this route only accepts POST).
4. **Enable API withdrawals** — "Withdrawals through the API must be allowed under your
   application settings". Without it every payout is refused.
5. **Fund the float, per carrier.** Withdrawals debit a prefunded balance and `ER301` is
   per operator, so MTN and Orange need funding separately. Money in the wrong bucket is
   stranded while the other queue waits.

## Still unanswered by CamPay

- **The idempotency contradiction.** `/withdraw/` says both "you will get the results of
  the first request" and "a request with a duplicate UUID will be rejected". We send a
  stable UUID either way, but which behaviour is real decides whether a retry after a
  timeout is safe or needs a status check first.
- **Is `holder_info` charged per lookup?** We would call it on every send.
- **The production base URL** is not in the Postman collection. `www.campay.net/api` is the
  assumption; confirm before go-live.
- **The real mass-payout rate.** A third-party guide quotes 1.5% MTN / 1% Orange, which
  would be worse than the headline 1%.
- **`/balance/` field spellings** are not documented. The adapter accepts every observed
  spelling and returns `null` for anything else — never 0, because an unread rail is not a
  rail with no money. Confirm the real names against a live account.
