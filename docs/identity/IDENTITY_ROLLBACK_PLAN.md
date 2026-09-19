# Identity Rollback Plan

| symptom | action | effect |
|---|---|---|
| anything wrong with verification | unset / `false` `IDENTITY_RESOLUTION_ENABLED` on Railway | next request: `/api/v2/identity/*` 404; `/config.identity.enabled=false`; both apps fall back to the V1 lookup on their next `/config` load (web: next mount; mobile: next app start); no snapshot attached to new payments |
| gate mode blocks too much | `IDENTITY_RESOLUTION_MODE=advisory` | apps stop blocking immediately |
| one provider misbehaves | drop it from `IDENTITY_PROVIDER_PRIORITY` | chain skips it; answers become `PROVIDER_UNAVAILABLE` (honest) for that operator |
| operator API rate concerns | raise `IDENTITY_CACHE_TTL`, set `IDENTITY_MAX_RETRIES=0` | fewer upstream calls |
| code-level fault | `scripts/railway-rollback.sh <previous deploymentId>` | the module is additive; the previous build has no v2 surface |

Existing payments keep their `recipientIdentity` snapshot (immutable, informational). Cached records expire by TTL and are pruned by retention; to purge immediately, restart with the flag off — the collection is not read by any V1 path.
