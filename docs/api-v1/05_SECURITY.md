# API v1 — Security

- Credentials: 128-bit random, SHA-256 stored, hint only; constant-time compare; `lastUsedAt` stamped ≤1/min.
  Live credentials only after operator activation (`liveEnabled`), which requires admin step-up.
- Scopes per credential; roles per organization membership; every write audited (actor, ip, request id).
- **Expiry (optional).** A credential may carry `expiresAt`, set at creation with
  `expires_in_days` (capped at 730) or later from the dashboard. Absent means it never
  expires, so every key issued before this existed keeps working. An expired key is refused
  as `401 credential_expired`, told apart from `credential_revoked` on purpose: revoked means
  somebody decided, expired means nobody did, and the remedy differs. **Rotation renews the
  lifetime, not the remainder** — rotating a 90-day key with three days left gives 90 fresh
  days, since the point of rotating is not to inherit the old key's deadline. An unparseable
  expiry counts as expired rather than as eternal, so a typo in a form cannot mint a key no
  date will retire; a past or malformed expiry at creation is ignored instead, because
  minting an unusable key is a poor way to report a bad input.
- Environments are separate deployments; a wrong-environment key is refused before any handler runs.
- Idempotency records store a request fingerprint, never the body; responses replayed only for the same org+env+endpoint+key.
- Rate limits per organization (durable counter on Postgres, per-instance on SQLite); payment endpoints stricter.
- Webhook URLs: public HTTPS only in live; deliveries signed; secrets shown once.
- Nothing from a provider is exposed: the public payment carries only the instruction the customer must pay
  and `provider_reference` on settlements the operator entered.
- Logs never contain credentials or secrets (only hints/ids); the audit trail stores actions, not bodies.
- Sandbox ↔ production credential lookup is by hash over an HMAC-signed call and answers only test credentials.
- Operator actions that move money (credit a balance, approve/submit/complete a settlement, enable live,
  suspend) are behind the admin step-up gate (`ELEVATED_ONLY` in routes/api.ts).
