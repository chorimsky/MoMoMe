/* ============================================================
   FX quote engine (BACKEND_DESIGN §3)
   Prices volatility over the confirmation window via a per-rail spread.
   Spot comes from IBEX (the same source that settles the inbound), cached and
   refreshed in the background (see core/rates.ts) so quoting stays synchronous.
   ============================================================ */
import type { Method, InboundAsset } from "../../../shared/types.js";
import { METHOD_ASSET } from "../../../shared/domain.js";
import { getSettings } from "./settings.js";
import { btcUsd, usdtUsd, usdXaf } from "./rates.js";

/** Live spot in USD from IBEX (BTC/USD, USDT/USD), via the rate cache. */
function spotUsd(asset: InboundAsset): number {
  return asset === "USDT" ? usdtUsd() : btcUsd();
}

export interface RateQuote {
  asset: InboundAsset;
  /** Mid rate: XAF per 1 unit of the inbound asset. */
  midXafPerUnit: number;
  /** Customer rate after spread (fewer XAF per unit → they pay more asset). */
  customerXafPerUnit: number;
  spreadBps: number;
  usdXaf: number;
}

export function rateFor(method: Method): RateQuote {
  const asset = METHOD_ASSET[method];
  // Spread is admin-tunable at runtime (Pricing & FX engine).
  const spreadBps = getSettings().pricing.spreadBps[method];
  const usdxaf = usdXaf();
  const midXafPerUnit = spotUsd(asset) * usdxaf;
  const customerXafPerUnit = midXafPerUnit * (1 - spreadBps / 10_000);
  return { asset, midXafPerUnit, customerXafPerUnit, spreadBps, usdXaf: usdxaf };
}

/** Asset units the sender must pay to deliver `totalXaf`. */
export function inboundAmount(totalXaf: number, rq: RateQuote): number {
  return totalXaf / rq.customerXafPerUnit;
}

export function formatAmount(amount: number, asset: InboundAsset): string {
  return asset === "BTC" ? `${amount.toFixed(8)} BTC` : `${amount.toFixed(2)} USDT`;
}

export function usdValue(totalXaf: number, rq: RateQuote): number {
  return totalXaf / rq.usdXaf;
}
