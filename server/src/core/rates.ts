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
  if (hasReal) sourceLabel = source;
  cache = {
    btcUsd: r.btcUsd ?? cache?.btcUsd ?? FALLBACK.btcUsd,
    usdtUsd: r.usdtUsd ?? cache?.usdtUsd ?? FALLBACK.usdtUsd,
    usdcUsd: r.usdcUsd ?? cache?.usdcUsd ?? FALLBACK.usdcUsd,
    eurUsd: r.eurUsd ?? cache?.eurUsd ?? FALLBACK.eurUsd,
    at: hasReal ? Date.now() : (cache?.at ?? 0), // degraded pull keeps the last real timestamp so it ages out
  };
  touch("rates"); // persist so a cold serverless instance starts primed
}

/** True only when we hold a real IBEX pull that's recent enough to price on.
 *  The background refresh runs every 30s, so anything older than a few minutes
 *  means the feed is dead (or never populated) — and pricing real crypto on a
 *  stale/fallback rate would over- or under-charge the customer. Quoting must
 *  refuse when this is false AND real money can move. */
const MAX_RATE_AGE_MS = 5 * 60_000;
export function ratesFresh(maxAgeMs: number = MAX_RATE_AGE_MS): boolean {
  return !!cache && Date.now() - cache.at < maxAgeMs;
}

export function btcUsd(): number { return cache?.btcUsd ?? FALLBACK.btcUsd; }
export function usdtUsd(): number { return cache?.usdtUsd ?? FALLBACK.usdtUsd; }
export function usdcUsd(): number { return cache?.usdcUsd ?? FALLBACK.usdcUsd; }
/** XAF per USD = fixed CFA/EUR peg ÷ live EUR/USD (both legs real). */
export function usdXaf(): number { return EUR_XAF_PEG / (cache?.eurUsd ?? FALLBACK.eurUsd); }

export function ratesMeta() {
  return {
    source: cache ? sourceLabel : "fallback",
    updatedAt: cache ? new Date(cache.at).toISOString() : null,
    btcUsd: btcUsd(), usdtUsd: usdtUsd(), eurUsd: cache?.eurUsd ?? FALLBACK.eurUsd, usdXaf: usdXaf(),
  };
}
