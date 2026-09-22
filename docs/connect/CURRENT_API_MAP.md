# Current API map (2026-09-22)

| Surface | Mount | Auth | Purpose | Status vs Connect |
|---|---|---|---|---|
| App API | `/api/*` | device signature / mk_ key | send flow, quotes, payments, merchants, links, receive, momo transfers, admin | stays; engine entry points `buildQuote`, `createPaymentCore` |
| Interop v1 | `/api/v1/*` | same | payment-intents, routes, rails, providers, countries | legacy intent model; kept |
| UPI v2 | `/api/v2/*` | same, flagged | identity resolve, destinations, intents, quotes, routes, chains, ledger | shadow mode in prod; kept |
| Identity v2 | `/api/v2/identity/*` | same, flagged | recipient verification (Peexit names) | used by resolver |
| Network | `/api/network/*` | same | cross-border corridors | kept |
| **API v1 platform** | **`/v1/*`** | `mm_live_/mm_test_` | quotes, payments, recipients/validate, webhooks, settlements, account, usage, transactions, sandbox, health, openapi | **Connect extends this surface** |
| Developers | `/api/developers/*` | dev session | dashboard backend | extended (MPI, invoices, settlement profile) |
| Admin platform | `/api/admin/platform/*` | admin session | activation, plans, limits, settlements | extended |
| LNURL | `/.well-known/lnurlp/:user`, `/lnurl/pay/:user` | public | Lightning Address per phone | resolves through MPI aliases |
| Merchant pay page | web `/pay/:code` | public | hosted checkout for links/QR/invoices | becomes the intent checkout `pay.momome.xyz/p/:id` (same page, intent-backed) |
| Webhooks in | `/webhooks/*` | provider signatures | IBEX, PawaPay, Peexit, WhatsApp | unchanged |
