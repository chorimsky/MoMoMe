/* ============================================================
   FX rates sourced from IBEX (same source as settlement). Refreshed in the
   background by the server bootstrap; the quote engine reads these synchronously.
   XAF has no IBEX currency, so XAF/USD is derived from the fixed CFA→EUR peg and
   IBEX's live EUR/USD. Falls back to last-known / defaults if IBEX is unreachable.
   ============================================================ */
import { EUR_XAF_PEG } from "../../../shared/domain.js";
import { register, touch } from "./persist.js";

/** IBEX Hub currency ids (GET /currency/all). */
export const CCY = { MSAT: 0, SATS: 1, BTC: 2, USD: 3, EUR: 8, USDT: 29, USDC: 30 } as const;

// Used until the first live refresh (and if IBEX is unreachable).
const FALLBACK = { btcUsd: 65000, usdtUsd: 1, usdcUsd: 1, eurUsd: 1.08 };
let cache: { btcUsd: number; usdtUsd: number; usdcUsd: number; eurUsd: number; at: number } | null = null;
// Which feed last supplied a REAL number ("IBEX" | "public" | "fallback"). Surfaced
// via ratesMeta() for the admin health view — the rate source is no longer IBEX-only.
let sourceLabel: "IBEX" | "public" | "fallback" = "fallback";

// Persist the last real pull so a fresh (serverless) instance starts PRIMED. Cold
// instances have no long-lived FX poller; without this, the first live quote on a new
// instance would refuse (ratesFresh() false) until a pull lands. Last-writer-wins is
// safe for a price cache. On Postgres this write-throughs to the snapshots table and
// is restored by hydrateSnapshots() at boot.
register(
  "rates",
  () => (cache ? { c: cache, s: sourceLabel } : null),
  (d: { c: NonNullable<typeof cache>; s: typeof sourceLabel } | null) => {
    if (d?.c) { cache = d.c; sourceLabel = d.s ?? "IBEX"; }
  },
);

/** Merge a fresh pull into the cache (keep last-known for any null). `source` names the
 *  feed the numbers came from (IBEX preferred; a vendor-neutral public source is the
 *  fallback / the primary for a non-IBEX rail — see core/publicRates.ts). */
export function setRates(
  r: { btcUsd?: number | null; usdtUsd?: number | null; usdcUsd?: number | null; eurUsd?: number | null },
  source: "IBEX" | "public" = "IBEX",
): void {
  // Only a pull that returned at least one REAL number counts as "fresh". A
  // degraded feed (5xx/429 → every leg null) must NOT re-stamp `at`, otherwise
  // ratesFresh() would stay true forever while the price is frozen and live quotes
  // would price real crypto on a stale/fallback rate.
  const hasReal = r.btcUsd != null || r.usdtUsd != null || r.usdcUsd != null || r.eurUsd != null;
  if (!hasReal && !cache) return; // dead feed on cold boot → stay unpriced (ratesFresh() = false → quoting refuses)
  if (hasReal) {
    sourceLabel = source;
    // Any fresh REAL pull clears a prior divergence latch. `divergent` is set only in
    // setDualBtc and was never reset on the IBEX-primary path (jobs.ts calls setRates
    // directly), so a transient public-feed divergence would otherwise wedge
    // ratesFresh() false forever — a self-inflicted quoting outage until restart.
    // Note: a divergent setDualBtc pull returns WITHOUT calling setRates, so it never
    // clears itself here — only a subsequent agreed/IBEX pull does.
    divergent = false;
  }
  cache = {
    btcUsd: r.btcUsd ?? cache?.btcUsd ?? FALLBACK.btcUsd,
    usdtUsd: r.usdtUsd ?? cache?.usdtUsd ?? FALLBACK.usdtUsd,
    usdcUsd: r.usdcUsd ?? cache?.usdcUsd ?? FALLBACK.usdcUsd,
    eurUsd: r.eurUsd ?? cache?.eurUsd ?? FALLBACK.eurUsd,
    at: hasReal ? Date.now() : (cache?.at ?? 0), // degraded pull keeps the last real timestamp so it ages out
  };
  touch("rates"); // persist so a cold serverless instance starts primed
}

/** Max tolerated disagreement between two independent BTC/USD sources, in basis
 *  points. 200bp (2%) is comfortably wider than normal cross-venue spread and
 *  comfortably tighter than the 280bp on-chain rail spread — so a divergence that
 *  could eat the margin refuses instead of quoting. */
const MAX_DIVERGENCE_BPS = Number(process.env.FX_MAX_DIVERGENCE_BPS ?? 200);
let divergent = false;
/** The two most recent raw legs, surfaced on the admin health/rails view so an
 *  operator diagnoses a divergence ("Coinbase 64,900 / Kraken 71,200") in seconds. */
let lastLegs: { a: number | null; b: number | null; bps: number } | null = null;

/** Record a two-source pull. Agreement → the MEDIAN (here, the mean of two) is
 *  cached and the feed is healthy. Disagreement → the cache is NOT updated and the
 *  feed is marked divergent, so ratesFresh() goes false and live quoting refuses
 *  rather than pricing real crypto off a possibly-manipulated number. */
export function setDualBtc(a: number | null, b: number | null): void {
  if (a == null || b == null) {
    // One venue down is not a divergence — fall back to the single live leg.
    divergent = false;
    lastLegs = { a, b, bps: 0 };
    setRates({ btcUsd: a ?? b }, "public");
    return;
  }
  const spreadBps = Math.abs(a - b) / ((a + b) / 2) * 10_000;
  lastLegs = { a, b, bps: Math.round(spreadBps) };
  divergent = spreadBps > MAX_DIVERGENCE_BPS;
  if (divergent) {
    console.error(`[fx] BTC/USD sources diverge by ${Math.round(spreadBps)}bp (${a} vs ${b}) — refusing to price`);
    return; // keep the last agreed price; it ages out via ratesFresh()
  }
  setRates({ btcUsd: (a + b) / 2 }, "public");
}

/** True only when we hold a real IBEX pull that's recent enough to price on.
 *  The background refresh runs every 30s, so anything older than a few minutes
 *  means the feed is dead (or never populated) — and pricing real crypto on a
 *  stale/fallback rate would over- or under-charge the customer. Quoting must
 *  refuse when this is false AND real money can move. */
const MAX_RATE_AGE_MS = 5 * 60_000;
export function ratesFresh(maxAgeMs: number = MAX_RATE_AGE_MS): boolean {
  return !divergent && !!cache && Date.now() - cache.at < maxAgeMs;
}

export function btcUsd(): number { return cache?.btcUsd ?? FALLBACK.btcUsd; }
export function usdtUsd(): number { return cache?.usdtUsd ?? FALLBACK.usdtUsd; }
export function usdcUsd(): number { return cache?.usdcUsd ?? FALLBACK.usdcUsd; }
/** XAF per USD = fixed CFA/EUR peg ÷ live EUR/USD (both legs real). */
export function usdXaf(): number { return EUR_XAF_PEG / (cache?.eurUsd ?? FALLBACK.eurUsd); }

export function ratesMeta() {
  return {
    source: cache ? sourceLabel : "fallback",
    divergent, // surfaced on the admin health view — a silent refusal is worse than none
    divergenceBps: lastLegs?.bps ?? 0,
    legs: lastLegs ? { a: lastLegs.a, b: lastLegs.b } : null, // e.g. Coinbase / Kraken raw BTC/USD
    updatedAt: cache ? new Date(cache.at).toISOString() : null,
    btcUsd: btcUsd(), usdtUsd: usdtUsd(), eurUsd: cache?.eurUsd ?? FALLBACK.eurUsd, usdXaf: usdXaf(),
  };
}
