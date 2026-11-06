# Phase 0 — Existing architecture, as verified

**Date:** 2026-11-06 · **Commit audited:** `9e4e6e3` on `main` · **Method:** read of the
repository plus unauthenticated HTTPS probes of the live hosts from one machine. Every
claim names the file or the measurement that supports it.

Companion documents: [DEPENDENCY_MAP.md](DEPENDENCY_MAP.md),
[PERFORMANCE_BASELINE.md](PERFORMANCE_BASELINE.md), [RISK_REGISTER.md](RISK_REGISTER.md).

## 0. What was NOT accessible, and is therefore not asserted

The master prompt forbids claiming to have inspected what cannot be reached. The following
were not available to this audit and nothing below depends on them:

| Not accessible | Consequence |
| --- | --- |
| Railway dashboard, region setting, volume, logs, metrics | The serving region is **inferred from latency only** (§2.1). No cost data. |
| Shell on the Railway container | SQLite file size, growth rate and volume headroom unknown. |
| Vercel dashboard, analytics, bandwidth | No RUM, no real Core Web Vitals, no bandwidth or spend figures. |
| Hostinger hosting account | The state of the `deploy-hostinger` target is unverified (RISK-03). |
| Any vantage point outside this machine | Latency is **single-origin**. No Africa / Asia / Americas figures exist (§PERFORMANCE_BASELINE §0). |
| Provider dashboards (MTN, Orange, Peexit, CamPay, PawaPay) | Rail behaviour is read from our own `/health/deep` counters, not from the providers. |

No credentials were used, created or entered. No infrastructure was changed.

## 1. Shape of the system

A pnpm workspace (`pnpm-workspace.yaml`) of two packages plus three non-workspace trees:

| Tree | Role | Deploys to |
| --- | --- | --- |
| `server/` | Express 4 / TypeScript settlement engine | Railway (live money) |
| `app/` | React + Vite SPA | Vercel CDN |
| `mobile/` | Expo SDK 54 client | EAS / app stores |
| `shared/` | Types shared by server + app | — |
| `sdk/` | Published JS / PHP / Python clients | npm / packagist / PyPI |

Gate: `pnpm check` = server + mobile typecheck, **123 server test suites**, and
`scripts/test/deploy-gate.test.sh`. The server `test` script is an explicit `&&` chain, so
a new suite only runs once it is added to that chain by hand.

## 2. The production topology, as it actually is

```
            ┌──────────────────────────────────────┐
  browser ──┤ www.momome.xyz — Vercel CDN (fra1)   │  static SPA, brotli, cache HIT
            └──────────────┬───────────────────────┘
                           │ XHR to a single origin
                           ▼
            ┌──────────────────────────────────────┐
            │ momome-api-production.up.railway.app │  ONE container, numReplicas: 1
            │  Express + in-process working set    │
            │  snapshot → SQLite on a volume       │
            └──────────────┬───────────────────────┘
                           ▼
            MTN · Orange · Peexit · CamPay · PawaPay · IBEX · phoenixd
```

### 2.1 Frontend — already globally delivered

`app/vercel.json` builds to `dist` and sets `VITE_API_BASE` to the Railway API. Measured
(§PERFORMANCE_BASELINE): `server: Vercel`, `x-vercel-id: fra1::…`, `x-vercel-cache: HIT`,
`content-encoding: br`. Security headers are already set in the same file — CSP with
per-script `sha256` hashes, HSTS with `includeSubDomains`, `X-Frame-Options: DENY`,
`X-Content-Type-Options`, `Referrer-Policy`, and a `Permissions-Policy` that denies
geolocation, microphone and payment. `app/scripts/check-csp.mjs` runs in the build.

**This is the "global frontend delivery" the plan's Phase 2 asks for, and it is already in
place.** What is missing from it is asset cache policy, not reach (RISK-01).

`app/vercel.json` also carries crawler-UA rewrites: a request for `/send`, `/pay/:code`,
`/m/:code` or `/p/:id` from a known link-preview bot is rewritten to the Railway
`/share/*` renderer, so WhatsApp and the rest get OG images while humans get the SPA.

### 2.2 DNS — Hostinger nameservers, Vercel records

`momome.xyz` NS are `helios/aster.dns-parking.com` (Hostinger). `www` is a CNAME to
`…vercel-dns-017.com`; the apex A record is Vercel anycast but still answers **308 →
`https://www.momome.xyz/`**. The API host resolves to a single Railway address.

### 2.3 Backend — one stateful process, and that is the governing fact

`railway.json`: `numReplicas: 1`, `startCommand: node server/dist/server/src/index.js`,
`healthcheckPath: /health`, `restartPolicyType: ON_FAILURE`.

`server/src/core/persist.ts` states the model in its own header: *"the working set stays in
memory (no reader changes) and is snapshotted to SQLite on every mutation via touch(key).
On boot, register() rehydrates from disk."* `DB_PATH` defaults to `data/momome.db`, anchored
to the package root rather than the cwd — a comment records that a relative path once
created a second database, *"a stray ledger in a settlement system."*

**Reads therefore never touch a database.** They are served from the process heap. This
single sentence determines what Phases 3 and 4 of the plan can and cannot do (§4).

A Postgres path exists but is dark. `server/src/db/repo.ts` implements the money-critical
collections as real SQL — `claimQuote` as `DELETE … RETURNING` for a single winner, ledger
legs in one transaction, `ON CONFLICT(id)` upserts with `UNIQUE` refs for idempotency — and
says of itself: *"These are NOT yet wired into the app (that's the async-call-site
rewrite)."* `persist.ts` can snapshot to a Postgres `snapshots` table under
`STORE_BACKEND=postgres`, but that stores blobs, not queryable rows.

### 2.4 Scaling seam — present, and currently unusable

`server/src/jobs.ts:51` reads `PROCESS_ROLE` as `api` | `worker` | `all`. `index.ts:124`
describes `api` as *"a scaled-out replica"*. The seam for horizontal scaling is already
cut — but because the authoritative state is in process memory (§2.3), a second `api`
replica would serve **its own divergent copy** of balances. The role split is correct
preparation; it is not yet a licence to raise `numReplicas`.

### 2.5 Geo plumbing — present, for AML not routing

`server/src/core/geoip.ts` already prefers a CDN geo header (`cf-ipcountry`,
`x-vercel-ip-*`, generic `x-geo-*`) before falling back to a cached keyless lookup, with a
24 h TTL and a 5,000-entry cap. Its stated purpose is *"operator fraud / AML visibility"*,
and it is called fire-and-forget so payment creation is never blocked. Phase 3's "geographic
information is a routing hint, not an authorization identity" is therefore already the
module's design.

### 2.6 Jobs and consistency

`runsJobs()` drives a 30 s `reconcileTick`, a 30 s FX tick and a 15 min SMS-credit read, each
primed immediately at boot because *"a restart used to leave the money jobs idle for the
first half-minute."* Settlement is gated on an authoritative re-query rather than a posted
webhook body, and `core/momoTransfer.ts` serialises settlement per transfer id through
`settleTransferExclusive` so a webhook and the reconcile tick cannot both settle one
collection (commit `d565a68`).

### 2.7 Observability

`server/src/core/errorSink.ts` initialises Sentry when `SENTRY_DSN` is set, with
`tracesSampleRate: 0` and `sendDefaultPii: false`, every call fire-and-forget because *"the
live money path must never depend on it."* `/health` is shallow; `/health/deep`
(`app.ts:206`) returns `ok`, a `problems[]` array, store backend and durability, job tick
age and staleness, FX freshness, and per-rail counters (`samples`, `successRate`,
`avgLatencyMs`, `routable`, `funded`).

Beyond errors, there is a real metrics layer that this audit initially missed and records
here as a correction. `core/interop/metrics.ts` installs `latencyMiddleware` (`app.ts:159`)
and reports p50/p95/p99 with 4xx/5xx per normalised route class; `paymentMetrics()` derives
funnel timings and per-rail success over a window; `core/stageLatency.ts` derives
percentiles for 7 named payment stages from transition timestamps already on each payment.
Both percentile sources withhold figures below a minimum sample count instead of printing a
misleading number, and exclude in-flight payments from unfinished stages. Exposed at
`routes/v1.ts:259` and `routes/api.ts:3567`.

**What is absent is tracing and client-side measurement**, not percentiles:
`tracesSampleRate: 0` means Sentry carries errors only, no OpenTelemetry dependency exists
in any `package.json`, and there is no RUM — no `web-vitals`, `PerformanceObserver` or
beacon in `app/src` or `mobile/src`. Phase 1's trace correlation and real-user measurement
are unimplemented; its percentile requirement is already met server-side.

### 2.8 CI/CD

`.github/workflows/`: `ci.yml`, `deploy.yml` (push to `main` or a `v*` tag → test job, then
Railway deploy with `RAILWAY_TOKEN`), `mobile.yml`, and `deploy-hostinger.yml` — manual or
`v*` tag, deploying the SPA to Hostinger with `VITE_API_BASE` defaulting to
`https://mo-mo-me-server.vercel.app/api`, **the old demo backend**. See RISK-03.
`scripts/railway-rollback.sh` exists for rollback.

### 2.9 Security posture already in code

`server/src/app.ts:153` sets `trust proxy` to exactly `1` — one proxy hop, so the client IP
cannot be spoofed by an extra `X-Forwarded-For` entry. CORS is origin-restricted with an
86,400 s preflight cache. `core/ratelimit.ts` exists and is used across the public API.
Device auth is an enrolled P-256 key signing `${METHOD}\n${path}\n${ts}\n${base64(sha256(body))}`
with a single-use replay guard and a 5-minute skew window. Webhook callbacks fail closed: a
rail with no `verifyCallback` is rejected 401 rather than trusted (commit `44313d2`).

## 3. Component classification

| Component | Class |
| --- | --- |
| Vercel CDN frontend delivery, brotli, security headers, CSP check in build | **Preserve** |
| Crawler-UA share rewrites | **Preserve** |
| `trust proxy 1`, CORS allowlist, rate limiting, device signatures, fail-closed webhooks | **Preserve** |
| Settlement-on-re-query, per-id settle exclusion, idempotency keys | **Preserve** |
| `/health/deep` with per-rail counters | **Preserve** |
| `PROCESS_ROLE` seam | **Preserve** (inert until §4 lands) |
| `geoip.ts` CDN-header preference | **Preserve, reusable as a Phase 3 hint source** |
| Hashed asset cache headers | **Optimise** — RISK-01, measured |
| Apex → www redirect | **Optimise** — RISK-02, measured |
| `/api/config` 29.8 KB `no-store` on boot | **Optimise** — RISK-04 |
| Per-route + per-stage percentiles (`interop/metrics.ts`, `stageLatency.ts`) | **Preserve** — exists, and is the honest source for Phase 1 percentiles |
| Distributed tracing / OTel | **Not implemented** |
| RUM / Core Web Vitals, regional synthetic monitoring | **Not implemented** — the real Phase 1 gap |
| Postgres repos (`db/repo.ts`) | **Implemented but not wired** — the keystone gap |
| Read replicas, regional execution, geo routing | **Not implemented, and blocked** (§4) |
| `deploy-hostinger.yml` | **Review before removal** — RISK-03 |
| Cloudflare | **Not in use anywhere**; `cf-ipcountry` in `geoip.ts` is defensive only |
| Railway region, cost model | **Unknown** (§0) |

## 4. The plan's Phase 4 premise does not currently hold

The plan asks for PostgreSQL regional read replicas with reads classified A–E and routed to
replicas or the primary. Against this codebase:

1. **Replicas cannot serve reads, because reads do not query a database.** They come from
   the heap of one process (§2.3). A replica would have no reader.
2. **Regional API execution would fork the ledger.** Each regional process would rehydrate
   its own snapshot and accept writes into its own memory, producing exactly the *"competing
   authoritative account balances"* the plan's Phase 4 forbids.
3. **Class B/C read routing has no target.** The distinction needs a SQL reader to point at.

So the ordering must invert. The async call-site rewrite that wires `db/repo.ts` into the
app — already begun on the `vercel-backend` branch — is the **precondition** for Phases 3
and 4, not a parallel track. Until it lands, every regional-infrastructure task is blocked,
and the honest Phase 0 recommendation is to spend nothing on regions.

This is a sequencing finding, not an objection to the goal.

## 5. What the measurements say about priority

The plan's own Phase 1 rule is to justify every regional deployment with evidence. The
evidence currently points away from geography:

- Network RTT to the API is **~200 ms** from this vantage; TLS adds ~2 RTT (§PERFORMANCE_BASELINE).
- `/health/deep` at the time of audit reported Peexit at **49.1 % success over 112 samples,
  average latency 286,134 ms** — and Peexit was the **only** rail with both `routable: true`
  and `funded: true`. CamPay reported `funded: false` with the recorded problem *"campay
  holds an amount, none of it on an MTN or Orange float"*; PawaPay `routable: false`.

A payout path averaging **286 seconds** is three orders of magnitude larger than a 200 ms
RTT, and it currently has no second rail behind it. Multi-region work cannot move that term.
Allocating the CamPay float and resolving the Peexit Orange failures is the highest-value
reliability work available, and it is operator action, not engineering.

## 6. Exit gate

Inventory verified and classified (§3). Prioritised plan: RISK-01/02/04 are measured,
cheap and independent of everything else; the async rewire gates Phases 3–4; regional
spend is not justified by present evidence. Nothing was deleted, deployed or reconfigured.
