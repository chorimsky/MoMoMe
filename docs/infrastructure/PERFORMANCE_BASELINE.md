# Phase 0 — Performance baseline

**Date:** 2026-11-06 · **Commit:** `9e4e6e3` · **Tool:** `curl` write-out timings,
3 consecutive samples per URL, unauthenticated.

## 0. The limit of this baseline — read first

**Every figure here was taken from one machine, on one network, at one time of day.**
There is no multi-region measurement, no real-user monitoring, and no measurement from an
African mobile network. The plan's Phase 1 asks for Central Africa, West Africa, Europe,
North America and Asia-Pacific; **none of those exist yet** and none is fabricated below.

The first sample in each set includes cold DNS (~0.35–0.46 s). Samples 2–3 are warm and are
what the figures below quote. Three samples cannot produce a p95 or p99: the plan asks for
percentiles and this baseline **does not supply them**. Treat what follows as a first
fixed point, not as a latency matrix.

## 1. Measured — warm samples

### API · `momome-api-production.up.railway.app`

| Endpoint | TCP connect | TLS done | TTFB | Total | Bytes |
| --- | --- | --- | --- | --- | --- |
| `/health` | 0.214 s | 0.456 s | 0.876 s | 0.877 s | 60 |
| `/health` | 0.269 s | 0.509 s | 0.952 s | 0.953 s | 60 |
| `/api/config` | 0.215 s | 0.548 s | 0.916 s | 1.205 s | 29,829 |
| `/api/config` | 0.205 s | 0.474 s | 0.943 s | 1.179 s | 29,829 |

Decomposition of the warm `/health` request, which returns a 60-byte constant and so is
almost pure network:

| Segment | Cost | Reading |
| --- | --- | --- |
| TCP handshake | ~0.21 s | **one RTT ≈ 200 ms** |
| TLS handshake | ~0.25 s | ~2 further RTT |
| Request → first byte | ~0.42 s | ~1 RTT + server time |
| **Total** | **~0.88 s** | ~4 round trips on a trivial endpoint |

**The dominant term is distance, not server work.** A 60-byte response taking 0.88 s is a
geography cost. This is the one finding that genuinely supports the plan's premise — and it
is also why the cheap fixes in §2 matter more than they look, since each removes whole round
trips rather than milliseconds.

### Frontend · `www.momome.xyz` (Vercel, `fra1`)

| Resource | TLS done | TTFB | Total | Bytes on wire | Encoding | Edge cache |
| --- | --- | --- | --- | --- | --- | --- |
| `/` (warm) | 0.401 s | 0.575 s | 0.578 s | 3,141 (8,857 raw) | `br` | **HIT** |
| `/` (warm) | 0.435 s | 0.612 s | 0.613 s | 3,141 | `br` | HIT |
| `/assets/index-SKWHsyXS.js` | — | 0.956 s | 1.460 s | **195,666** | `br` | **MISS** |
| `/assets/index-BGgYYQUy.css` | — | 0.733 s | 0.735 s | 8,785 | `br` | **MISS** |

Apex: `https://momome.xyz/` answers **308 → `https://www.momome.xyz/`** in ~0.61–0.91 s
before any content is fetched.

## 2. What the numbers show, with the evidence attached

### F-1 · Immutable assets are served as if they were volatile — the largest cheap win

```
/assets/index-SKWHsyXS.js  →  cache-control: public, max-age=0, must-revalidate
```

The filename is content-hashed, so its bytes can never change under that URL — the standard
policy is `max-age=31536000, immutable`. As served, **every page load revalidates the
196 KB main bundle**, and `x-vercel-cache: MISS` on both assets shows the edge is not
holding them either. On a link where one RTT is ~200 ms, this spends round trips on bytes
the browser already has.

`app/vercel.json` has a `headers` block, but its only entry is `source: "/(.*)"` carrying
the security headers; there is no `/assets/*` cache rule, and the build uses a custom
`buildCommand`/`outputDirectory` rather than a detected framework preset, so no preset
default applies.

Fix: one `headers` entry. No code change, no infrastructure, immediately reversible.

### F-2 · The apex costs a full extra connection

A user typing `momome.xyz` pays DNS + TCP + TLS + the 308, then repeats DNS + TCP + TLS for
`www`. At ~200 ms RTT that is roughly **0.6–0.9 s before the first byte of HTML**. Serving
the SPA on the apex, or redirecting at the DNS/edge layer rather than after a TLS
handshake, removes it.

### F-3 · `/api/config` is 29.8 KB and `no-store`

```
cache-control: no-store · vary: Origin, accept-encoding · content-encoding: gzip
```

Compression is correct and applied. But 29.8 KB uncompressed is re-fetched on every app
boot with no caching permitted. Whether any of it is cacheable depends on what it carries
(it includes operator brand data, which is why `no-store` may well be deliberate) — so this
is **flagged for review, not for change**. Splitting a long-lived public part from a
per-session part would remove a boot round trip, but only if that split is genuinely safe.

### F-4 · The real bottleneck is a payout rail, not the network

From `/health/deep` at audit time:

| Rail | Samples | Success | Avg latency | Routable | Funded |
| --- | --- | --- | --- | --- | --- |
| peexit | 112 | **49.1 %** | **286,134 ms** | true | true |
| campay | 0 | null | null | false | **false** |
| pawapay | 0 | null | null | false | — |

`"ok": false`, with problems `"funds not allocated to a carrier float: campay holds an
amount, none of it on an MTN or Orange float"` and `"open critical alert"`.

**286 seconds is ~1,400× the 200 ms RTT this whole document is otherwise about**, on the
only rail that is both routable and funded. No infrastructure change improves it. Stating
it here so that no later phase can present a regional latency gain as if it had moved the
number users actually feel.

## 3. Instrumentation gaps blocking a real Phase 1

**Correction (2026-11-06, after first publication):** an earlier revision of this table
said p50/p95/p99 collection was absent. **That was wrong.** It rested on a grep for
`@sentry|opentelemetry|otel`, which could not have found what does exist. Server-side
percentiles are implemented and exposed; the table below is corrected, and the server-side
figures are now the best source for §1's missing percentiles — far better than the three
curl samples above.

| Required by the plan | Status |
| --- | --- |
| p50 / p95 / p99 API latency | **Implemented.** `core/interop/metrics.ts` — `latencyMiddleware` times every request and `latencyReport()` returns p50/p95/p99 + 4xx/5xx per normalised route class, over 2,000-sample bounded rings capped at 300 routes. Exposed via `observability()` at `routes/v1.ts:259`. |
| Per-stage payment percentiles | **Implemented.** `core/stageLatency.ts` derives p50/p95/p99 for 7 named stages from the transition timestamps already on each payment — no new writes on the money path. Exposed at `routes/api.ts:3567`. |
| Real-user monitoring | **Partly present, then extended.** `app/src/lib/analytics.ts` already beacons product events to `/api/telemetry` (anonymous ids, route-class views, actions; DNT honoured; `/admin` and `/ops` excluded) but collects **no timings**. Performance RUM added 2026-11-06 as `app/src/lib/rum.ts` → `POST /api/rum` → `server/src/core/rum.ts`. |
| Core Web Vitals (LCP, INP, CLS) | **Absent.** |
| Multi-region synthetic probes | **Absent.** Single vantage only. |
| African mobile-network measurement | **Absent.** The plan rightly warns a nearby cloud region may not be the fastest route; unverifiable from here. |
| OpenTelemetry traces with request/trace/region/db/cache correlation | **Absent.** No OTel dependency; Sentry runs `tracesSampleRate: 0`. |
| DB query / connection latency | **Not applicable as written** — reads are served from process memory, not a database (see EXISTING_ARCHITECTURE §2.3). |
| Cache hit/miss rates | Partial: `x-vercel-cache` observable per response; no aggregation. |
| Replication lag | **Not applicable** — no replicas, no wired SQL reader. |

## 4. Exit gate

The gate asks for identified bottlenecks and a justification for every proposed regional
deployment.

**Identified and evidenced:** F-1 and F-2 are confirmed and cheap. F-4 is the dominant
user-visible cost and is not an infrastructure problem.

**Regional deployment is NOT justified by present evidence.** Distance is real (§1) but
(a) the two measured round-trip wastes are not yet removed, (b) there is no percentile or
regional data to size a gain against, and (c) the architecture cannot host a second region
without forking the ledger. Re-measure after F-1 and F-2 and after the async rewire; decide
then, on numbers.
