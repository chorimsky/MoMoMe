# Phase 1 — Regional latency matrix

**Date:** 2026-11-06 · **Status: the matrix is EMPTY.** This document defines it and wires
up what fills it. It contains no regional figures, because none exist yet.

## 0. Why this is empty, and why that is the honest state

The plan asks for latency measured from Central Africa, West Africa, Europe, North America
and Asia-Pacific. This project has **one measurement vantage**: a laptop
([../infrastructure/PERFORMANCE_BASELINE.md](../infrastructure/PERFORMANCE_BASELINE.md)).
There are no synthetic probes in other regions, and buying them is new recurring cost that
Phase 9 has not yet justified.

Filling this table with anything other than measurements would make every later phase
unfalsifiable, so it stays empty until real data arrives. The plan's own words: *"Never
claim a fixed percentage improvement without benchmark evidence."*

## 1. The matrix

One row per `country × connection class × route class`. Percentiles are **withheld below 10
samples** and shown as `—`, with the sample count still given.

| Country | Connection | Route | Views | DNS p50 | TCP p50 | TLS p50 | TTFB p50 / p95 | Download p50 | DOM ready p50 | LCP p75 | INP p75 | CLS p75 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| _(no data yet)_ | | | | | | | | | | | | |

Read it from `GET /api/v1/observability` (admin), under `rum.buckets`. `rum.minSamples`
states the withholding threshold so a reader can see the rule rather than infer it.

## 2. What now fills it

Implemented 2026-11-06. Real users, not synthetic probes — which is what the plan prefers,
and the only way this project will ever see an African mobile network honestly.

| Piece | File | Does |
| --- | --- | --- |
| Browser collector | `app/src/lib/rum.ts` | Navigation timings as **segments** (DNS, TCP, TLS, TTFB, download, DOM ready), LCP, worst-interaction latency, CLS, connection class |
| Beacon route | `server/src/routes/rum.ts` | `POST /api/rum` → 204; rate-limited 60 / 5 min / IP |
| Aggregator | `server/src/core/rum.ts` | Bounded in-memory rings → p50/p75/p95 per bucket |
| Exposure | `server/src/core/interop/metrics.ts` | `rum` inside `observability()`, already admin-gated at `routes/v1.ts:259` |
| Tests | `server/test/rum.test.ts` | 45 assertions, wired into the gate chain |

### 2.1 Decisions that are load-bearing, not incidental

**Segments, not offsets.** `PerformanceNavigationTiming` gives absolute offsets; this
records differences. `ttfb` is `requestStart → responseStart`, which is the wait *after* the
connection is up — so our server's time is separated from the handshakes in front of it.
Without that split a regional gain and a server regression are the same number.

**Country from the CDN header, never the body.** `cf-ipcountry` / `x-vercel-ip-country` /
`x-geo-country`, the same order `core/geoip.ts` already uses. A client that could name its
own market could invent "latency in Nigeria". Cloudflare's `XX` and `T1` markers are
rejected in both the route and the aggregator, so no bucket is ever labelled with a
non-place.

**Nothing identifying.** No IP (the server reads a header, it does not geolocate an
address), no user agent, no visitor id, no query string — this site's query strings carry
phone numbers and amounts. The path is collapsed to a route class **in the browser**, with
`analytics.ts`'s own regexes, and normalised again server-side. Verified on a live page
load: `/pay/MMM-2026-999888` left the browser as `/pay/:code`.

**Not persisted.** `core/persist.ts` snapshots a collection to SQLite on every mutation. A
page-view counter in a persisted collection would rewrite the ledger's volume on every page
view. These are in-memory rings, like `interop/metrics.ts`. A restart loses samples and
nothing else.

**Percentiles withheld below 10 samples**, the rule `stageLatency.ts` already states as *"a
percentile over a handful of samples is noise wearing a number."* It matters most here: the
first users in a new country produce exactly the handful of samples someone would otherwise
quote as that country's latency.

**`fetch`+`keepalive` cross-origin, `sendBeacon` only same-origin.** `sendBeacon` always
sends credentials mode `include`, so cross-origin the browser demands
`Access-Control-Allow-Credentials: true`, which this API does not send. In production the
app is on `momome.xyz` and the API on Railway — cross-origin — so a `sendBeacon` would be
refused before it left. `analytics.ts` hit exactly this and documents it. The trap is that
`sendBeacon` returns **true** (it queued), so a "fall back if it failed" check never fires:
the beacon would simply never arrive, and the matrix would stay empty while looking wired.
This collector was written with that bug and corrected before deployment only because
`analytics.ts` had recorded it.

**Opt-out respected:** DNT and Global Privacy Control mean no beacon; `/admin` and `/ops`
are excluded, matching `analytics.ts`.

## 3. Verified, and not

**Verified:** 45 unit/route assertions green, including that hostile input is dropped rather
than clamped, that an array body cannot fill a bucket, that a rejected sample still answers
204 so the endpoint gives no probing signal, and that the report contains no identifier.
Verified in a real browser on a running dev stack: the beacon fires on page-hide, carries
plausible segment timings (`ttfb: 35`, `download: 6`, `domReady: 603` on localhost), omits
`tls` on plain HTTP instead of reporting the epoch, and collapses the payment code.

**Not verified:** nothing has been deployed, so **no production sample exists**. Whether
real browsers in Cameroon report what this expects is unknown until it ships. `INP` here is
the worst interaction observed, not a true session p98 — it errs toward reporting the page
as slower than INP would, and is labelled `inp` because that is the bucket it informs.

## 4. Exit gate — not yet met, deliberately

Phase 1's gate is to identify the bottlenecks and justify every proposed regional
deployment. The instrument now exists; the data does not.

What Phase 0 already established stands: the dominant user-visible cost is a payout rail at
**49 % success and ~286 s average**, not the ~200 ms RTT. Until this matrix has rows, the
only honest position on regional deployment remains the Phase 0 one — **not justified** —
and the next decision point is after real traffic has filled it.
