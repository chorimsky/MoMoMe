# Identity Security & Privacy Model

## Threats and controls
| Threat | Control | Where |
|---|---|---|
| Enumerating who owns which number | signed-device auth; `IDENTITY_RATE_LIMIT` per actor/min; IP 120/min; one rule on EVERY name-disclosing surface (`/v2/identity/*` and V1 `/recipients/resolve`): `IDENTITY_MAX_DISTINCT_PER_HOUR` distinct numbers per device/hour and `IDENTITY_MAX_DISTINCT_PER_HOUR_IP` (default 4×) per address — devices enrol freely, the IP ceiling is what stops a script; the Lightning Address shows a masked name unless the holder proved the number | `identityResolution/audit.ts`, `routes/lnurl.ts` |
| Purpose creep | `purpose` mandatory and audited; the payment path may only read the cache (`cachedSnapshot`) — never a live lookup | resolver, api.ts |
| Leaking provider internals | `publicIdentity()` strips `provider.reference` and raw payloads; `/providers` has no URLs or keys; `/health` is admin-only | route |
| Logging PII | audit rows carry `identifierHash` (HMAC) + `last4` only; errors log codes, not numbers | audit.ts, providers |
| Data retention | cache TTL `IDENTITY_CACHE_TTL` (300 s); records pruned after expiry + `IDENTITY_RECORD_RETENTION_DAYS` (30) by the reconcile tick | cache.ts, jobs.ts |
| Tampering with a verified recipient after payment | `RecipientIdentitySnapshot` frozen once `INBOUND_CONFIRMED` exists (`transition()` reverts a changed snapshot) | stateMachine.ts |
| Fabricated names | only an authoritative provider (or the sandbox, which cannot exist under `liveMoney()`) may set `displayName`; the aggregator's answer is operator-only | providers, resolver |
| Provider credential exposure | env only; `configured()` checks presence; never echoed by any endpoint or test | providers |
| Sandbox answers reaching real senders | `sandboxProvider.configured()` is false when any rail is live; `resolve` throws if called under live money | sandbox.ts |
| Uncontrolled retries hammering an operator API | per-provider `IDENTITY_MAX_RETRIES ≤ 2`, `IDENTITY_TIMEOUT` bound, no retry on auth errors | resolver |

## Data minimisation
Stored per record: hash, last 4 digits, country, operator, currency, display name (as the operator returned it), status, provider name, provider reference (server-side only), timestamps. Not stored: the raw MSISDN, the provider's raw payload, the actor's device key.

## Who may call what
| Actor | /resolve | /verify | /providers | /health |
|---|---|---|---|---|
| enrolled device | ✓ (rate + enumeration limits) | ✓ | ✓ | ✗ |
| partner API key | ✓ | ✓ | ✓ | ✗ |
| admin session | ✓ | ✓ | ✓ | ✓ |
| anonymous | 401 | 401 | 401 | 401 |

## CEMAC posture
Advisory mode adds no processing beyond what the sender already does (naming the recipient). The audit trail per purpose supports the Règlement 02/24 KYC-of-beneficiary expectation without storing more than the operator's public account name. See `docs/compliance` for the wider map.
