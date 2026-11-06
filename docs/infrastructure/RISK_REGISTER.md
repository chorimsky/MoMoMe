# Phase 0 — Risk register

**Date:** 2026-11-06 · **Commit:** `9e4e6e3`

Severity is about money and availability, not elegance. "Verified" means this audit
observed it directly; "unverified" means it needs access this audit did not have.

## Register

| ID | Risk | Sev | Status | Owner |
| --- | --- | --- | --- | --- |
| RISK-00 | One routable+funded payout rail, at ~49 % success | **Critical** | Verified | Operator |
| RISK-01 | Hashed assets served `max-age=0, must-revalidate` | Medium | **Fixed** `app/vercel.json` (pending deploy) | Engineering |
| RISK-02 | Apex `momome.xyz` costs a second full connection | Low | Verified — **operator action** | Operator |
| RISK-03 | A `v*` tag also fires a Hostinger deploy pointed at the old demo backend | **High** | Partly verified | Engineering |
| RISK-04 | `/api/config` 29.8 KB, `no-store`, on every boot | Low | Verified, review only | Engineering |
| RISK-05 | Single container, `numReplicas: 1`, in-memory authoritative state | **High** | Verified | Engineering |
| RISK-06 | SQLite ledger on one volume with **no backup of any kind** | **High** | Verifier + routine shipped 2026-11-06; **taking the backups is the operator's** | Operator |
| RISK-07 | No distributed tracing; no real-user/regional measurement (server percentiles **do** exist) | Medium | Corrected 2026-11-06 | Engineering |
| RISK-08 | Premature regional expansion would fork the ledger | **Critical if attempted** | Verified by design | Engineering |
| RISK-09 | `node_modules` is hoisted, not isolated | Low | Verified | Engineering |
| RISK-10 | Legacy unsigned-device window expired 2026-11-01 | Medium | Verified | Operator |
| RISK-11 | DNS single-provider (Hostinger), no secondary | Low | Verified | Operator |
| RISK-12 | Data residency for CEMAC not established | **High (legal)** | Unverified | Operator + counsel |
| RISK-14 | Every push to `main` deploys the live money API **ungated** — the gate lives in a GitHub workflow that cannot run | **Critical** | Verified twice empirically | Engineering + Operator |
| RISK-15 | GitHub Actions has been dead since ~2026-09-19 (account billing lock) — no CI on any commit | **High** | Verified 2026-11-06 | Operator |
| RISK-13 | `trust proxy 1` is wrong for Railway: `req.ip` is not the client, so every IP rate limit is inert and the audit log's IP is wrong | **High** | **Fixed** `core/trustProxy.ts` — pending production confirmation | Engineering |

## Detail on the ones that change a decision

### RISK-00 — the only rail that works, half-works

`/health/deep`: peexit 112 samples, **49.1 %** success, **286,134 ms** average, the only
rail with `routable: true` **and** `funded: true`. CamPay `funded: false` with the recorded
problem *"campay holds an amount, none of it on an MTN or Orange float"*; PawaPay
`routable: false`, 0 samples. `"ok": false`, `"open critical alert"`.

Routing and failover logic are built and correct; they have nowhere to fail over to.
**Mitigation is operator action, not code:** allocate the CamPay carrier float, and send
`docs/ops/PEEXIT_ORANGE_MESSAGE.md` with live `track_id`s. This outranks everything else in
this register and everything in the global-edge plan.

### RISK-01 — fixed in config, verifiable after deploy

`app/vercel.json` now carries a `/assets/(.*)` rule setting
`Cache-Control: public, max-age=31536000, immutable`, inserted ahead of the existing
`/(.*)` security block. Vercel applies every matching rule, so the CSP, HSTS and the rest
still cover `/assets/*`; the new entry adds only `Cache-Control` and overrides none of them.

The match is deliberately narrow — `/assets/` is Vite's content-hashed output directory,
and nothing else. Verified by pattern against the live paths:

| Path | Effect |
| --- | --- |
| `/assets/index-*.js`, `/assets/index-*.css` | immutable, 1 year |
| `/sw.js`, `/index.html`, `/`, `/manifest.webmanifest`, `/favicon.svg` | **unchanged** |

That exclusion is the point, not an accident. A long-cached `sw.js` or `index.html` would
pin a browser to a stale build with no way to recover it remotely — far worse than the
revalidation this fixes. Only filenames whose contents cannot change are made immutable.

Confirm after deploy with:

```bash
curl -sI https://www.momome.xyz/assets/index-SKWHsyXS.js | grep -i cache-control
```

(substituting the hash from the newly built `index.html`, since the bundle name changes
with each build).

### RISK-02 — not fixable from the repository

The 308 is **not** in version control: `app/vercel.json` has no `redirects` key, and no
redirect config exists anywhere under `app/`. The apex-to-`www` behaviour comes from the
Vercel project's own domain settings, which this audit could not reach (the Vercel
connector in this session is unauthenticated).

So this one is operator action: in the Vercel project's Domains panel, either serve the SPA
on the apex directly or make `momome.xyz` the primary domain. It is worth doing — it is a
whole TLS handshake on a ~200 ms link — but no code change here can accomplish it.

### RISK-03 — a release tag can deploy a second frontend at the wrong backend

`deploy-hostinger.yml` triggers on `push: tags: ["v*"]` with `VITE_API_BASE` defaulting to
`https://mo-mo-me-server.vercel.app/api` — the **old demo backend**, not Railway. The same
tag also fires `deploy.yml`. DNS currently points `www.momome.xyz` at Vercel, so a Hostinger
deploy would likely land somewhere no longer serving the domain — which is why this is
*probably* inert.

But "probably inert" is doing a lot of work in a system that moves money. The failure, if
the Hostinger host *is* still reachable at any name a user has, is a live SPA talking to a
demo backend: balances and payment states that are fiction. **Unverified** because the
Hostinger account was not accessible.

Recommended: confirm whether the Hostinger target still serves anything; if not, delete the
workflow; if it does, remove the `v*` trigger and the demo default regardless. Do not leave
a tag push able to publish a second frontend.

### RISK-05 / RISK-08 — the single process, and why not to "fix" it by going regional

`railway.json` sets `numReplicas: 1`. `core/persist.ts` keeps the authoritative working set
in process memory. `core/momoTransfer.ts` serialises settlement through an **in-process**
promise map.

Today this is coherent: one process, one writer, one lock, correct. The danger is the
*apparent* easy upgrade — raise replicas, or add a region — which would give each instance
its own balances and its own settlement lock. That is the plan's own prohibition on
*"independent regional writes creating competing authoritative account balances"*, and the
architecture would walk into it silently, with no error, producing divergent ledgers.

**Therefore RISK-08 is latent, not active — and it activates the moment someone acts on the
global-edge plan in its stated order.** Phases 3 and 4 must wait on the async call-site
rewrite that wires `server/src/db/repo.ts` (already correct, already tested in isolation)
into the app. That is the keystone task. Sequencing note: the plan's "do not introduce
complexity without evidence" and this finding agree.

### RISK-07 — restated, after an error in the first revision

The first revision of this register said there was "no percentile latency". **That was
wrong**, and the correction matters because it changes what Phase 1 needs to build.

What already exists: `core/interop/metrics.ts` times every request and reports p50/p95/p99
with 4xx/5xx counts per normalised route class (`routeClass()` collapses ids so per-payment
paths cannot explode the table), over bounded 2,000-sample rings. `core/stageLatency.ts`
derives per-stage percentiles for 7 stages of the payment lifecycle from timestamps already
on each payment, explicitly *"DERIVED, NOT INSTRUMENTED … adding stopwatches to the
settlement engine would be new writes on the money path to learn something the history
already knows."* Both withhold figures below a sample threshold rather than printing a
number — `stageLatency.ts` states the rule as *"a percentile over a handful of samples is
noise wearing a number"* — and in-flight payments are excluded from stages they have not
finished, so a stuck stage cannot be flattered.

That is a better observability posture than the plan assumes, and it is the house rule this
audit should have checked for before asserting an absence.

What is genuinely missing, and is therefore the real Phase 1 scope:

**Second correction, same class of error.** The first revision said there was no
client-side beacon at all. There is: `app/src/lib/analytics.ts` posts to `/api/telemetry`
on a timer and on page-hide — anonymous visitor/session ids in local storage, route-class
views, named actions, timezone, language, screen class, referrer host; it honours DNT and
excludes `/admin` and `/ops`. This audit's grep was for `web-vitals|PerformanceObserver|
largest-contentful`, which a custom event-telemetry module could not match. Twice now an
absence has been asserted from a search that could not have found the thing.

What `analytics.ts` does **not** collect is any timing: no navigation timings, no
`PerformanceObserver`, no LCP/INP/CLS (verified — the file has no occurrence of
`performance`, `timing`, `lcp`, `cls` or `inp`). So the gap is real, but it is narrower
than stated: the product-analytics channel exists and works, and what was missing is
**performance** measurement over it.

| Gap | Verified by |
| --- | --- |
| **Core Web Vitals / navigation timings from real users** | `analytics.ts` collects events, never timings — no `performance`/`lcp`/`cls`/`inp` anywhere in it |
| **Distributed tracing** | No OpenTelemetry dependency in any `package.json`; Sentry runs `tracesSampleRate: 0` |
| **Any measurement outside one machine** | No synthetic probes; no regional vantage points |

The RUM gap is the important one. Server percentiles measure our own time; they cannot see
DNS, TLS, or the last mile on a Cameroonian mobile network — which is where §1's measured
~200 ms RTT and ~0.88 s trivial-request cost actually live. The plan is right to prefer
real-user data over synthetic, and RUM from real users is the only way this project will
ever get African network figures.

### RISK-14 / RISK-15 — the gate is not in the path, and CI has been dead for seven weeks

`docs/OPERATIONS.md` §3 recorded on 2026-09-20 that *"GitHub Actions is not running at all:
every run since at least 2026-09-19 fails in 0–4 s with 'The job was not started because
your account is locked due to a billing issue.'"* **This is still true.** The Deploy run for
commit `22e0af4`, pushed during this session, carries the same annotation and its `test` job
failed in 2 s with 0 steps; `deploy` was skipped.

And yet production moved to `22e0af4` within minutes of the push — observed on
`/health/deep`, twice in this session (`9e4e6e3` and `22e0af4`). So:

| | |
| --- | --- |
| `deploy.yml` — test, then Railway deploy, then gate, then rollback on failure | **never runs** |
| Railway | deploys from Git on every push to `main` |

**The consequence: a push to `main` reaches the live money API with no gate, no test run and
no automatic rollback.** The protections described in OPERATIONS.md §3 — "Both run the gate
(deep health 200 with the deployed SHA + a synthetic quote) and roll back to the previous
SUCCESS deployment if it fails" — are real code in a workflow that cannot execute. The only
thing standing between an edit and production money is whoever remembers to run
`pnpm check` locally.

That also makes OPERATIONS.md §3's own note *"the API from Railway by upload only (no Git
integration)"* **out of date**: Git integration is evidently on now, which is what turned a
dead CI pipeline from an inconvenience into an ungated path to production.

**And RISK-03 is sharper than first recorded.** The reason a `v*` tag does not currently
publish a second frontend at the old demo backend is **not** that DNS moved — it is that
Actions cannot run. Fixing the billing lock would re-enable `deploy-hostinger.yml` and its
`VITE_API_BASE` default of `https://mo-mo-me-server.vercel.app/api` at the same moment. The
two findings are coupled: **whoever fixes GitHub billing should delete or re-point that
workflow in the same change**, or the first `v*` tag afterwards publishes a live SPA wired
to a demo backend.

Recommended order, and none of it is mine to do alone:

1. Fix the GitHub billing lock (operator) — but *first* close RISK-03, because fixing
   billing arms it.
2. Decide whether Railway should auto-deploy `main` at all. A gate that is not in the path
   is not a gate; either put the deploy behind the workflow again, or move the gate to a
   Railway pre-deploy step so it runs where the deploy actually happens.
3. Until then, treat `main` as production and run `pnpm check` before every push. That is
   what was done for every commit in this session, but it is a habit, not a control.

### RISK-13 — the proxy hop count, and what it silently switches off

Found while verifying the new RUM endpoint's own rate limit in production. It did not
engage: 80 requests, then 75 more with a constant `X-Forwarded-For`, and not one 429.

**It is not the new route.** `/lnurl/pay/:user` (limit 30/min, in the codebase long before
this) was used as a control and also never throttled — 45 requests, no 429. So no
in-memory IP rate limit engages in production, on any route.

**Mechanism, proven locally** against the same code with simulated proxy chains, using the
limiter itself as the oracle:

| Experiment | Result | Conclusion |
| --- | --- | --- |
| Constant single-entry XFF | **429 at request 61** (limit 60) | the limiter works |
| Two entries, **last** varies | never throttled | `req.ip` is the **rightmost** entry |
| Two entries, **first** varies, last constant | **429 at request 61** | the real client is ignored |

`app.ts:153` sets `trust proxy` to `1`, and its comment states the intent exactly right:
*"trust it so req.ip is the real client IP (rate limiting, webhook IP allowlist), not a
spoofable XFF."* With Express, `1` means "one proxy in front", so `req.ip` is the rightmost
`X-Forwarded-For` entry. That is correct for a single hop. Production evidently has **two**:
a constant client-supplied XFF still produced no throttling, which means the rightmost entry
in production is not the caller and varies per request — consistent with a Railway internal
hop appended after the edge.

**What this switches off, none of it visibly:**

| Depends on `clientIp()` | Consequence |
| --- | --- |
| Every `rateLimitMiddleware` route — `/api/rum`, `/lnurl/pay`, `/api/telemetry`, `/api/payments/:id/confirm`, `/api/momo/transfers`, `/api/merchant`, vault writes, `/api/preview` | No IP throttle at all. Each caps per-IP, and there is no per-IP. |
| `identityV2.ts:66` enumeration guard | A number-enumeration limit keyed on an address that is not the caller's. |
| `platformAdmin.ts` — ~12 `audit({ … ip: clientIp(req) })` calls | **Every operator action is recorded against the wrong IP.** In a system with ANIF/COBAC reporting duties, an audit trail that attributes actions to an infrastructure address is a compliance problem, not a cosmetic one. |

**Not as bad as it looks in one place, and worth saying so:** admin login uses
`rateLimitDurable` keyed **both** `login:ip:…` and `login:user:…`. The IP half is inert, but
the per-username half still holds, so password brute-force remains bounded per account.

**The fix: a predicate, not a count.** `core/trustProxy.ts` trusts exactly the internal
ranges — loopback, the three RFC-1918 blocks, link-local, CGNAT (RFC 6598, which PaaS
internal networks commonly use) and the IPv6 equivalents, unwrapping IPv4-mapped IPv6
first. Express walks from the socket leftwards and stops at the first address it is not
told to trust, so it skips however many of our own hops exist.

A hop count was rejected deliberately. Too low and `req.ip` is our own proxy — today's bug,
controls silently off. Too high and Express walks **past** the real client into
attacker-supplied bytes, making the address **client-spoofable**: a forged IP written into
the audit log and used to evade limits, which is worse than no IP at all. Both errors are
silent, and the right count is a property of the platform's current topology rather than of
our code.

**Why the predicate is not more spoofable than what it replaced.** A client that sends
`X-Forwarded-For: 1.2.3.4` has its real address appended by the platform, so the chain
reads `1.2.3.4, <real client>, <our hop>`. Walking from the right, the internal hop is
skipped and `<real client>` is where it stops — the forgery sits to the LEFT of the truth
and is never reached. `test/trust-proxy.test.ts` pins this: rotating a forged left entry
still throttles at request 61.

**What it cannot do.** If a platform hop ever appears as a *public* address, this returns
that address — exactly what `1` did. No regression, but no fix either.

**Confirmation is empirical, and the limiter is its own oracle** — the same method that
found the bug. After deploy, send more than 60 requests to `/api/rum` from one machine: a
429 means `req.ip` is now the caller. That needs no header dump and no dashboard.

36 assertions, wired into the gate chain.

### RISK-06 — narrowed, after reading the runbook this audit should have read first

The first revision said no restore had ever been tested. **That was overstated**, and the
correction came from `docs/OPERATIONS.md`, which this audit failed to read during discovery
— the fourth time in this review an absence was asserted from a search that could not have
found the thing (a `find` for `*RUNBOOK*` does not match `OPERATIONS.md`).

What is actually there: §1 documents the SQLite→Postgres cutover with
`scripts/migrate-sqlite-to-postgres.ts`, and records a rehearsal on **2026-09-17** against a
local Postgres 15 — 65 snapshot keys and 7 payments migrated, server booted on
`STORE_BACKEND=postgres`, a payment taken through to DELIVERED with 9 ledger legs as rows,
**restart survived**, a `PROCESS_ROLE=api` replica served without running jobs, and two
`all` instances ticked under the advisory lock without overlapping. That is a genuine
end-to-end drill, and it also means the multi-instance path is designed and rehearsed, not
hypothetical — it is gated on the Postgres cutover, exactly as this audit concluded
independently in EXISTING_ARCHITECTURE §4.

**What remains true, and is the actual risk:** that drill rehearsed a *migration*, not a
*backup* of today's store. Production still runs `store.backend: sqlite` (confirmed on
`/health/deep` today). Nothing in the repository backs that file up: the only `copyFileSync`
is a one-off pre-clean-sheet copy to the **same volume**, and there is no scheduled dump, no
`VACUUM INTO`, no off-host copy, and no `backup` reference in `jobs.ts` or `cron.ts`. The
"enable automated backups / point-in-time recovery" step in §1 is a provisioning instruction
for the Postgres that has not been cut over to yet.

So: the ledger of a live money system sits on one volume with no backup, and the documented
path off it is a migration the operator has not yet performed. The restore drill exists;
what is missing is anything to restore **from**.

**What shipped for this (2026-11-06).** `server/scripts/verify-backup.ts` plus
`docs/OPERATIONS.md` §9 — a weekly download routine and a verifier that answers the question
a download leaves open: *if we had to come back from this file, would the money still add
up?* It checks that the file opens, that every snapshot parses, that **every ledger journal
balances per currency**, that the ref index resolves in both directions, and that the
compliance hash chain is unbroken. Exit 0/1/2 so it can run unattended.

Honest about its limits: it proves a file is **coherent**, never that it is **recent**, and
it cannot take a backup. Nothing here removes the operator step — Railway volume download —
and until the Postgres cutover in §1 the ledger still has a single copy on a single volume.
This closes the "we would not know whether a restore works" half of the risk, not the "there
is nothing to restore from" half.

### RISK-12 — residency is a legal question, not a routing one

`docs/compliance/` records the Cameroon/CEMAC map: Règlement 02/24, ANIF STR obligations,
BEAC Instruction 002/2026, the COBAC crypto position. The compliance engine with
hash-chained tamper-evident records is built.

What is **not** established is where regulated customer and transaction data may lawfully be
stored, replicated or processed. The service currently runs from one region (observed
`fra1` for the CDN; Railway region unknown — itself a residency finding). Any replica in
any new jurisdiction is a legal act before it is a technical one. The plan is right that
*"geographic routing or encryption alone"* does not establish compliance. This needs counsel,
before any replica is created.

## Approval gates — actions this audit will not take without explicit authorisation

Per the plan's Phase 6 and this project's standing rules:

- Changing production DNS
- Creating production database replicas, or promoting one
- Moving regulated data across jurisdictions
- Rotating production secrets
- Destructive migrations
- Changing payment authorisation or settlement routing
- Raising `numReplicas` above 1 (RISK-05/08)
- Incurring new cloud cost in any provider
- Deleting `deploy-hostinger.yml` or any component classified "review before removal"

## Recommended order, on this evidence

1. **RISK-00** — CamPay float, Peexit Orange message. Operator. Outranks all engineering.
2. **RISK-13** — establish the real client IP. One header read decides it; it silently
   disables every IP limit and corrupts the operator audit trail.
3. **RISK-06** — prove a restore. Highest-severity item engineering can act on.
4. **RISK-03** — close the tag-triggered second frontend.
5. **RISK-01** — deployed 2026-11-06 (`22e0af4`). **RISK-02** — operator, Vercel Domains panel.
6. **RISK-07** — RUM shipped `22e0af4`; tracing (server percentiles already exist), so Phase 1 can be satisfied honestly.
7. **The async rewire** — the precondition for Phases 3–4.
8. **Regional work** — only after 6 and 7, and only if the numbers from 5 justify it.

Note what this ordering does: it puts four items that cost almost nothing, plus one legal
question, ahead of the entire multi-region programme — because none of the regional work
can be justified, or even safely built, until they are done.
