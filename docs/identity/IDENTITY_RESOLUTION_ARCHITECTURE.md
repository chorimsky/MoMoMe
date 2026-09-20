# Identity Resolution — Architecture

Status: built 2026-09-20 · flag `IDENTITY_RESOLUTION_ENABLED` (default **off**) · mode `IDENTITY_RESOLUTION_MODE` (default **advisory**).
Audit that preceded it: [IDENTITY_RESOLUTION_AUDIT.md](IDENTITY_RESOLUTION_AUDIT.md).

## What it is
An **additive module** that answers one question — *does this Mobile Money number belong to an active account, and to whom?* — for the V2 send flow, without touching how V1 mints quotes, collects money, or pays out.

```
clients (web DetailsStep · mobile send tab)
   │  POST /api/v2/identity/resolve   (device-signed, purpose-bound)
   ▼
routes/identityV2.ts        gate(404 unless flag) → actorOf → rate limits → enumeration guard → publicIdentity()
   │
   ▼
core/identityResolution/resolver.ts
   normalizeMsisdn ─► cache (HMAC hash) ─► providerChain(country, operator) ─► name match ─► remember ─► audit + metrics
                                              │
                        ┌─────────────────────┼──────────────────────┐
                 providers/mtnDirect   providers/peexit (verify-wallet: name)   providers/orange (stub)   providers/aggregator (pawapay: hint)
                                     providers/sandbox (rehearsal; refuses under liveMoney())
```

## Where it plugs into money (and where it does not)
| Point | What happens | Guard |
|---|---|---|
| `createPaymentCore` (routes/api.ts) | after the `Payment` literal, `cachedSnapshot(recipient.phone)` attaches `payment.recipientIdentity` — **cache only, never a provider call** | flag on; status VERIFIED / INACTIVE / NOT_FOUND only; try/catch, advisory |
| `stateMachine.transition()` | once `INBOUND_CONFIRMED` exists, a changed snapshot is reverted to the stored one | always |
| `jobs.reconcileTick` | `pruneIdentityRecords()` (data minimisation) | always, no-op when empty |
| `/health/deep` | `identity: { enabled, mode, providers[] }` | informational; never a 503 by itself |
| `/config` | `identity: { enabled, mode }` | clients gate on it |

Not touched: quotes, rails, payouts, ledger, settlement, the network saga, admin roles.

## Layering rules (enforced by construction)
1. Providers speak only through `IdentityProvider` (see [IDENTITY_PROVIDER_INTERFACE.md](IDENTITY_PROVIDER_INTERFACE.md)); the resolver never imports a rail.
2. The resolver returns a `NormalizedIdentifier`-derived `IdentityResolution` (`shared/identity.ts`); the route reduces it to `PublicIdentity` — provider references never leave the server.
3. Payment services consume an immutable `RecipientIdentitySnapshot`; they never call the resolver.
4. A provider failure is a state (`PROVIDER_UNAVAILABLE`), never an exception on the payment path.

## States
`UNKNOWN · PENDING · VERIFIED · NOT_FOUND · INACTIVE · UNSUPPORTED · PROVIDER_UNAVAILABLE · VERIFICATION_FAILED`
- Timeout / 5xx / auth error ⇒ `PROVIDER_UNAVAILABLE` (with `error` = `IDENTITY_PROVIDER_TIMEOUT` / `_UNAVAILABLE` / `_AUTH_ERROR`). **Never** `NOT_FOUND`.
- `UNKNOWN` is what the aggregator alone can say (operator reachability). It is never rendered as verified.
- `VERIFICATION_FAILED` only from `/verify` when the expected name is `NO_MATCH`.

## Provider chain
`IDENTITY_PROVIDER_PRIORITY` (default `mtn_direct,orange_direct,peexit_verify,pawapay,sandbox`). A provider is in the chain when it is *configured* and *supports* the market × operator. Fallback to the next provider happens **only** on a retryable failure (timeout, 5xx, network); `NOT_FOUND`, `INACTIVE` and auth errors stop the chain. Each attempt is bounded by `IDENTITY_TIMEOUT`; `IDENTITY_MAX_RETRIES` (≤ 2) extra attempts per provider.

## Cache
Keyed by `HMAC-SHA256(IDENTITY_HASH_KEY, E.164)` (falls back to `COMPLIANCE_HMAC_KEY`). Only `VERIFIED / NOT_FOUND / INACTIVE` are remembered, for `IDENTITY_CACHE_TTL` seconds (default 300). Outages are never cached.

## Frontend contract
States `idle → typing → validating → verified | not_found | inactive | unavailable | unsupported | error`. Verified renders `✓ NAME / <Operator> Mobile Money / <Country>`. `unavailable` and `error` offer *Retry*; the manual-name box stays open in advisory mode. In gate mode `not_found`/`inactive` block *Continue*.

## Name matching (2026-09-20 rewrite)
One algorithm, `compareNames()` in `shared/domain.ts`, used by the server (`identityResolution/names.ts`, the V1 payment name gate via `namesMatch`) and both apps. Tokens: NFD-stripped, lower-cased, apostrophes/periods removed inside a token (N'GO ≡ NGO, "S." → initial), hyphens split (JEAN-PAUL → jean paul), titles dropped (Mr/Mme/Dr/…). A token matches when equal, one edit apart at ≥ 5 letters (two at ≥ 9: Aminatu/AMINATOU, Mbala/MBALLA), an initial matches a first letter, and a joined spelling matches two adjacent tokens (jeanpaul ≡ jean paul).
- **MATCH** — every token of the shorter spelling is found and it has ≥ 2 tokens (or both sides are the same single token).
- **PARTIAL_MATCH** — ≥ 2 real (non-initial) tokens shared, or a single-token spelling that is found (a surname alone).
- **NO_MATCH** — otherwise; in particular a shared first name alone ("Jean Ngo" vs "JEAN MANGA").
- **NOT_AVAILABLE** — either side empty or made only of initials/titles.

## V1 integration
With the flag on, `registeredName()` (core/nameResolver.ts, behind `GET /api/recipients/resolve` and the payment name gate) takes its answer from the v2 chain — so the existing apps get real operator names from Peexit without a client release. With the flag off it keeps the sandbox stand-in (`pawapay.lookupName`, null under live money).
