/* ============================================================
   Real-user monitoring — the part of the latency the server cannot see.

   core/interop/metrics.ts already reports p50/p95/p99 per route class, but it times OUR
   work: the clock starts when the request arrives and stops when we finish writing. It is
   blind to DNS, the TLS handshake, the last mile and the browser's own render — which is
   where the cost actually lands for a user on a Cameroonian mobile network. A Phase 0 probe
   from one laptop measured ~200 ms RTT and ~0.88 s for a 60-byte /health; neither number
   can be learned from the server side, and neither is a real user's.

   So the browser reports what only the browser knows, and this aggregates it.

   DESIGN RULES, each one load-bearing:

     • NOT PERSISTED. persist.ts snapshots a collection to SQLite on every mutation; a
       page-view beacon in a persisted collection would rewrite the ledger's volume on
       every page view. These are bounded in-memory rings, recomputed on read, exactly like
       interop/metrics.ts. A restart loses samples and nothing else.

     • NO PII. The beacon carries timings and a path. Not an IP, not a user id, not a query
       string, not a user agent. Country comes from the CDN's own geo header on the request
       — never from the body, and never from an IP lookup, so no address is recorded or
       sent anywhere. The path is normalised through routeClass() before it is used as a
       key, which collapses payment ids and reference codes.

     • A HOSTILE PUBLIC ENDPOINT. A beacon route takes unauthenticated input from any
       browser, so every field is bounds-checked and anything unrecognised is dropped, not
       coerced. Buckets and samples are capped so a flood costs bounded memory and cannot
       evict the real distribution faster than the ring already would.

     • PERCENTILES WITHHELD BELOW MIN_SAMPLES, the house rule from stageLatency.ts: a
       percentile over a handful of samples is noise wearing a number. Below the threshold
       the figures are null and `note` says why. Not zero, not a guess — and for this
       source that matters more than most, because the first users in a new country produce
       exactly the handful of samples someone would otherwise quote as "latency in Nigeria".
   ============================================================ */
import { routeClass } from "./interop/metrics.js";

/** Below this many samples in a bucket, percentiles are withheld. Same spirit as
 *  stageLatency.MIN_SAMPLES; a little higher because browser timings are noisier than
 *  our own state transitions. */
export const MIN_SAMPLES = 10;

/** Per-metric sane bounds, in ms (CLS is unitless and handled separately). A browser can
 *  report nonsense — a clock change mid-navigation, a tab restored from the background
 *  hours later, or simply a hostile client. Anything outside these is dropped rather than
 *  clamped: a clamped outlier still moves a percentile, a dropped one does not. */
const MAX_MS = 600_000; // 10 minutes
const METRICS = ["dns", "tcp", "tls", "ttfb", "download", "domReady", "lcp", "inp"] as const;
export type RumMetric = (typeof METRICS)[number];

/** Connection classes the Network Information API reports. Anything else → "unknown". */
const CONNECTIONS = ["slow-2g", "2g", "3g", "4g", "unknown"] as const;
export type RumConnection = (typeof CONNECTIONS)[number];

const SAMPLES = 500;   // per metric, per bucket
const MAX_BUCKETS = 200;

interface Bucket {
  country: string;
  connection: RumConnection;
  route: string;
  views: number;
  /** CLS is a unitless score, kept apart from the millisecond metrics. */
  cls: number[];
  metrics: Map<RumMetric, number[]>;
}
const buckets = new Map<string, Bucket>();

const key = (country: string, connection: string, route: string) => `${country}|${connection}|${route}`;

function push(arr: number[], v: number): void {
  arr.push(v);
  if (arr.length > SAMPLES) arr.splice(0, arr.length - SAMPLES);
}

/** The shape a browser is allowed to send. Every field optional — a browser that cannot
 *  measure a thing must be able to omit it rather than send a zero. */
export interface RumSample {
  path?: unknown;
  connection?: unknown;
  cls?: unknown;
  dns?: unknown; tcp?: unknown; tls?: unknown; ttfb?: unknown;
  download?: unknown; domReady?: unknown; lcp?: unknown; inp?: unknown;
}

/** A finite, non-negative, in-range number — or null. Rejects strings outright: a numeric
 *  string from a beacon is a sign the client is not the one we wrote, and coercing it
 *  would let `"1e500"` or `"  12  "` in. */
function ms(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  if (v < 0 || v > MAX_MS) return null;
  return Math.round(v);
}

function connectionOf(v: unknown): RumConnection {
  return typeof v === "string" && (CONNECTIONS as readonly string[]).includes(v) ? (v as RumConnection) : "unknown";
}

/** `country` comes from the caller, which reads it off the CDN geo header — not from the
 *  sample body, so a client cannot attribute its timings to another market. */
export function recordRum(sample: RumSample, country: string | undefined): boolean {
  const rawPath = typeof sample.path === "string" && sample.path.startsWith("/") && sample.path.length <= 512
    ? sample.path
    : "/";
  // routeClass strips ids and the query string, so a path can never become an unbounded
  // key or carry a reference code into a metrics table.
  const route = routeClass("PAGE", rawPath);
  // "XX" and "T1" are Cloudflare's own markers for "unknown" and "Tor exit", not
  // countries. The route strips them too; doing it here as well means a direct caller
  // cannot create a bucket labelled with a non-place.
  const raw = typeof country === "string" && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : "";
  const cc = raw && raw !== "XX" && raw !== "T1" ? raw : "??";
  const connection = connectionOf(sample.connection);

  const values = new Map<RumMetric, number>();
  for (const m of METRICS) {
    const v = ms((sample as Record<string, unknown>)[m]);
    if (v != null) values.set(m, v);
  }
  // CLS: unitless, 0..10 is already far beyond "poor" (0.25).
  const clsRaw = typeof sample.cls === "number" && Number.isFinite(sample.cls) && sample.cls >= 0 && sample.cls <= 10
    ? Math.round(sample.cls * 1000) / 1000
    : null;

  // A beacon that carried nothing usable is not a page view — counting it would inflate
  // `views` with noise and make a bucket look better sampled than it is.
  if (!values.size && clsRaw == null) return false;

  const k = key(cc, connection, route);
  let b = buckets.get(k);
  if (!b) {
    if (buckets.size >= MAX_BUCKETS) {
      // Drop the least-observed bucket rather than the oldest: a flood of one-off junk
      // buckets would otherwise evict the markets that actually have traffic.
      let worst: string | undefined; let fewest = Infinity;
      for (const [bk, bv] of buckets) if (bv.views < fewest) { fewest = bv.views; worst = bk; }
      if (worst) buckets.delete(worst);
    }
    b = { country: cc, connection, route, views: 0, cls: [], metrics: new Map() };
    buckets.set(k, b);
  }
  b.views++;
  for (const [m, v] of values) {
    let arr = b.metrics.get(m);
    if (!arr) { arr = []; b.metrics.set(m, arr); }
    push(arr, v);
  }
  if (clsRaw != null) push(b.cls, clsRaw);
  return true;
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

export interface RumStat { samples: number; p50: number | null; p75: number | null; p95: number | null; note?: string }

function stat(xs: number[], round = 0): RumStat {
  if (xs.length < MIN_SAMPLES) {
    return { samples: xs.length, p50: null, p75: null, p95: null, note: `fewer than ${MIN_SAMPLES} samples — no percentile is meaningful yet` };
  }
  const s = [...xs].sort((a, b) => a - b);
  const r = (v: number) => (round ? Math.round(v * 10 ** round) / 10 ** round : Math.round(v));
  return { samples: s.length, p50: r(pct(s, 50)), p75: r(pct(s, 75)), p95: r(pct(s, 95)) };
}

export interface RumBucketReport {
  country: string; connection: RumConnection; route: string; views: number;
  metrics: Partial<Record<RumMetric, RumStat>>;
  cls: RumStat;
}

/** Everything observed, busiest bucket first. Safe to expose to an operator; contains no
 *  identifier of any kind. */
export function rumReport(): { buckets: RumBucketReport[]; totalViews: number; minSamples: number } {
  const out: RumBucketReport[] = [...buckets.values()]
    .sort((a, b) => b.views - a.views)
    .map((b) => {
      const metrics: Partial<Record<RumMetric, RumStat>> = {};
      for (const m of METRICS) {
        const arr = b.metrics.get(m);
        if (arr?.length) metrics[m] = stat(arr);
      }
      return { country: b.country, connection: b.connection, route: b.route, views: b.views, metrics, cls: stat(b.cls, 3) };
    });
  return { buckets: out, totalViews: out.reduce((n, b) => n + b.views, 0), minSamples: MIN_SAMPLES };
}

/** Test seam. */
export function resetRum(): void { buckets.clear(); }
