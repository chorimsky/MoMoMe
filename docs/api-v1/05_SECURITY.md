# API v1 — Security

- Credentials: 128-bit random, SHA-256 stored, hint only; constant-time compare; `lastUsedAt` stamped ≤1/min.
  Live credentials only after operator activation (`liveEnabled`), which requires admin step-up.
- Scopes per credential; roles per organization membership; every write audited (actor, ip, request id).
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
