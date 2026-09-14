/* ============================================================
   FX engine — every corridor crosses through USD and, for settlement, through sats (§32).

   XAF/USD comes from the production feed (EUR peg ÷ live EUR/USD — the same number the
   live quote engine uses). Currencies the feed does not carry come from the operator's
   configured table (settings.network.fxUsd) and are labelled as such: a corridor must not
   go live on a configured rate. BTC/USD is the production feed's.
   ============================================================ */
import type { FxQuote, NetworkCurrency } from "../../../../shared/network.js";
import { btcUsd, usdXaf, ratesFresh, ratesMeta } from "../rates.js";
import { getSettings } from "../settings.js";

export const FX_TTL_MS = 10 * 60_000;

/** Units of `ccy` per 1 USD, with the source of the figure. */
export function usdRate(ccy: NetworkCurrency): { rate: number; source: string } | null {
  if (ccy === "USD") return { rate: 1, source: "identity" };
  if (ccy === "XAF") return { rate: usdXaf(), source: ratesMeta().source === "fallback" ? "fallback" : `${ratesMeta().source}+peg` };
  if (ccy === "XOF") return { rate: usdXaf(), source: "peg (XOF = XAF vs EUR)" }; // both CFA francs are pegged at 655.957/EUR
  if (ccy === "BTC") return { rate: 1 / btcUsd(), source: ratesMeta().source };
  const t = getSettings().network.fxUsd[ccy];
  return typeof t === "number" && t > 0 ? { rate: t, source: "configured" } : null;
}

/** A quote from → to after the network spread. null when either leg is unpriced. */
export function fxQuote(from: NetworkCurrency, to: NetworkCurrency, spreadBps = getSettings().network.fxSpreadBps): FxQuote | null {
  const a = usdRate(from), b = usdRate(to);
  if (!a || !b) return null;
  const mid = b.rate / a.rate;
  const rate = from === to ? 1 : mid * (1 - spreadBps / 10_000);
  const at = Date.now();
  return { from, to, rate, mid, spreadBps: from === to ? 0 : spreadBps, source: from === to ? "identity" : `${a.source} / ${b.source}`, at: new Date(at).toISOString(), expiresAt: new Date(at + FX_TTL_MS).toISOString() };
}

/** Sats that carry `amount` of `ccy` across the settlement leg (at mid — the spread is
 *  taken on the fiat leg, not twice). */
export function toSats(amount: number, ccy: NetworkCurrency): number | null {
  const r = usdRate(ccy);
  if (!r) return null;
  const usd = amount / r.rate;
  return Math.ceil((usd / btcUsd()) * 1e8);
}

/** Is a corridor priced on a live feed on both legs? */
export function fxLive(from: NetworkCurrency, to: NetworkCurrency): { live: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const c of [from, to]) {
    const r = usdRate(c);
    if (!r) reasons.push(`${c} has no USD rate`);
    else if (r.source === "configured") reasons.push(`${c}/USD is a configured figure, not a feed`);
    else if (r.source === "fallback") reasons.push(`${c}/USD is on the fallback rate`);
  }
  if (!ratesFresh()) reasons.push("the FX feed is stale");
  return { live: reasons.length === 0, reasons };
}
export const fxExpired = (q: FxQuote, now = Date.now()) => Date.parse(q.expiresAt) < now;
