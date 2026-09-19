# Identity Data Model

## `identity_resolutions` (persisted snapshot collection; `register("identity_resolutions")`)
| field | type | notes |
|---|---|---|
| id | `idr_…` | |
| identifierHash | hex(32) | HMAC-SHA256 of E.164 — the key; the number is never stored |
| identifierLast4 | string | support display only |
| country · operator · currency | string / string\|null / string\|null | from normalisation, refined by the provider |
| displayName | string? | exactly as the operator returned it |
| verificationStatus | `VERIFIED \| NOT_FOUND \| INACTIVE` | only cacheable states |
| accountStatus | `ACTIVE \| INACTIVE \| UNKNOWN` | |
| provider | string | `mtn_direct`, … |
| providerReference | string? | never leaves the server |
| verifiedAt · expiresAt · createdAt · updatedAt | ISO | TTL = `IDENTITY_CACHE_TTL` |

Pruned by `pruneIdentityRecords()` once `expiresAt + IDENTITY_RECORD_RETENTION_DAYS` has passed.

## Audit row (in-memory ring + metrics; `audit.ts`)
`requestId, correlationId?, actor, purpose, identifierHash, country, operator, provider, status, error?, latencyMs, cache: hit|miss|bypass, at`.

## `RecipientIdentitySnapshot` (on `Payment.recipientIdentity`, `NetworkIntent.recipientIdentity`)
`identifier (E.164), country, operator, currency, status, verified, displayName?, provider, verifiedAt?, nameMatch?, requestId`.
Attached at creation from the cache only; immutable once `INBOUND_CONFIRMED` exists. Absent when the flag is off or nothing is cached — so a V1 payment is byte-identical to before.

## Postgres
The collection rides the existing snapshot persistence (`STORE_BACKEND=postgres` stores it as the `identity_resolutions` document like every other `register()` collection). A per-row table is not needed at the current volume; when it is, mirror `network_txs` in `db/pgStore.ts`.
