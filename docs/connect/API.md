# MoMo›Me Connect — API summary (on /v1, same envelope, credentials, idempotency as API v1)

| Endpoint | Scope | Purpose |
|---|---|---|
| `GET /v1/identities/me` | identities:read | your MPI, profiles, balance |
| `POST /v1/identities` · `GET /v1/identities` · `GET/PATCH /v1/identities/{id}` · `POST /v1/identities/{id}/aliases` · `GET /v1/identities/{id}/balance` | identities:* / balances:read | identities you manage (branches, customers, sub-merchants); settlement profile |
| `POST /v1/resolve` | identities:read | `{phone|email|lightning_address|merchant_code|business_id|identity}` → `{reachable, identity_type, connected, payment_capabilities}` — never balances/destinations |
| `POST/GET /v1/counterparties` · `POST /v1/counterparties/{id}/link` | identities:* | parties without a MoMo›Me presence; auto-link when they join |
| `POST /v1/payment-intents` · `GET` · `POST …/execute {method?, payer?}` · `POST …/cancel` | payments:* | the canonical intent; `route_preview` at creation, `route_explanation` at execution |
| `POST /v1/invoices {kind: invoice|payment_link|qr}` · `GET` · `POST …/cancel` | invoices:* | first-class invoices, links and QR — each owns one intent, `payment_url` = hosted checkout |
| `POST /v1/requests` | invoices:write | request-to-pay (payer required) |
| `POST /v1/payouts {amount, destination:{phone|lightning_address|identity}}` · `GET` | payouts:* | from a MoMo›Me balance to Mobile Money or a Lightning Address (XAF in, Lightning invisible) |
| `GET /v1/checkout/{intent}` · `POST …/pay {method, payer_phone?}` · `GET …/status` | public | the hosted checkout's backend |
| `POST /v1/sandbox/identities/{id}/credit` | test only | fund a balance to rehearse the internal route |

Statuses — payment: created · authorized · pending · processing · completed · failed · expired · reversed;
settlement: pending · processing · settled · failed · reversed · not_applicable. Events: `payment.*`,
`settlement.*`, `invoice.created/paid/expired`, `payout.*`, `identity.created/updated`.
Errors (lower-case forms of §41): invalid_request, invalid_identity, identity_not_found,
payment_method_unavailable, route_unavailable, insufficient_liquidity, payment_expired, payment_failed,
compliance_rejected, duplicate_request, provider_error, temporary_unavailable.
