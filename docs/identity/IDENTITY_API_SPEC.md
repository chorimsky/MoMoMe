# Identity API — v2

Base: `/api/v2/identity`. **404** for every path while `IDENTITY_RESOLUTION_ENABLED` ≠ `true`. `Cache-Control: no-store` on every answer.

## Authentication
- Device: the same signed-request scheme as `/api/*` (`x-mm-sender`, `x-mm-ts`, `x-mm-sig`); an un-enrolled or unsigned device is **401 `IDENTITY_UNAUTHORIZED`**.
- Partner API key (`ownerOf`) and admin session token are also actors.
- `purpose` is mandatory: `RECIPIENT_VERIFICATION | PAYMENT_CREATION | PAYOUT_VALIDATION | TRANSACTION_CONFIRMATION | FRAUD_PREVENTION | SUPPORT`.

## POST /resolve
```json
{ "identifier": "674123456", "country": "CM", "purpose": "RECIPIENT_VERIFICATION", "expected_name": "optional" }
```
200:
```json
{ "success": true, "mode": "advisory",
  "identity": { "verified": true, "status": "VERIFIED", "display_name": "NANA JEAN PAUL", "country": "CM",
                "operator": "MTN", "currency": "XAF", "account_status": "ACTIVE",
                "capabilities": { "mobile_money": true, "receive": true, "send": true, "payout": true, "collection": true },
                "name_match": "MATCH", "provider": "mtn_direct", "verified_at": "…", "expires_at": "…", "request_id": "idr_…" } }
```
Not verified (still 200 — the request succeeded, the answer is a state):
```json
{ "success": false, "mode": "advisory", "message": "Recipient verification is temporarily unavailable. Please try again.",
  "identity": { "status": "PROVIDER_UNAVAILABLE", "verified": false, "error": "IDENTITY_PROVIDER_TIMEOUT", "country": "CM", "operator": "MTN", "…": "…" } }
```

## POST /verify
Same body; `expected_name` **required**. A `NO_MATCH` answers `status: "VERIFICATION_FAILED"`, `success: false`.

## GET /providers (any actor)
`{ providers: [{ name, configured, status, supports }], capabilities: { CM: { MTN: { identity_resolution, name_lookup, provider } } }, priority: [...] }` — no secrets, no URLs.

## GET /health (admin only)
Providers' health + `metrics` (`identity_resolution_total / success / failure / provider_timeout / not_found / cache_hit / cache_miss / rate_limited / unauthorized / latency{p50,p95,n}`).

## Errors
| HTTP | `error` | when |
|---|---|---|
| 400 | `IDENTITY_INVALID_IDENTIFIER` | unparsable number, missing/invalid `purpose`, `/verify` without `expected_name` |
| 400 | `IDENTITY_UNSUPPORTED_COUNTRY` | parsed but outside the supported markets |
| 401 | `IDENTITY_UNAUTHORIZED` | no actor |
| 404 | — | flag off |
| 429 | `IDENTITY_RATE_LIMITED` | per-actor `IDENTITY_RATE_LIMIT`/min, IP 120/min, or `IDENTITY_MAX_DISTINCT_PER_HOUR` distinct numbers/hour (enumeration) |
| 200 + state | `IDENTITY_NOT_FOUND / _INACTIVE / _UNSUPPORTED_OPERATOR / _PROVIDER_UNAVAILABLE / _PROVIDER_TIMEOUT / _PROVIDER_AUTH_ERROR / _VERIFICATION_FAILED` | inside `identity.error` |

## User copy (served in `message`, mirrored in both apps' i18n)
- NOT_FOUND — *We couldn't verify this Mobile Money account. Please check the number and try again.*
- INACTIVE — *This Mobile Money account can't receive money right now. Please check the number.*
- PROVIDER_UNAVAILABLE — *Recipient verification is temporarily unavailable. Please try again.*
- UNSUPPORTED / UNKNOWN — *This number can't be verified yet — you can still confirm the name yourself.*
- VERIFICATION_FAILED — *The name doesn't match the account. Please check the recipient.*

## Gate mode on the V1 payment path
With `IDENTITY_RESOLUTION_MODE=gate`, `POST /api/payments` answers **409 `recipient_unverified`** (`code: identity_not_found | identity_inactive`) when the verification **cache** holds NOT_FOUND / INACTIVE for the recipient — cache only, so an outage or an unresolved number is never a refusal; merchant checkouts are exempt. Advisory mode never refuses.

## Admin (any mode, `Identities` section)
`GET /api/admin/identity-resolution` → flag, mode, chain order, provider health, capability table, process metrics, `last24h` window from the persisted audit, last 30 audit rows (hash + last 4 only). `POST /api/admin/identity-resolution/lookup { identifier, country?, expectedName? }` → a support lookup under purpose `SUPPORT`, audited under the admin uid, cache bypassed; 404 while the flag is off.

## Compatibility
`GET /api/recipients/resolve` (V1) is unchanged and remains the default for both apps while the flag is off. `Payment.recipientIdentity` is an optional, additive field.
