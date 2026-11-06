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
| RISK-06 | SQLite on one volume; no verified backup/restore drill | **High** | Unverified | Operator |
| RISK-07 | No distributed tracing; no real-user/regional measurement (server percentiles **do** exist) | Medium | Corrected 2026-11-06 | Engineering |
| RISK-08 | Premature regional expansion would fork the ledger | **Critical if attempted** | Verified by design | Engineering |
| RISK-09 | `node_modules` is hoisted, not isolated | Low | Verified | Engineering |
| RISK-10 | Legacy unsigned-device window expired 2026-11-01 | Medium | Verified | Operator |
| RISK-11 | DNS single-provider (Hostinger), no secondary | Low | Verified | Operator |
| RISK-12 | Data residency for CEMAC not established | **High (legal)** | Unverified | Operator + counsel |

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

### RISK-06 — the thing that would actually lose money

A single SQLite file on a single Railway volume holds the ledger. This audit could not
reach the volume, so the following are **unknown**: file size and growth, volume headroom,
whether backups run, where they go, their retention, and **whether a restore has ever been
tested**. `persist.ts` does `copyFileSync` for snapshot safety, which is not the same as an
off-host backup.

An untested restore is not a backup. Against a container that can be redeployed at any
time, this is the highest-severity item that engineering can actually act on — and it is
cheaper than any phase of the global-edge plan.

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
2. **RISK-06** — prove a restore. Highest-severity item engineering can act on.
3. **RISK-03** — close the tag-triggered second frontend.
4. **RISK-01** — done, awaiting deploy. **RISK-02** — operator, Vercel Domains panel.
5. **RISK-07** — RUM and tracing (server percentiles already exist), so Phase 1 can be satisfied honestly.
6. **The async rewire** — the precondition for Phases 3–4.
7. **Regional work** — only after 5 and 6, and only if the numbers from 5 justify it.

Note what this ordering does: it puts four items that cost almost nothing, plus one legal
question, ahead of the entire multi-region programme — because none of the regional work
can be justified, or even safely built, until they are done.
