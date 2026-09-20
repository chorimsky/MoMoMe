# Payment Identity API — `/api/v2`

404 unless `UNIVERSAL_PAYMENT_IDENTITY_ENABLED` (sandbox always reachable). Actor = signed device, partner key or admin; per-actor rate limits; the identity enumeration rule (per device and per IP) on every resolving call.

| call | body | answer |
|---|---|---|
| `POST /payment-resolution` (`PHONE_PAYMENT_RESOLUTION_ENABLED`) | `{ identity, purpose, country? }` | `{ identity: { type, identity, country, currency, operator, native, verification }, destinations[], capabilities }` — the holder's name is full for payer purposes, masked otherwise |
| `POST /wallet/resolve` (`WALLET_RESOLUTION_API_ENABLED`) | `{ identity }` | `{ identity, pay_with: { protocol: LIGHTNING_ADDRESS, address, lnurlp }, destinations }` — open standard out |
| `POST /payment-intents` | `{ recipient: { identity }, amount: { value, currency? }, source?: { rail, asset?, network? } }` | 201 `{ intent (QUOTED with quote.options[]), mode }` |
| `GET /payment-intents/:id` · `GET /payment-intents` | | re-synced intent(s) |
| `POST /payment-intents/:id/route` | `{ source?: { rail, asset? } }` | `{ intent, route, routes[] }` (shadow recorded) |
| `POST /payment-intents/:id/execute` | | `{ intent (PAYMENT_PENDING), request (PaymentRequestV2) }` — 403 in SHADOW / flags off |
| `POST /payment-intents/:id/cancel` | | |
| `GET /assets` · `GET /rails/health` | | assets + networks; flags, mode, capability registry |
| admin `GET /api/admin/upi`, `GET /api/admin/upi/intents/:id/reconcile` | | everything above for operators |

Never `GET /lookup/<number>`: no public directory (rule 15).
