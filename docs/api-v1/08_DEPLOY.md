# API v1 — Deployment and rollback

API v1 ships inside the existing server: `scripts/deploy.sh production` deploys it with the rest.
It is additive and dark until an organization exists — no flag is needed to deploy it safely.

Environment variables (server/.env.example):
- `PUBLIC_URL` — used in the OpenAPI `servers` and the developer dashboard.
- `SANDBOX_API_URL` — the sandbox base URL shown to developers and in `environment_mismatch` answers.
- `LIVE_API_URL` — optional override for the live base URL shown by the sandbox.
- `PLATFORM_SYNC_SECRET` (production + sandbox), `PLATFORM_ORIGIN_URL` (sandbox) — credential lookup.
- `DEVELOPER_SIGNUP=off` — invitation-only sign-up.
- `DEV_SESSION_SECRET` — optional fixed secret for developer sessions (else generated and persisted).
- `RESERVATION_TTL_MIN` (30), `IDEMPOTENCY_TTL_H` (24), `SETTLEMENT_FEE_XAF` (0).

Sandbox deployment: a second Railway service from the same repo with `RAILS_MODE=sandbox`, no live rail
secrets, `PUBLIC_URL=<sandbox url>`, `PLATFORM_ORIGIN_URL`, `PLATFORM_SYNC_SECRET`. The existing
`feisty-comfort` project can be repurposed for this.

Web: the docs portal and dashboard are part of the Vercel app (`/developers`, `/developers/dashboard`);
they call `VITE_API_BASE` minus `/api` plus `/v1`.

Storage: all API v1 collections persist through `register()/touch()` snapshots (`platform_*` keys), so both
the SQLite volume and the Postgres snapshot backend carry them without a migration.

Rollback: `scripts/railway-rollback.sh` as for any deploy; the platform snapshots are ignored by older builds.
