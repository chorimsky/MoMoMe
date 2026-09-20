# Identity Provider Configuration

All variables are read at call time — a Railway variable change takes effect on the next request without a redeploy of code.

## Feature
| var | default | meaning |
|---|---|---|
| `IDENTITY_RESOLUTION_ENABLED` | `false` | master switch; off ⇒ `/api/v2/identity/*` is 404 and no snapshot is attached |
| `IDENTITY_RESOLUTION_MODE` | `advisory` | `advisory` shows; `gate` blocks NOT_FOUND / INACTIVE recipients in the apps |
| `IDENTITY_PROVIDER_PRIORITY` | `mtn_direct,orange_direct,peexit_verify,pawapay,sandbox` | order of the chain |
| `IDENTITY_CACHE_TTL` | `300` s (min 30) | reuse window for NOT_FOUND / INACTIVE (they can flip when the account is registered or unblocked) |
| `IDENTITY_CACHE_TTL_VERIFIED` | `21600` s (6 h; never below `IDENTITY_CACHE_TTL`) | reuse window for a VERIFIED name — a registered name rarely changes, and re-asking the operator on every payment to the same person costs a round-trip each time |
| `IDENTITY_RECORD_RETENTION_DAYS` | `30` | prune after expiry + N days |
| `IDENTITY_TIMEOUT` | `6000` ms (min 1000) | per attempt |
| `IDENTITY_MAX_RETRIES` | `0` (max 2) | extra attempts per provider on retryable failures |
| `IDENTITY_RATE_LIMIT` | `20` / min | per actor |
| `IDENTITY_MAX_DISTINCT_PER_HOUR` | `60` (min 5) | distinct numbers per device per hour |
| `IDENTITY_HASH_KEY` | falls back to `COMPLIANCE_HMAC_KEY` | HMAC key for the cache/audit hash — set one in production |

## MTN direct (`mtn_direct`)
| var | default |
|---|---|
| `MTN_MOMO_TARGET_ENV` | `sandbox` (`mtncameroon` in production) |
| `MTN_MOMO_API_URL` | sandbox: `https://sandbox.momodeveloper.mtn.com`; live: `https://proxy.momoapi.mtn.com` |
| `MTN_MOMO_SUBSCRIPTION_KEY` · `MTN_MOMO_API_USER` · `MTN_MOMO_API_KEY` | — (all three required for `configured()`) |
| `MTN_MOMO_COUNTRIES` | `CM` |

The operator supplies these through the Railway UI; they are never pasted into chat or committed.

## Orange direct (`orange_direct`)
`ORANGE_IDENTITY_API_URL`, `ORANGE_IDENTITY_API_KEY` — reserved. The provider is a stub until an Orange Money identity contract exists; with the vars set it still answers `PROVIDER_UNAVAILABLE` (non-retryable) so nothing pretends.

## Peexit verify-wallet (`peexit_verify`)
No extra variables: reuses `PEEXIT_API_KEY` / `PEEXIT_ENV` / `PEEXIT_API_URL` (+ `PEEXIT_PROXY_URL`) exactly like disbursement. `configured()` = the key is set. Because `server.peexit.com` is IP-allowlisted, a local dev server with the production key gets an HTML 403 → `AUTH_ERROR` (non-retryable, honest). This is the first real name source in production: turning `IDENTITY_RESOLUTION_ENABLED=true` on Railway makes both V1 `/recipients/resolve` and V2 answer from it.

**Production finding 2026-09-20:** `server.peexit.com` answers `404 Endpoint "POST /v1/clients/verify-wallet" not found.` — the endpoint documented for the sandbox is **not deployed on Peexit's production base**. The provider is therefore DOWN in production (circuit breaker, re-probed every `IDENTITY_BREAKER_MS`, default 10 min) and senders see "can't be verified yet — confirm the name yourself". Ask Peexit to enable Verify-Wallet on the production account / confirm its production path; the day it answers, verification starts without a deploy.

| var | default | meaning |
|---|---|---|
| `IDENTITY_BREAKER_MS` | `600000` (min 60 s) | how long a provider rests after a configuration-class failure (route missing, key refused, IP blocked) |

## Aggregator (`pawapay`)
Uses the existing `PAWAPAY_*` rail credentials. Operator hint only.

## Sandbox
No configuration. Exists only when `RAILS_MODE=sandbox` and no rail is live. Local rehearsal: `.claude/launch.json` → `momome-server-identity` starts the dev server with the flag on.
