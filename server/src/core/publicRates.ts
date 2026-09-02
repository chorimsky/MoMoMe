/* ============================================================
   Vendor-neutral PUBLIC FX rate source — the fallback (and, for a crypto rail
   that isn't IBEX, the PRIMARY) feed for the quote engine.

   IBEX supplies the primary feed (core/rates.ts). This module is the INDEPENDENT
   fallback, so an IBEX rate outage degrades pricing instead of stopping it — without
   it, a dead rate call means every live quote is refused (`rates_unavailable`).
   It is a market-data source, not a crypto rail: nothing here touches funds.
   Two INDEPENDENT venues supply BTC/USD (Coinbase + Kraken) so the caller can refuse to
   price when they disagree; Coinbase alone supplies EUR/USD. Parsing is split from
   fetching so the extraction is unit-testable without network.
   ============================================================ */
import { fetchT } from "../adapters/http.js";

/** Coinbase spot: GET /v2/prices/BTC-USD/spot → { data: { amount: "65000.00" } }. */
interface CbSpot { data?: { amount?: string } }
/** Coinbase FX: GET /v2/exchange-rates?currency=EUR → { data: { rates: { USD: "1.08" } } }. */
interface CbRates { data?: { rates?: Record<string, string> } }
/** Kraken public ticker: GET /0/public/Ticker?pair=XBTUSD
 *  → { result: { XXBTZUSD: { c: ["65000.0", "0.01"] } } }. Independent of Coinbase
 *  (different venue, different operator) — that independence is the whole point. */
interface KrakenTicker { result?: Record<string, { c?: string[] }> }

const num = (s: unknown): number | null => {
  const n = typeof s === "string" ? Number(s) : typeof s === "number" ? s : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** GET a JSON body, or null on any failure. Module-scoped so both the single-source
 *  and dual-source fetchers share one implementation. */
async function get<T>(url: string): Promise<T | null> {
  try {
    const res = await fetchT(url, { method: "GET", headers: { accept: "application/json" } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch { return null; }
}

/** PURE: extract BTC/USD from a Kraken ticker response. Exported for testing. */
export function parseKrakenBtc(t: unknown): number | null {
  const result = (t as KrakenTicker)?.result;
  const first = result ? Object.values(result)[0] : undefined;
  return num(first?.c?.[0]);
}

/** Fetch ONLY EUR/USD from Coinbase (used alongside the dual-venue BTC pull so the FX
 *  tick doesn't fetch Coinbase's BTC spot twice). Stablecoins stay pegged to 1. */
export async function fetchEurUsd(): Promise<number | null> {
  const r = await get<CbRates>("https://api.coinbase.com/v2/exchange-rates?currency=EUR");
  return num((r as CbRates)?.data?.rates?.USD);
}

/** Fetch BTC/USD from BOTH venues. Returns each leg separately — the caller decides
 *  whether they agree. Merging here would defeat the divergence guard. */
export async function fetchDualBtcUsd(): Promise<{ a: number | null; b: number | null }> {
  const [cb, kr] = await Promise.all([
    get<CbSpot>("https://api.coinbase.com/v2/prices/BTC-USD/spot"),
    get<KrakenTicker>("https://api.kraken.com/0/public/Ticker?pair=XBTUSD"),
  ]);
  return { a: num((cb as CbSpot)?.data?.amount), b: parseKrakenBtc(kr) };
}
