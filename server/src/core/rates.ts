/* ============================================================
   FX rates sourced from IBEX (same source as settlement). Refreshed in the
   background by the server bootstrap; the quote engine reads these synchronously.
   XAF has no IBEX currency, so XAF/USD is derived from the fixed CFA→EUR peg and
   IBEX's live EUR/USD. Falls back to last-known / defaults if IBEX is unreachable.
   ============================================================ */
import { EUR_XAF_PEG } from "../../../shared/domain.js";

/** IBEX Hub currency ids (GET /currency/all). */
export const CCY = { MSAT: 0, SATS: 1, BTC: 2, USD: 3, EUR: 8, USDT: 29, USDC: 30 } as const;

// Used until the first live refresh (and if IBEX is unreachable).
const FALLBACK = { btcUsd: 65000, usdtUsd: 1, eurUsd: 1.08 };
let cache: { btcUsd: number; usdtUsd: number; eurUsd: number; at: number } | null = null;

/** Merge a fresh pull from IBEX into the cache (keep last-known for any null). */
export function setRates(r: { btcUsd?: number | null; usdtUsd?: number | null; eurUsd?: number | null }): void {
  cache = {
    btcUsd: r.btcUsd ?? cache?.btcUsd ?? FALLBACK.btcUsd,
    usdtUsd: r.usdtUsd ?? cache?.usdtUsd ?? FALLBACK.usdtUsd,
    eurUsd: r.eurUsd ?? cache?.eurUsd ?? FALLBACK.eurUsd,
    at: Date.now(),
  };
}

export function btcUsd(): number { return cache?.btcUsd ?? FALLBACK.btcUsd; }
export function usdtUsd(): number { return cache?.usdtUsd ?? FALLBACK.usdtUsd; }
/** XAF per USD = fixed CFA/EUR peg ÷ live EUR/USD (both legs real). */
export function usdXaf(): number { return EUR_XAF_PEG / (cache?.eurUsd ?? FALLBACK.eurUsd); }

export function ratesMeta() {
  return {
    source: cache ? "IBEX" : "fallback",
    updatedAt: cache ? new Date(cache.at).toISOString() : null,
    btcUsd: btcUsd(), usdtUsd: usdtUsd(), eurUsd: cache?.eurUsd ?? FALLBACK.eurUsd, usdXaf: usdXaf(),
  };
}
