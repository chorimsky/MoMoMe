# MoMo›Me Connect — Architecture assessment (Phase 0, 2026-09-22)

Mandate: "Universal Payment & Lightning Enablement". Rule 44/45: inspect first, map EXISTS / PARTIAL /
MISSING / CONFLICT / REQUIRES REFACTOR, then the minimum safe sequence. This is that map.

## What the platform is today

TypeScript/Express monolith (`server/`), SQLite on a Railway volume in production (Postgres backend
tested), React/Vite web (`app/`), Expo mobile. Live money since 2026-09-03. Engine = `core/stateMachine.ts`
(QUOTED → AWAITING_INBOUND → … → DELIVERED / REFUNDED), double-entry journal `core/ledger.ts`, rails as
adapters (`adapters/index.ts` crypto in-rails: IBEX Lightning/on-chain/ERC-20 deposits, phoenixd;
`adapters/payouts.ts` fiat out-rails: Peexit, PawaPay, simulator), routing `core/routing.ts` +
`core/upi/routing.ts`, identity resolution `core/identityResolution/*`, UPI layer `core/upi/*`, network
layer `core/network/*` (cross-border corridors), API v1 platform `core/platform/*` + `publicApi/*`
(organizations, credentials, idempotency, webhooks, settlements, limits, reservations, sandbox).

## Map against the specification

| Spec concept | Status | Where | Note |
|---|---|---|---|
| §4 MPI (identity ≠ phone) | **PARTIAL / CONFLICT** | `core/identity.ts` (recipient identities keyed by phone digits), `core/merchantAccount.ts` (merchants, code), `core/platform/orgs.ts` (organizations), `core/deviceAccount.ts` (device = account) | Four identity families, all keyed by phone/device/org id. No single MPI with aliases. Conflict: phone digits ARE the key in `identity.ts` and merchants' Lightning address is derived from the phone. |
| §5 aliases + resolver | **PARTIAL** | `core/upi/identity.ts` classifies MSISDN/EMAIL/MOMOME_ADDRESS/LIGHTNING_ADDRESS/UMA/BANK/MERCHANT_ID; `core/identityResolution` resolves phone → operator name; merchant graph resolves codes | Resolves to destinations, not to a stable MPI. |
| §6 Payment Profile | **MISSING** | — | Pieces exist (merchant settlementPhone/feeMode, org plan/limits, identity claimed) but no profile object. |
| §7 Payment Surfaces on one intent | **PARTIAL / CONFLICT** | Merchant links `/pay/:code` (link, qr, invoice kinds), LNURL `/.well-known/lnurlp`, send flow, `/v1/payments`, interop intents `/api/v1/payment-intents`, UPI `/api/v2` | Each surface creates a V1 `Payment` directly; two intent models (interop, UPI) plus API v1 payments. Conflict = three intent-like objects. |
| §8 canonical Payment Intent | **PARTIAL** | `shared/upi.ts PaymentIntentV2` (owner, recipient, amount, quote, route, state), `core/interop/intents.ts` | Neither carries payee/payer MPIs, purpose, permitted methods, settlement requirements, callbacks. |
| §9/§10 method ≠ rail | **PARTIAL** | `Method` (LIGHTNING/ONCHAIN/USDT/USDC) is the funding method; `Rail` in UPI (LIGHTNING/STABLECOIN/MOBILE_MONEY/AGGREGATOR/HYBRID) | Mobile Money as a *payment method* exists only in `momoTransfer` (collection). "momo_me internal" method/rail does not exist. |
| §11 Settlement Profile | **MISSING** | merchant `settlementPhone` only | No currency/rail/destination/frequency/fallback profile. |
| §12 internal MoMo›Me rail (ledger transfer) | **MISSING** | ledger has `customer_wallet`, `org_balance:<id>` | No MPI balances, no internal transfer. |
| §13/14 Lightning enablement, IBEX as adapter | **EXISTS** (receive), **PARTIAL** (send) | `adapters/ibex.ts` behind `RailAdapter`; invoices/LNURL receive; `payInvoice` used only for refunds; `momoTransfer` pays Lightning addresses for out-of-corridor | Public API never mentions IBEX (good). No "lightning_send" payout product. |
| §15 Lightning Address | **EXISTS** | `routes/lnurl.ts`, `<number>@momome.xyz` | Keyed on phone (conflict with §4) — must resolve via MPI alias. |
| §16/17 stablecoins as liquidity, value abstraction | **EXISTS** | `core/upi/assets.ts`, custody model NONE_PASS_THROUGH, `Money` in UPI | Customer API is amount/currency already. |
| §18/19 routing engine | **PARTIAL** | `core/routing.ts` (payout rail choice), `core/upi/routing.ts` (rule-driven, shadow), `core/network/router` (corridors) | No "is recipient MoMo›Me-connected → internal route first" step; policy partly env-configured. |
| §20 payment vs settlement status | **PARTIAL** | Payment states + `core/platform/settlements.ts` (org settlements) | Settlement is per organization request, not per payment. |
| §21 ledger double-entry | **EXISTS** | `core/ledger.ts` | Add MPI accounts. |
| §22 treasury/liquidity | **EXISTS / PARTIAL** | `core/treasury.ts`, `floatPlan.ts`, `upi/liquidity.ts`, `platform/liquidity.ts` reservations | BTC/USDT positions reported via IBEX. |
| §23 quote engine | **EXISTS** | `buildQuote`, `/v1/quotes` | Route field absent from the quote. |
| §24/25 execution + idempotency | **EXISTS** | `createPaymentCore`, `platform/idempotency.ts` | |
| §26 webhooks | **EXISTS** | `core/interop/outbound.ts` + typed events | Add invoice.*, payout.*, identity.*, quote.*, liquidity.*. |
| §27 invoice engine | **PARTIAL** | `MerchantLink kind:"invoice"` (amount, label, client, due, paid) | Not first-class: no lifecycle, no payer MPI, no payment intent link, no API. |
| §28/29 payment link + checkout | **EXISTS (web)** / **MISSING (API)** | `/pay/:code` page = hosted checkout, method chosen from offered crypto methods | Methods: crypto only; no Mobile Money/bank/internal method on checkout. |
| §30/31 business integration model, scopes, users/apps/credentials | **EXISTS** | `core/platform/orgs.ts`, `credentials.ts` | Add `invoices:*`, `payouts:*`, `identity:*` scopes. |
| §32 counterparty | **MISSING** | `Recipient` snapshot on payments; merchant graph learns code↔phone | No counterparty object per organization. |
| §33 network discovery `/resolve` | **PARTIAL** | `/api/v2/identity/resolve` (flagged), `/api/v1/payment-addresses/resolve` | Privacy-preserving reachability answer for orgs missing. |
| §34 request-to-pay | **MISSING** | — | |
| §35 payment graph | **PARTIAL** | `core/network/*` markets/corridors; UPI destinations | Model exists in pieces; no MPI nodes. |
| §36 reconciliation | **EXISTS** | `interop/reconcile.ts`, `depositReconcile.ts`, `upi/ledger.ts`, `payoutReconcile` | Extend to settlements/payouts refs. |
| §37/38 security, compliance | **EXISTS** | credentials, step-up, compliance engine, limits, sanctions, STR | |
| §41 error model | **EXISTS** (`publicApi/errors.ts`) | | Add ROUTE_UNAVAILABLE, IDENTITY_NOT_FOUND, PAYMENT_METHOD_UNAVAILABLE. |
| §42/43 sandbox, DX | **EXISTS** | scenarios, dashboard, docs, SDKs | Extend scenarios to invoices/payouts/internal. |

## Conflicts that must be resolved (not rewritten — bridged)

1. **Identity keyed by phone.** `core/identity.ts`, merchant Lightning addresses and LNURL all key on the
   number. Resolution: introduce MPI as the canonical id with phone/code/email/Lightning-address as
   *aliases*; existing records become aliases of auto-created MPIs on first touch (lazy backfill). Nothing
   that works today changes its key; the MPI layer sits above.
2. **Three intent objects.** interop `PaymentIntent`, UPI `PaymentIntentV2`, API v1 `Payment` meta.
   Resolution: ONE canonical `PaymentIntent` in `core/connect/intents.ts` that every surface creates or
   references; it *executes* through the existing engine (mints a V1 Payment for external funding, or a
   ledger transfer for the internal route). The older intent routes keep working and are marked legacy.
3. **Settlement per organization request, not per payment.** Resolution: a `SettlementIntent` per
   completed intent that the payee's Settlement Profile drives; the org-level request stays for balances.

## Minimum safe sequence

Phase 1 domain (`core/connect/`): MPI + aliases + payment profile + settlement profile + counterparty +
canonical PaymentIntent + Invoice + SettlementIntent. Phase 2 surfaces: invoice / payment link / checkout
/ QR / request-to-pay all reference the intent; hosted checkout page reads it. Phase 3 resolver:
`POST /v1/resolve` privacy-preserving. Phase 4 routing policy: `internal → direct rail → lightning →
stablecoin-assisted → fallback`, configurable, explainable, internal ledger route implemented. Phase 5
Lightning: `lightning_send` payout via the existing outbound rail; Lightning Address via MPI alias.
Phase 6–7: settlement intents per payment, treasury view extended. Phase 8: institutional API on `/v1`
(identities, invoices, checkout, payouts, resolve, settlement profiles). Phase 9: sandbox scenarios,
docs, SDK. Phase 10: graph/metrics. Each phase additive, tested, deployable dark.

## Implemented (2026-09-22, first increment)

`server/src/core/connect/`: `identities.ts` (MPI + aliases + payment/settlement profiles; lazy bridges
`mpiForOrganization`, `mpiForPhone`, `mpiForMerchant`), `counterparties.ts`, `intents.ts` (canonical
Payment Intent, payment vs settlement status, execution = internal ledger | external engine payment |
Mobile Money collection), `invoices.ts` (invoice / payment link / QR / request-to-pay on one intent;
partial payments explicitly unsupported), `payouts.ts` (balance → Mobile Money rail or Lightning
Address via the provider adapter; compensating entry on failure), `routing.ts` (configurable,
explainable policy `CONNECT_ROUTE_POLICY`), `ledger.ts` (MPI balances on the existing journal),
`hooks.ts` (engine transition → intent → invoice; tick). Surface: `publicApi/connect.ts` on `/v1`
(identities, resolve, counterparties, payment-intents, invoices, requests, payouts, public checkout,
sandbox credit); hosted checkout page `app/src/pages/Checkout.tsx` at `/p/:intent`. Events added to
the webhook vocabulary. Tests: `server/test/connect.test.ts` — the nine §46 flows + identity, resolve,
routing policy, idempotency, webhooks (40 assertions).

Honest limits of this increment: external funding settles to the payee's Mobile Money destination
(a payee with only a MoMo›Me-balance settlement gets `route_unavailable` for external funding — the
balance is credited on the internal route); bank settlement is recorded, not executed; Mobile Money as a
payment method requires the operator switch `features.momoTransfer`; Lightning send in production
requires the IBEX outbound rail; stablecoin settlement is refused by design (pass-through). The
older interop (`/api/v1/payment-intents`) and UPI (`/api/v2`) intent models keep working and are now
documented as legacy behind the canonical intent.

## Second increment (2026-09-22): settlement intents, treasury, network metrics

- `core/connect/settlements.ts` — one **settlement intent per completed payment**, driven by the payee's
  Settlement Profile: `momo_me` settled on the balance; `mobile_money` / `lightning` executed as a
  fee-free payout from the balance (instant, or batched daily/weekly by the profile, `manual` waits for
  the operator); `bank_transfer` queued for the operator in Admin → API Platform → **Connect network**:
  "Paid from treasury…" records the bank reference (ledger: balance → float), "Confirm settled" closes
  it; fail before confirmation returns the value. The payment intent's `settlement_status` mirrors the
  settlement intent. Externally funded payments get a `settled` intent for the audit trail.
  API: `GET /v1/settlement-intents`, `GET /v1/settlement-intents/{id}`; events `settlement.*`.
- `core/connect/metrics.ts` — **treasury over MPI balances** (liabilities vs float, coverage, pending
  settlements, largest balances) and the **§49 network metrics** (connected institutions/businesses,
  identities, reachable external endpoints, successful routes by kind, internal %, Lightning volume,
  external settlement volume, average latency, average routing cost). Admin tab + dashboard Settlements
  tab. Tests: connect.test.ts 54.
