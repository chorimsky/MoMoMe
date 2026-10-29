# Evidence register — MoMo›Me × Sorted Wallet partnership deck

**Compiled:** 28 October 2026, by reading the repository and querying production, not from
memory or prior descriptions. Every claim the deck makes must appear here with a
classification and a source. If it is not here, it does not go on a slide.

**Classification**
- **Verified** — established directly by source, test, or a live production response.
- **Partially verified** — implemented, but completeness or production-readiness is uncertain.
- **Reported** — stated in project documentation, not independently confirmed.
- **Proposed** — a future capability or direction. Never presented as existing.
- **Unknown** — insufficient evidence.

---

## 1. Platform and architecture

| # | Claim | Class | Source |
|---|---|---|---|
| 1.1 | Public partner API is a versioned `/v1` surface with 17 endpoints | **Verified** | `server/src/routes/v1.ts` — counted |
| 1.2 | Endpoints cover intent → routes → execute → status, plus webhooks, reconciliation, observability | **Verified** | `v1.ts` route list |
| 1.3 | Payout rails are a registry (`PayoutAdapter`), not hardcoded calls | **Verified** | `server/src/adapters/payouts.ts:154` — `PAYOUTS = [peexit, campay, pawapay]` |
| 1.4 | Collection rails are a parallel registry | **Verified** | `server/src/adapters/collect.ts:208` — `COLLECTORS = [mtn, orange, peexit, campay]` |
| 1.5 | Crypto inbound rails are a third registry | **Verified** | `server/src/adapters/index.ts:30` — `RAILS = [ibex, phoenixd, sandbox]` |
| 1.6 | Adding a rail is implementing an interface and appending to an array | **Verified** | the three registries above; comment at `adapters/index.ts:16` |
| 1.7 | A bank or MFI with a request/response API is "just another adapter" | **Reported** | `docs/strategy/BANKS_MFIS_SWITCHES.md` — reasoned, not yet exercised against a bank |
| 1.8 | Automated test suite runs 116 suites in the release gate | **Verified** | `server/package.json` `test` chain — counted |

## 2. Money-safety properties — the core of the pitch

| # | Claim | Class | Source |
|---|---|---|---|
| 2.1 | An unreadable balance is UNKNOWN, never zero | **Verified** | `adapters/campay.ts:268` returns `null` on failure; `core/routing.ts` `payoutReady` separates `rail_unreachable` from `insufficient_rail_balance` |
| 2.2 | Settlement follows an authoritative re-query; callbacks are hints | **Verified** | `core/stateMachine.ts`; `adapters/peexit.ts` header |
| 2.3 | A superseded payout attempt cannot settle the payment | **Verified** | `server/test/superseded-attempt.test.ts` — fails against the prior guard |
| 2.4 | Illegal state transitions are detected (log-only; enforcement behind a flag) | **Partially verified** | `core/stateMachine.ts` transition table; `TRANSITION_TABLE_ENFORCE` is **off** in production |
| 2.5 | Every `/v1` write is idempotent | **Partially verified** | `core/platform/idempotency.ts`; coverage per-endpoint not audited for this deck |
| 2.6 | Webhooks are HMAC-signed with retries and a dead-letter queue | **Verified** | `core/interop/outbound.ts` |
| 2.7 | No payment was lost or misdirected during the 24–28 Oct vendor outage | **Verified** | the send flow refused: `viable:false` on all four methods, Continue disabled (DOM-checked), live 28 Oct |
| 2.8 | A rail that cannot be reached is not offered as operational | **Verified** | `core/interop/router.ts` + `server/test/unreachable-rail-reason.test.ts` — commit `ebbff3b` |

## 3. Rails — current, factual status (28 Oct 2026)

| # | Claim | Class | Source |
|---|---|---|---|
| 3.1 | CamPay is live, authenticated, reachable; serves MTN + Orange payout and collection | **Verified** | production `/health/deep` returned a real balance figure; `campay.ts:268` returns null on failure, so a number proves authentication |
| 3.2 | CamPay float is **0 XAF** — no payout can currently land | **Verified** | `/health/deep` 28 Oct; `float:low` alert raised 18:03 |
| 3.3 | Peexit is **unreachable**; hostnames withdrawn from DNS 24 Oct | **Verified** | `server.peexit.com`, `sandbox.peexit.com`, `api.peexit.com` → `NXDOMAIN`; apex 503 |
| 3.4 | Peexit issued a new gateway; it answers and refuses us at the IP allowlist | **Verified** | `px-gw-c2810.peexit.com` resolves, `server: awselb/2.0`, HTTP 403; production note reads "403 — egress IP not on allowlist" |
| 3.5 | PawaPay is configured but serves no Cameroon corridor | **Verified** | `adapters/payouts.ts` — `supports()` gated on `PAWAPAY_CM_PAYOUTS`, unset |
| 3.6 | IBEX is the crypto rail; phoenixd is a second Lightning node | **Verified** | `adapters/index.ts:30`; `/health/deep` reports `source: IBEX` for FX |
| 3.7 | Recipient verification works, returning an operator-registered name | **Verified** | live `/api/v2/identity/resolve` 28 Oct → `VERIFIED` via `campay_holder` |
| 3.8 | Recipient verification was dark 25–28 Oct | **Verified** | `identity:unverifiable` alert from 2026-10-25; root cause `IDENTITY_PROVIDER_PRIORITY` excluded `campay_holder` |

## 4. Economics — constants, not projections

| # | Claim | Class | Source |
|---|---|---|---|
| 4.1 | Platform fee default 2.5 % | **Verified** | `shared/domain.ts:450` `FEE_PCT = 0.025` |
| 4.2 | Per-org negotiated rate with a floor | **Verified** | `core/platform/billing.ts` `effectiveFeePct` |
| 4.3 | Rail spread 150 bps (LN/USDT/USDC), 280 bps (on-chain) | **Verified** | `shared/domain.ts:435` |
| 4.4 | Minimum transfer 500 XAF | **Verified** | `shared/domain.ts:452` |
| 4.5 | Quote TTL 600 s (LN, USDT), 900 s (on-chain) | **Verified** | `shared/domain.ts:473` |
| 4.6 | The 1.5 % pilot rate shown in the Sorted hub | **Proposed** | `SortedHub.tsx` — explicitly labelled an illustrative pilot rate |

## 5. Claims we must NOT make

Each of these is absent or unproven, and the deck says nothing to the contrary.

| Claim | Status | Why it is excluded |
|---|---|---|
| Transaction volume, revenue, customer counts | **Unknown** | no verified figures; hub figures are labelled illustrative |
| Live production partners | **None** | Sorted would be the first wallet partner |
| Regulatory approval / licence | **Unknown** | `docs/strategy/BANKS_MFIS_SWITCHES.md` is explicit that switch participation is licensed and we hold no posture yet |
| Security certification (SOC 2, PCI, ISO) | **None** | no evidence of any certification |
| Settlement guarantees / SLA | **None** | no SLA exists; float is currently 0 |
| Uptime figures | **Unknown** | not measured over a defined window |
| "Multi-rail resilience proven" | **Overstated** | two of three payout rails are non-functional today |

## 6. Known drift in the existing Sorted hub

`app/src/pages/partners/SortedHub.tsx` is partner-facing and predates today's fixes. Not
corrected here — changing a partner surface mid-pitch is a decision for the operator — but
the deck must not inherit these:

| Hub states | Reality (28 Oct) |
|---|---|
| "Provider abstraction — PawaPay, Peexit, simulator" | CamPay is a payout rail and the only working one; Peexit is unreachable |
| "Recipient check — operator name lookup" via `nameResolver.ts` | verification runs the `identityResolution` chain; `campay_holder` is the authoritative provider |
| Peexit presented as a working rail throughout | unreachable since 24 Oct |
