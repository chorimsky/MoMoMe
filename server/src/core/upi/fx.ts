/* FX engine — one answer for any pair, from the feeds the product already runs on:
   crypto/stablecoin ↔ XAF from core/rates (two venues, divergence-refused) with the
   admin spread; fiat ↔ fiat from the network's public USD table (two venues). Every quote
   carries rate, mid, spread, source, timestamp and expiry. Nothing here is a constant. */
import type { FxRateQuote } from "../../../../shared/upi.js";
import { rateFor } from "../fx.js";
import { ratesMeta, ratesFresh, usdXaf } from "../rates.js";
import { fxQuote as networkFx, usdRate } from "../network/fx.js";
import { getSettings } from "../settings.js";
import type { Method } from "../../../../shared/types.js";

const TTL_MS = 30_000;
const METHOD_OF: Record<string, Method> = { "BTC/LIGHTNING": "LIGHTNING", "BTC/BITCOIN": "ONCHAIN", "USDT/ETHEREUM": "USDT", "USDC/ETHEREUM": "USDC" };

/** Units of `to` per one unit of `from`, after spread. null when no fresh feed can price it. */
export function fxRate(from: string, to: string, now = Date.now()): FxRateQuote | null {
  const stamp = { timestamp: new Date(now).toISOString(), expiresAt: new Date(now + TTL_MS).toISOString() };
  if (from === to) return { pair: `${from}/${to}`, rate: 1, mid: 1, spreadBps: 0, source: "identity", ...stamp };
  const m = METHOD_OF[from];
  if (m && to === "XAF") {
    if (!ratesFresh()) return null;
    const rq = rateFor(m); const meta = ratesMeta();
    return { pair: `${from}/XAF`, rate: rq.customerXafPerUnit, mid: rq.midXafPerUnit, spreadBps: rq.spreadBps, source: `${meta.source}${meta.legs ? " (2 venues)" : ""}`, ...stamp };
  }
  if (from === "XAF" && METHOD_OF[to]) { const inv = fxRate(to, "XAF", now); return inv && { ...inv, pair: `XAF/${to}`, rate: 1 / inv.rate, mid: 1 / inv.mid }; }
  // Fiat ↔ fiat through the network's USD table (KES, GHS, NGN … and XAF via the EUR peg).
  const nf = networkFx(from as never, to as never, getSettings().network.fxSpreadBps);
  if (nf) return { pair: `${from}/${to}`, rate: nf.rate, mid: nf.mid, spreadBps: nf.spreadBps, source: nf.source, ...stamp };
  // Stablecoin ↔ other fiat: USD leg from rates, fiat leg from the table.
  if (m && to !== "XAF") { const u = usdRate(to as never); if (u && ratesFresh()) { const rq = rateFor(m); const perUsd = rq.midXafPerUnit / usdXaf(); const mid = perUsd * u.rate; return { pair: `${from}/${to}`, rate: mid * (1 - rq.spreadBps / 10_000), mid, spreadBps: rq.spreadBps, source: `${ratesMeta().source}+${u.source}`, ...stamp }; } }
  return null;
}
export const fxExpired = (q: FxRateQuote, now = Date.now()) => Date.parse(q.expiresAt) < now;
