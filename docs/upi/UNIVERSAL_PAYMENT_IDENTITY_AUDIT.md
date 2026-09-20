# Universal Payment Identity — Phase 0 audit (2026-09-20)

What the repository already is, before a line of the UPI layer was written. Read beside
`docs/interop-v2/CURRENT_ARCHITECTURE.md` (the network layer) and `docs/identity/IDENTITY_RESOLUTION_AUDIT.md`.

## Frontend (web `app/`, Expo `mobile/`)
| area | where | state |
|---|---|---|
| recipient input | `app/src/pages/send/steps.tsx` DetailsStep · `mobile/src/app/(tabs)/index.tsx` | number typed/pasted/contact/QR; `checkPhone` per keystroke; lookup only on a complete number; registered name + confirmation tick (Identity v2) |
| payment UI | Method step (`previewMethods` — live amounts for LIGHTNING/USDT/USDC), Review, Pay (invoice QR / ERC-20 URI) | the blueprint's "Pay with: Lightning ≈ … USDT ≈ …" **already exists** on the Method step, from the live rate |
| invoice UI | Pay step: BOLT11 QR + copy, `lightning:` URI; ERC-20 `ethereum:` URI | whole-sat, uppercase QR (wallet-payload rules) |
| history / status | Activity page; `/payments/:id` polling; push/SMS | V1 `PaymentState` → `displayStatus` |
| error handling | `errMessage()` i18n; 409 `confirm_recipient` (name mismatch / near-miss) with risk token; 409 `recipient_unverified` (identity gate) | EN/FR |

## Backend (`server/`)
| area | where |
|---|---|
| API | Express; `/api` (V1), `/api/v1` (partner interop), `/api/network` (cross-border), `/api/v2/identity` (identity v2), **new** `/api/v2` (UPI) |
| auth | device = account: P-256 per-request signature over `METHOD\npath\nts\nbodyhash`; partner API keys; admin HMAC session tokens with roles/sections |
| payments | `routes/api.ts` `buildQuote` + `createPaymentCore`; `core/stateMachine.ts` (QUOTED → AWAITING_INBOUND → INBOUND_DETECTED → INBOUND_CONFIRMED → FX_LOCKED → PAYOUT_REQUESTED → PAYOUT_CONFIRMED → DELIVERED; FAILED / REFUND_* / MANUAL_REVIEW) |
| Lightning | `adapters/index.ts` rail registry (IBEX Hub priority 0, phoenixd, sandbox), `createInstruction`, webhooks + polling; `routes/lnurl.ts` LUD-06/16 |
| Mobile Money | `adapters/payouts.ts` (Peexit primary, PawaPay) with balance-aware routing `core/routing.ts`; collections (Peexit); `core/momoOps.ts`; `core/network/pawapayMarkets.ts` (multi-market) |
| DB | `core/persist.ts` snapshot collections (SQLite in production; Postgres per-row for network); `db/store.ts` |
| queues/jobs | `jobs.ts` reconcile tick (30 s): rail polling, expiry, refunds, alerts, FX, identity prune, **chain tick** |
| webhooks | `routes/webhooks.ts`: IBEX, PawaPay, Peexit (basic auth), WhatsApp; verified, deduplicated, authoritative re-query |
| reconciliation | `core/depositReconcile.ts` (stablecoin by tx hash), payout reconcile, `core/network/shadow.ts reconcile()`, ledger invariants tests |
| logging | console + Sentry sink; hash-chained compliance audit; identity audit rows |

## Lightning
IBEX Hub (custodial, OAuth2) is the node/provider; phoenixd optional (LUD-06 description_hash); invoices minted per payment (disposable); Lightning Address `<digits>@momome.xyz`; detection by webhook + poll; wallet model = custodial IBEX account per currency.

## Mobile Money
MTN + Orange Cameroon through Peexit (disburse/collect/verify_wallet) and PawaPay (payout); balances read from the rails; webhooks + authoritative status re-query; reconciliation of payouts against statements.

## Stablecoins — what actually exists
- **USDT / USDC on Ethereum only**, as *deposits* into IBEX accounts (`adapters/ibex.ts`), reconciled by tx hash through a public RPC receipt reader (`core/erc20.ts`, `core/depositReconcile.ts`).
- **Custody: THIRD_PARTY_CUSTODIAL (IBEX).** No private keys anywhere in this codebase, no signer, no RPC broadcaster.
- Outbound stablecoin: only the admin treasury sweep through IBEX (Super Admin, gated).
- No TRON / Base / Solana infrastructure, no swap venue, no on-chain monitoring beyond receipts.
→ Stablecoin **settlement** stops at the abstraction (Phase 12); Phase 13 "first real network adapter" is **blocked** on a custody decision (STABLECOIN_CUSTODY_MODEL.md).

## Already present vs the blueprint
| blueprint | present before this work | added now |
|---|---|---|
| PhoneNumberNormalizer | `identityResolution/msisdn.ts` (libphonenumber-js) + `shared/domain phoneDigits` | used as-is |
| Identity resolution | `/api/v2/identity` (Peexit verify_wallet live) | `core/upi/identity.ts` PaymentIdentityResolver on top |
| Lightning Address | LUD-06/16, admin-managed metadata, masked names | preserved; `getDestinations` lists it as a destination |
| Liquidity, routing, saga, shadow, canary, corridors | `core/network/*`, `settings.network` | facades + deterministic rule + env corridor flags |
| Quote engine | V1 `buildQuote` / `previewMethods`; network `discover` | `core/upi/quote.ts` multi-asset options with separate fee lines |
| Ledger / reconciliation | V1 ledger, network ledger, reconcile jobs | correlation ids + `reconcileIntent` |
| Provider capability / health | rail health trackers, identity capability table | `core/upi/capabilities.ts` registry with HEALTHY/DEGRADED/UNAVAILABLE/MAINTENANCE |
| Stablecoin lifecycle / monitor | deposit reconcile | `core/upi/chain.ts` states + Ethereum monitor + RECONCILIATION_REQUIRED |
