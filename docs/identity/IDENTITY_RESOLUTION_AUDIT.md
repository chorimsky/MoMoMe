# Identity Resolution — Phase 0 audit

Audit of the MoMo›Me production codebase before any identity-resolution code was written
(2026-09-20). Nothing in this document changes behaviour.

## 1. Existing architecture

| Layer | What is there |
|---|---|
| Frontend (web) | `app/` React/Vite SPA on Vercel. Send flow `app/src/pages/send/{SendApp,steps,MomoStep}.tsx`; recipient form = `DetailsStep` in `steps.tsx`; recipient name trust badge from `api.resolveRecipient()` (`GET /api/recipients/resolve`). |
| Frontend (mobile) | `mobile/` Expo SDK 54. Send tab `mobile/src/app/(tabs)/index.tsx`; the same `resolveRecipient` call (`mobile/src/api/client.ts:228`). |
| Backend | `server/` Express on Railway (one container, SQLite volume; Postgres store available by env). Routes: `server/src/routes/api.ts` (`/api/*`, the V1 surface), `v1.ts` (`/api/v1` interoperability), `network.ts` (`/api/network`, Pan-African layer), `capital.ts`, `webhooks.ts`, `cron.ts`. |
| API structure | Device-authenticated customer routes (`ownerOf()` — enrolled P-256 signature per request, partner `mk_` API keys), admin routes under `/api/admin/*` (HMAC session token, role → section map in `shared/roles.ts`). |
| Database | `server/src/db/{store,repo,schema}.ts`: memory + key→JSON snapshots on SQLite (live), per-row tables on Postgres (payments, ledger, compliance chain, momo ops, network). Types in `shared/types.ts`. |
| Authentication | `routes/api.ts` `ownerOf`/`senderOf`/`verifyDeviceSig`; `core/adminAuth.ts`; `core/apiKeys.ts`; step-up elevation for money-moving admin actions. |
| Payment lifecycle | `core/stateMachine.ts`: quote → `createPayment` → AWAITING_INBOUND → INBOUND_DETECTED/CONFIRMED → PAYOUT_REQUESTED → PAYOUT_CONFIRMED → DELIVERED (or FAILED / REFUND_* / MANUAL_REVIEW). Payout rail chosen by `core/routing.ts` (balance- and cost-aware). |
| Recipient handling | `Recipient { phone, country, provider, name, nameSource }` on the quote/payment; `shared/domain.ts` `checkPhone()` / `detectProvider()` (Cameroon prefix table: 67x/650-654/680-684 MTN, 69x/655-659/685-689 Orange); `core/nameResolver.ts` (`registeredName`, `resolveRecipient`); `core/identity.ts` (the learned identity graph: names a payout actually landed under); `core/recipientRisk.ts` (wrong-person / near-duplicate warnings, risk token); `core/nameResolver` trust levels 1 provider / 2 internal / 3 unknown. |

## 2. Existing provider integrations

| Provider | Country | Currency | Collection | Payout | Recipient verification | Account lookup | API auth | Webhooks | Implementation | Production status |
|---|---|---|---|---|---|---|---|---|---|---|
| PawaPay (aggregator) | CM (v1 payouts); KE/GH/NG/SN/CI/GA/CG/TD in the network layer | XAF (+ network currencies) | v2 deposits (network only) | v2 payouts | **none** — `adapters/pawapay.ts lookupName()` is a SANDBOX fabrication and returns `null` whenever any real rail is live | none over the API; `POST /v2/predict-provider` predicts the operator for an MSISDN (no name) | Bearer API key | v2 callbacks (signature verification not implemented; the poll is authoritative) | `adapters/pawapay.ts`, `core/network/pawapayMarkets.ts` | LIVE for CM payouts |
| Peexit (aggregator) | CM | XAF | collect (MoMo→MoMo transfers, admin ops) | payouts | none | none | SECRETKEY, IP-allowlisted (egress proxy) | callback + statement polling | `adapters/peexit.ts` | LIVE for CM payouts |
| MTN MoMo (direct) | — | — | — | — | — | — | — | — | **no direct MTN Open API integration exists** | not integrated |
| Orange Money (direct) | — | — | — | — | — | — | — | — | **no direct Orange integration exists** | not integrated |
| IBEX Hub | crypto in/out | BTC/USDT/USDC | Lightning/on-chain/ERC-20 receive | Lightning Address pay (network partners) | n/a | n/a | OAuth2 | account webhook | `adapters/ibex.ts` | LIVE |

**Consequence:** in production there is **no authorized identity source today**. The "provider-verified" trust level exists in code but is only ever reached in the sandbox. Real senders see "unknown — confirm the name" and type the name themselves; the identity graph then learns it from delivered payouts.

## 3. Existing files

| Concern | Files |
|---|---|
| MTN / Orange | no direct adapters; operator detection `shared/domain.ts` (`detectProvider`, `checkPhone`, `PROVIDERS`); payout routing per operator `core/routing.ts` |
| Transactions / payments | `core/stateMachine.ts`, `routes/api.ts` (`createPaymentCore`, `/quotes`, `/payments/*`), `shared/types.ts` (`Payment`, `Quote`, `Recipient`) |
| Recipients | `core/nameResolver.ts`, `core/identity.ts`, `core/recipientRisk.ts`, `routes/api.ts` `/recipients/resolve`, `/me/recipients` |
| Invoices | `adapters/ibex.ts` (invoice/address creation), `core/lnurl.ts`, `routes/lnurl.ts` |
| Webhooks | `routes/webhooks.ts` (peexit, pawapay, ibex, whatsapp, peex) |
| User accounts | `core/deviceAccount.ts`, `core/account.ts`, `core/vault.ts` (device = account) |
| Logging / errors | console + Railway logs; `core/errorSink.ts` (Sentry when configured); `core/notifications.ts` outbox; `core/alerts.ts` paging; `app.ts` error handler |
| Tests | `server/test/*.ts` (80 suites in `pnpm test`), incl. `name-match`, `wrong-person`, `phone-matching`, `merchant-flow`, `network`, `ops-readiness` |
| Deployment | Railway (`railway.json`), `.github/workflows/{ci,deploy,mobile}.yml`, `scripts/deploy-gate.sh`, `docs/OPERATIONS.md` |

## 4. Risk analysis

| Change | Risk | Why |
|---|---|---|
| New module `core/identityResolution/*` + `shared/identity.ts` | LOW | additive, no existing import touched |
| New router `/api/v2/identity/*` mounted before `/api` | LOW | 404 unless `IDENTITY_RESOLUTION_ENABLED=true`; own auth + rate limit |
| Optional `recipientIdentity` snapshot on `Payment` / `NetworkIntent` | LOW | optional field; written only at creation when the flag is on; never read by the money path |
| `/config.identity` block | LOW | additive field |
| Frontend recipient verification states (web, mobile) | MEDIUM | new UI states in the existing form; V1 `resolveRecipient` badge stays; the flag decides whether V2 is called |
| MTN direct provider adapter | MEDIUM | new outbound credential set; unconfigured = never called |
| Touching `createPaymentCore` | MEDIUM | one guarded, try/catch-wrapped attach step; a throw or a slow provider cannot block creation (cache/store lookup only, no provider call on the money path) |
| Anything that makes V1 payment execution depend on identity | CRITICAL | **not done** — identity is advisory; the gate is a later decision behind a second flag |

## 5. Compatibility plan

- V1 path (`/api/recipients/resolve` → `resolveRecipient`, trust levels, wrong-person checks) is untouched and keeps serving both clients.
- V2 is a separate module and router. With `IDENTITY_RESOLUTION_ENABLED` unset/false the router answers 404, `/config.identity.enabled` is false, clients never call it, `createPaymentCore` never attaches a snapshot. Turning the flag off restores exactly the previous behaviour with no data change.
- The only shared vocabulary is `Recipient.country/provider` (V1) ↔ `IdentityResolution.country/operator` (V2); V2 derives its operator from the same `detectProvider` prefix table so the two can never disagree in Cameroon.
- The sandbox identity provider is compiled in but refuses to run when any real rail is live (`liveMoney()`), the same rule that already guards `pawapay.lookupName`.
- No provider call is ever made on the payment-creation path; V2 attaches only what a prior `/resolve` in the same purpose context produced (cache/store), so an identity outage cannot corrupt or delay a payment.

## Addendum 2026-09-20 — rail API review for a real name source
- **pawaPay**: no account-holder-name endpoint anywhere in v1 or v2 (payouts, deposits, refunds, callbacks, `predict-provider`, `active-configuration` reviewed). It can only predict the operator. `adapters/pawapay.lookupName` is, and remains, a sandbox fabrication (null under live money).
- **Peexit**: `POST /clients/verify-wallet` (`SECRETKEY`, `{ countryCode, accountNumber }`) returns `{ isValid, accountName, operator, status }`, 404 when the account does not exist on the network, 422 for an unsupported country. This is an authoritative identity source for Cameroon MTN + Orange with credentials we already hold → implemented as provider `peexit_verify`.
