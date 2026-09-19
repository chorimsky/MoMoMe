# Identity Deployment Plan

Everything ships **dark**: code deployed, `IDENTITY_RESOLUTION_ENABLED` unset ⇒ V1 behaviour, byte for byte.

| step | action | verify |
|---|---|---|
| 0 | deploy (clean-export `railway up`), gate with `scripts/deploy-gate.sh` | `/api/v2/identity/providers` → 404; `/config.identity.enabled=false` |
| 1 | operator sets `IDENTITY_HASH_KEY` and MTN vars on Railway (UI), `MTN_MOMO_TARGET_ENV=mtncameroon` | `/health/deep` still `identity.enabled=false` |
| 2 | preview environment: `IDENTITY_RESOLUTION_ENABLED=true` on the sandbox deployment; verify with a known MTN sandbox number | `/api/v2/identity/health` (admin) shows `mtn_direct: OK` |
| 3 | production: `IDENTITY_RESOLUTION_ENABLED=true`, mode **advisory** (default) | apps show the verified card; payments unchanged; metrics move; `identity_resolution_provider_timeout` rate < 5 % |
| 4 | one week of advisory: watch `not_found` vs `delivered` on the same recipients; tune `IDENTITY_CACHE_TTL`, `IDENTITY_RATE_LIMIT` | Admin → Reports funnel unchanged |
| 5 | optional: `IDENTITY_RESOLUTION_MODE=gate` | apps block NOT_FOUND / INACTIVE; conversion watched |

No database migration; no client release needed (both apps already read `/config.identity`). Mobile OTA is not required but the current build must include commit ≥ this one for the v2 states to render.
