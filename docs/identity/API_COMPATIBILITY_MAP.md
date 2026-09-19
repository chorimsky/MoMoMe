# API Compatibility Map — V1 ↔ V2 identity

| V1 (unchanged) | V2 (additive) | relation |
|---|---|---|
| `GET /api/recipients/resolve?phone&country` → `{ status: provider\|internal\|manual\|unknown, name?, provider? }` | `POST /api/v2/identity/resolve` → `{ success, identity: PublicIdentity, message?, mode }` | V2 is used by the apps only when `/config.identity.enabled`; V1 stays the default and is not deprecated |
| `POST /api/payments` → `Payment` | same, plus optional `Payment.recipientIdentity` | additive field; absent when the flag is off or nothing is cached |
| `POST /api/network/intents` → `NetworkIntent` | plus optional `recipientIdentity` | additive |
| `GET /api/config` | plus `identity: { enabled, mode }` | additive |
| `GET /health/deep` | plus `identity` block | additive, never changes the status code |
| — | `POST /api/v2/identity/verify`, `GET /api/v2/identity/providers`, `GET /api/v2/identity/health` | new; 404 while off |

Name vocabulary mapping in the apps: `VERIFIED → nameSource "provider"`; `NOT_FOUND / INACTIVE / UNSUPPORTED / PROVIDER_UNAVAILABLE / UNKNOWN → "unknown"` (or the sender's `"manual"` name is kept). Review, the server's `cleanName` handling and the receipt see exactly the V1 fields.
