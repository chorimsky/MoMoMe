# Operations — making the box replaceable

The infrastructure audit (September 2026) found one container, one SQLite file, laptop
deploys and no paging. This is the runbook for the Tier-1 changes; the code side of each
is in the repository, the provisioning side is the operator's.

## 1. Postgres as the live store

Code: `server/src/db/*` (schema, per-row repos, snapshots), `scripts/migrate-sqlite-to-postgres.ts`.

1. Provision managed Postgres (Railway → New → Database → PostgreSQL, or Neon). Enable
   automated backups / point-in-time recovery on the provider.
2. Pause new money: Admin → Settings → Operations → *Accept payments* off. Wait for
   in-flight payouts to settle (Admin → Payments shows none in PAYOUT_REQUESTED).
3. Copy the SQLite file off the volume (Railway → service → volume → download, or
   `railway ssh` when available) and run, with the same code version:
   ```bash
   DATABASE_URL=postgres://… pnpm --filter @momome/server migrate:postgres path/to/momome.db --dry-run
   DATABASE_URL=postgres://… pnpm --filter @momome/server migrate:postgres path/to/momome.db
   ```
   Re-runnable: every write is an upsert.
4. Set on the service: `STORE_BACKEND=postgres`, `DATABASE_URL=…`. Redeploy. Check
   `/health/deep` reports `store.backend: postgres, durable: true` and Admin → Ops.
5. Turn *Accept payments* back on. Keep the SQLite volume for 30 days, then remove it.

Rehearsed end to end on 2026-09-17 against a local Postgres 15: sandbox SQLite migrated
(65 snapshot keys, 7 payments) → server booted with `STORE_BACKEND=postgres` →
`/health/deep` 200 → new quote → payment → simulated inbound → DELIVERED with 9 ledger
legs as rows → restart → the payment survived → a second `PROCESS_ROLE=api` replica
served it without running jobs → two `all` instances ticked under the advisory lock
without overlapping.

## 2. Replicas and the worker

Code: `PROCESS_ROLE` in `server/src/jobs.ts` / `index.ts`; Postgres advisory job lock.

- Single container (today): `PROCESS_ROLE` unset (= `all`). Nothing changes.
- Two or more API replicas (needs Postgres): set `PROCESS_ROLE=api` on the API service
  with `numReplicas: 2`, and add a second Railway service from the same repo with
  `PROCESS_ROLE=worker`, `numReplicas: 1`. The worker runs the 30-second money jobs; the
  API replicas only quote and serve. If both are left as `all`, the advisory lock still
  guarantees a tick never runs twice at once.
- `/health/deep` on an `api` replica does not report job staleness; probe the worker's
  URL (or the single container) for that.

## 3. Deploys from CI, not a laptop

Code: `.github/workflows/deploy.yml`, `scripts/deploy-gate.sh`, `scripts/railway-rollback.sh`.

- Create a Railway **staging** environment (duplicate production; set `RAILS_MODE=sandbox`
  and sandbox keys; its own volume/Postgres).
- Repository secrets: `RAILWAY_TOKEN` (project token), `STAGING_API_URL`,
  `PRODUCTION_API_URL`.
- Every green push to `main` deploys **staging**; a tag `vX.Y.Z` deploys **production**.
  Both run the gate (deep health 200 with the deployed SHA + a synthetic quote) and roll
  back to the previous SUCCESS deployment if it fails.
- Manual fallback stays valid: `git archive HEAD | tar -x -C tmp && cd tmp && railway up`
  from the export root, then `scripts/deploy-gate.sh <url>`.

## 4. Monitoring that pages

Code: `server/src/core/alerts.ts`, `/health/deep`, `server/src/core/errorSink.ts`.

- Admin → Settings → Operations → **Page this phone**: WhatsApp first, SMS fallback.
  Conditions: payout rail down · payout stuck > 20 min · review held > 60 min · float
  under `ALERT_FLOAT_FLOOR_XAF` (default 250 000) · network books unmatched / sagas stuck
  · network liquidity under floor. First occurrence, hourly reminder, all-clear.
- Uptime: point an external probe (Better Stack, UptimeRobot, Checkly …) at
  `/health/deep` every minute; alert on non-200. It is 503 when the store is not durable,
  the jobs have not completed for 3 minutes, FX is stale on live money, a rail is down,
  or a critical alert is open.
- Errors: set `SENTRY_DSN` on the service to ship unhandled errors (route, method, no
  PII). Absent = silent, nothing else changes.

## 5. Secrets

Rotate on a calendar (quarterly, and immediately after any exposure): ADMIN_PASSWORD,
ADMIN_SESSION_SECRET, COMPLIANCE_HMAC_KEY, provider keys (IBEX, PawaPay, Peexit, WhatsApp).
Two people must hold recovery access to Railway, Vercel, EAS, Apple, Google Play and the
WhatsApp Business account.

## 6. Mobile on a cadence

Code: `.github/workflows/mobile.yml`.

- Every push to `main` that touches `mobile/` or `shared/` publishes an OTA update to the
  production channel (needs the `EXPO_TOKEN` repository secret).
- A tag `mobile-vX.Y.Z` (or a manual run with `build`) queues EAS store builds for both
  platforms — this is what ships new icons, the splash and any native module. Submit to
  the stores from the EAS dashboard (or `eas submit`) once the App Store Connect key
  access is sorted; Play submission uses the service-account key in `eas.json`.
- Bump `version` in `mobile/app.config.ts` before a native build: OTA updates only reach
  binaries with the same runtime version.
