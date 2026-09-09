/* ============================================================
   FX quote engine (BACKEND_DESIGN §3)
   Prices volatility over the confirmation window via a per-rail spread.
   Spot comes from IBEX (the same source that settles the inbound), cached and
   refreshed in the background (see core/rates.ts) so quoting stays synchronous.
   ============================================================ */
import type { Method, InboundAsset } from "../../../shared/types.js";
import { METHOD_ASSET } from "../../../shared/domain.js";
import { getSettings } from "./settings.js";
import { btcUsd, usdtUsd, usdcUsd, usdXaf } from "./rates.js";

/** Live spot in USD from IBEX (BTC/USD, USDT/USD, USDC/USD), via the rate cache. */
function spotUsd(asset: InboundAsset): number {
  return asset === "USDT" ? usdtUsd() : asset === "USDC" ? usdcUsd() : btcUsd();
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
/** The crypto amount a payer is asked to send, in the smallest unit that can actually be
 *  paid: a whole satoshi for BTC, a whole cent for a stablecoin. Rounded UP, so the payer
 *  never covers less than the quote (at most one unit more).
 *
 *  A raw division gave 66 772.745 sats. That is a legal Lightning amount, but wallets deal
 *  in whole sats: Wallet of Satoshi reconciled the fraction by passing an explicit amount
 *  next to the fixed-amount invoice, and its Spark SDK refused the pairing. Rounding here,
 *  at the quote, keeps every leg — invoice, on-chain URI, label — on the same figure. */
export function inboundAmount(totalXaf: number, rq: RateQuote): number {
  const raw = totalXaf / rq.customerXafPerUnit;
  const unit = rq.asset === "BTC" ? 1e8 : 100;
  return Math.ceil(raw * unit - 1e-9) / unit;
}

export function formatAmount(amount: number, asset: InboundAsset): string {
  return asset === "BTC" ? `${amount.toFixed(8)} BTC` : `${amount.toFixed(2)} ${asset}`;
}

export function usdValue(totalXaf: number, rq: RateQuote): number {
  return totalXaf / rq.usdXaf;
}
