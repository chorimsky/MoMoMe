# Phase 0 — Dependency map

**Date:** 2026-11-06 · **Commit:** `9e4e6e3` · Sources: `*/package.json`, `railway.json`,
`app/vercel.json`, `server/vercel.json`, `.github/workflows/`, live DNS, `/health/deep`.

## 1. Hosting and network path

| Hop | Provider | Evidence | Single point of failure? |
| --- | --- | --- | --- |
| DNS for `momome.xyz` | **Hostinger** (`helios/aster.dns-parking.com`) | `dig NS` | Yes |
| `www` → SPA | **Vercel** CDN, observed `fra1` | `server: Vercel`, `x-vercel-id` | No (anycast) |
| Apex → `www` | Vercel, 308 | `dig A`, `curl -D-` | — |
| API | **Railway**, one container, `numReplicas: 1` | `railway.json` | **Yes** |
| State | SQLite on a Railway volume + process memory | `core/persist.ts` | **Yes** |
| Mobile delivery | Expo EAS / app stores | `mobile/`, `.github/workflows/mobile.yml` | — |

**Cloudflare is not used anywhere.** The only occurrence of the string in the repo is the
defensive `cf-ipcountry` header read in `server/src/core/geoip.ts`. The plan's Cloudflare
Pages/Workers options would introduce a new vendor in front of an edge that Vercel already
provides; that is a cost and complexity decision, not a gap to be filled.

## 2. Runtime dependencies — `server/`

| Package | Version | Role | Money path? |
| --- | --- | --- | --- |
| `express` | ^4.21.2 | HTTP | Yes |
| `pg` | ^8.23.0 | Postgres client | **Present, not wired** (`db/repo.ts`) |
| `undici` | ^8.10.2 | Outbound HTTP to rails | Yes |
| `libphonenumber-js` | ^1.13.13 | MSISDN normalisation | Yes — wrong parse = wrong recipient |
| `@sentry/node` | ^10.75.0 | Error sink, `tracesSampleRate: 0` | No (fire-and-forget by design) |
| `cors` | ^2.8.5 | Origin allowlist | Boundary |
| `qrcode` | ^1.5.4 | Payment QR rendering | Yes |
| `ogg-opus-decoder` | ^1.7.5 | Voice note decode | No |
| `@vercel/functions` | ^3.9.2 | Serverless shims (Vercel target) | No — unused on Railway |

Persistence uses **`node:sqlite`**, a Node built-in, loaded via `createRequire` so a
missing or flag-gated module is catchable; it degrades to in-memory rather than failing.
There is no SQLite npm dependency to audit or upgrade.

`@vercel/functions` is the sole reason `zod` entered the tree
(`server > @vercel/functions > @vercel/oidc > @vercel/cli-config > zod`). Importing
`@vercel/functions` loads 15 modules, none of them zod; it is pinned patched anyway
(commit `9e4e6e3`).

## 3. Build dependencies — `app/`

Build chain: `gen-icons → tsc --noEmit → vite build → generate-seo → check-csp`.
`satori` + `@resvg/resvg-js` render the OG share cards at build time, invoked by
`generate-seo.mjs` (**not** by `scripts/og.mjs`, which defines `renderOgImages` and never
calls it — running that file directly exits 0 having done nothing).

`pnpm audit`: **clean** at `9e4e6e3`. Root `pnpm.overrides` pins `body-parser`, `qs`,
`postcss`, `browserslist`, `proxy-addr`, `source-map-js`, `fflate`, `zod`.

**Layout note:** `node_modules/.pnpm/` contains only `lock.yaml`, and packages sit as real
directories at `node_modules/<pkg>`. This is a hoisted, non-isolated layout rather than
pnpm's default symlinked store. Installed versions are correct and `pnpm audit` reads the
lockfile, so nothing is wrong today — but strict dependency isolation is **not** enforced
here, so a package could import something it never declared and tests would still pass.
Unverified whether this is deliberate.

## 4. External services — every one a third party on the money path

| Service | Purpose | Failure mode observed / designed |
| --- | --- | --- |
| **Peexit** | MoMo payout (MTN working, Orange failing) | 49.1 % success / 286 s avg over 112 samples |
| **CamPay** | MoMo payout | `funded: false` — balance held, none on an MTN/Orange float |
| **PawaPay** | Multi-market payout | `routable: false`, 0 samples |
| **MTN / Orange** | Carrier rails behind the aggregators | Callback auth fails closed (401) |
| **IBEX Hub** | Lightning + stablecoin, OAuth2; also the FX source | FX cached, `fresh` flag on `/health/deep` |
| **phoenixd** | Own Lightning node, LUD-06 `description_hash` | Operator-owned service |
| **NEXAH** | SMS, verification codes only | Credit read every 15 min; failure ⇒ **UNKNOWN, not zero** |
| **WhatsApp / Meta AI** | Bot channel | Non-money |
| **Sentry** | Errors | Optional; silent without `SENTRY_DSN` |

Risk concentration: with CamPay unfunded and PawaPay unroutable, **Peexit is the only
routable+funded payout rail**, at ~49 % success. The balance-aware routing and `railHealth`
failover logic exist and are correct; they have nothing to fail over *to*.

## 5. CI/CD and secret dependencies

| Workflow | Trigger | Target | Secret |
| --- | --- | --- | --- |
| `ci.yml` | push / PR | gate only | — |
| `deploy.yml` | push to `main`, `v*` tag, manual | **Railway** | `RAILWAY_TOKEN` |
| `deploy-hostinger.yml` | manual, **`v*` tag** | Hostinger SPA | Hostinger creds |
| `mobile.yml` | — | EAS | Expo token |

`deploy.yml` gates on its `test` job before deploying. `scripts/railway-rollback.sh` is the
rollback path. A `v*` tag fires **both** `deploy.yml` and `deploy-hostinger.yml` — see
RISK-03.

## 6. What depends on the single-process assumption

These would each need rework before a second backend instance could run anywhere, and so
they are the real contents of the "multi-region" work item:

| Thing | Where | Why it is single-process |
| --- | --- | --- |
| Authoritative balances and ledger | `core/persist.ts`, `core/store.ts`, `core/ledger.ts` | Working set in heap; SQLite is a snapshot target |
| Settlement exclusion | `core/momoTransfer.ts` `settleTransferExclusive` | In-process `Map` of in-flight promises — not a distributed lock |
| Quote single-winner claim | in-memory today; SQL version in `db/repo.ts` | Correct version exists, unwired |
| Device replay guard | device-auth single-use nonce store | In-memory |
| FX cache, geoip cache, SMS credit, rail health | `core/fx.ts`, `geoip.ts`, `rates.ts` | Per-process caches |
| Job scheduling | `jobs.ts` + `PROCESS_ROLE`, job lock | Role split exists; lock needed for >1 worker |

`settleTransferExclusive` deserves emphasis: it is an in-process promise map. It makes the
*current* single container correct. A second instance would silently lose that guarantee —
the exact failure the plan's Phase 4 names as unacceptable for a ledger.
