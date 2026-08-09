/* ============================================================
   Vendor-neutral PUBLIC FX rate source — the fallback (and, for a crypto rail
   that isn't IBEX, the PRIMARY) feed for the quote engine.

   Historically the rate cache was populated only from IBEX (core/rates.ts);
   a deployment whose crypto rail is Blink (which provides no FX feed) would
   therefore never have fresh rates → every live quote refused
   (`rates_unavailable`). This module lets the feed stand on its own: a
   no-auth public source (Coinbase) supplies BTC/USD and EUR/USD; the pegged
   stablecoins default to 1. Parsing is split from fetching so the extraction
   is unit-testable without network.
   ============================================================ */
import { fetchT } from "../adapters/http.js";

export interface RatePull { btcUsd: number | null; usdtUsd: number | null; usdcUsd: number | null; eurUsd: number | null; }

/** Coinbase spot: GET /v2/prices/BTC-USD/spot → { data: { amount: "65000.00" } }. */
interface CbSpot { data?: { amount?: string } }
/** Coinbase FX: GET /v2/exchange-rates?currency=EUR → { data: { rates: { USD: "1.08" } } }. */
interface CbRates { data?: { rates?: Record<string, string> } }

const num = (s: unknown): number | null => {
  const n = typeof s === "string" ? Number(s) : typeof s === "number" ? s : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** PURE: turn the two Coinbase responses into a RatePull. Stablecoins are pegged →
 *  1 (the app's existing default); a real depeg is negligible for XAF pricing and the
 *  cache keeps the last real value anyway. Exported for testing. */
export function parsePublicRates(btcSpot: unknown, eurRates: unknown): RatePull {
  const btcUsd = num((btcSpot as CbSpot)?.data?.amount);
  const eurUsd = num((eurRates as CbRates)?.data?.rates?.USD);
  return { btcUsd, usdtUsd: 1, usdcUsd: 1, eurUsd };
}

/** Fetch BTC/USD and EUR/USD from Coinbase's public (no-auth) endpoints. Any leg
 *  that fails comes back null → setRates() keeps the last-known value for it. Returns
 *  null only if BOTH legs fail (nothing real to stamp). */
export async function fetchPublicRates(): Promise<RatePull | null> {
  const get = async <T>(url: string): Promise<T | null> => {
    try {
      const res = await fetchT(url, { method: "GET", headers: { accept: "application/json" } });
      if (!res.ok) return null;
      return (await res.json()) as T;
    } catch { return null; }
  };
  const [btcSpot, eurRates] = await Promise.all([
    get<CbSpot>("https://api.coinbase.com/v2/prices/BTC-USD/spot"),
    get<CbRates>("https://api.coinbase.com/v2/exchange-rates?currency=EUR"),
  ]);
  const r = parsePublicRates(btcSpot, eurRates);
  if (r.btcUsd == null && r.eurUsd == null) return null; // nothing real — don't stamp fresh
  return r;
}
