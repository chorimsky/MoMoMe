/* ============================================================
   FX quote engine (BACKEND_DESIGN §3)
   Prices volatility over the confirmation window via a per-rail spread.
   Spot is simulated here behind a single seam — swap for a live feed.
   ============================================================ */
import type { Method, InboundAsset } from "../../../shared/types.js";
import { EUR_XAF_PEG, METHOD_ASSET } from "../../../shared/domain.js";
import { getSettings } from "./settings.js";

/** USD per EUR — moves the XAF/USD relationship (XAF is EUR-pegged). */
const EUR_USD = 1.08;
const USD_XAF = EUR_XAF_PEG / EUR_USD; // ≈ 607

/** Simulated spot, in USD, with a slow deterministic oscillation. */
function spotUsd(asset: InboundAsset): number {
  const t = Date.now() / 1000;
  if (asset === "USDT") return 1; // stable
  const wobble = 1 + 0.015 * Math.sin(t / 120); // ±1.5% slow drift
  return 65000 * wobble; // BTC/USD
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
  const midXafPerUnit = spotUsd(asset) * USD_XAF;
  const customerXafPerUnit = midXafPerUnit * (1 - spreadBps / 10_000);
  return { asset, midXafPerUnit, customerXafPerUnit, spreadBps, usdXaf: USD_XAF };
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
