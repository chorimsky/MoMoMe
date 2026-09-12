# Security

- **Identity**: the account is the device. Every device holds a P-256 key pair, enrols its
  public keys once (trust on first use) and signs every request (method, path, timestamp,
  body hash). Partners use API keys. Admin sessions are HMAC tokens with role checks and
  step-up for sensitive actions.
- **Authorization**: owner-scoped reads and writes; deny-by-default on ownerless payments;
  intents and routes readable only by their owner (or admin).
- **Webhooks**: every provider verified (IBEX secret + source IP; Peexit basic auth;
  WhatsApp / phoenixd HMAC). Lightning never settles on a webhook body — always an
  authoritative re-query. Identical payloads are recorded once and suppressed.
- **Idempotency**: `Idempotency-Key` on `POST /api/payments`, `/api/v1/payment-intents`
  and `/execute`; the intent itself is the double-payment lock; provider deposits deduped
  by their id.
- **Rate limits**: per IP on every public endpoint; per PHONE on OTP sends; per NUMBER on
  the WhatsApp bot.
- **Transport & headers**: HSTS, deny-all CSP on the API, hashed-script CSP on the web,
  `no-store`, no framework banner, strict CORS.
- **Secrets**: never logged; admin views show presence/masks only; placeholder detection in
  Readiness; SSRF guard on operator-supplied hosts.
- **PII**: names only where a payer is shown them anyway; OTP codes never stored in the
  outbox; provider payloads stored as hashes.
