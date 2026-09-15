/* ============================================================
   FX engine — every corridor crosses through USD and, for settlement, through sats (§32).

   XAF/USD comes from the production feed (EUR peg ÷ live EUR/USD — the same number the
   live quote engine uses). BTC/USD is the production feed's. Every other currency
   (KES, GHS, NGN, UGX …) comes from the PUBLIC USD table pulled here — Coinbase's
   exchange-rates first, open.er-api.com as the independent fallback — refreshed by the
   job loop and persisted so a fresh instance starts primed. When the public table has no
   fresh figure the operator's configured table (settings.network.fxUsd) is used and
   labelled as such: a corridor must not go live on a configured rate (fxLive refuses).
   ============================================================ */
import type { FxFeedStatus, FxQuote, NetworkCurrency } from "../../../../shared/network.js";
import { fetchT } from "../../adapters/http.js";
import { btcUsd, usdXaf, ratesFresh, ratesMeta } from "../rates.js";
import { getSettings } from "../settings.js";
import { register, touch } from "../persist.js";

export const FX_TTL_MS = 10 * 60_000;
/** A public table older than this no longer prices real money (feeds are daily-ish; we
 *  refresh every 30 min and allow two missed windows). */
export const PUBLIC_FX_MAX_AGE_MS = 6 * 60 * 60_000;
/** Currencies the network needs a USD rate for beyond what the production feed carries. */
export const NETWORK_CURRENCIES = ["KES", "GHS", "NGN", "UGX", "TZS", "RWF", "XOF"] as const;

let publicTable: { rates: Record<string, number>; source: string; at: number; divergent?: string[] } | null = null;
/** Two independent venues that disagree by more than this do not price real money. */
export const FX_DIVERGENCE_MAX = 0.02;
register("network_fx", () => publicTable, (d: typeof publicTable) => { if (d && d.rates) publicTable = d; });

const num = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN; return Number.isFinite(n) && n > 0 ? n : null; };
async function getJson<T>(url: string): Promise<T | null> {
  try { const r = await fetchT(url, { headers: { accept: "application/json" } }); return r.ok ? ((await r.json()) as T) : null; } catch { return null; }
}
/** PURE: pick the network currencies out of a USD-based rate table. Exported for tests. */
export function parseUsdTable(rates: Record<string, unknown> | undefined): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of NETWORK_CURRENCIES) { const n = num(rates?.[c]); if (n) out[c] = n; }
  return out;
}

/** Pull the public USD table. Only a pull that returned at least one real figure re-stamps
 *  the table; a dead feed leaves the last one to age out (same rule as core/rates.ts). */
export async function refreshPublicFx(): Promise<{ ok: boolean; source: string; count: number; divergent: string[] }> {
  // Two INDEPENDENT venues (different operators), as BTC/USD has. Coinbase is primary;
  // open.er-api is the check — and the fallback when Coinbase says nothing.
  const [cb, er] = await Promise.all([
    getJson<{ data?: { rates?: Record<string, string> } }>("https://api.coinbase.com/v2/exchange-rates?currency=USD"),
    getJson<{ result?: string; rates?: Record<string, number> }>("https://open.er-api.com/v6/latest/USD"),
  ]);
  const a = parseUsdTable(cb?.data?.rates), b = er?.result === "success" ? parseUsdTable(er.rates) : {};
  const { rates, divergent, source } = mergeVenues(a, b);
  const count = Object.keys(rates).length;
  if (!count) return { ok: false, source: "none", count: 0, divergent: [] };
  publicTable = { rates: { ...(publicTable?.rates ?? {}), ...rates }, source, at: Date.now(), divergent };
  touch("network_fx");
  return { ok: true, source, count, divergent };
}
/** PURE: the primary's figure per currency, flagged divergent when the check venue is more
 *  than FX_DIVERGENCE_MAX away; the check venue supplies what the primary lacks. */
export function mergeVenues(primary: Record<string, number>, check: Record<string, number>): { rates: Record<string, number>; divergent: string[]; source: string } {
  const rates: Record<string, number> = {}; const divergent: string[] = [];
  for (const c of NETWORK_CURRENCIES) {
    const p = primary[c], q = check[c];
    if (p && q) { rates[c] = p; if (Math.abs(p - q) / p > FX_DIVERGENCE_MAX) divergent.push(c); }
    else if (p) rates[c] = p; else if (q) rates[c] = q;
  }
  const source = Object.keys(primary).length && Object.keys(check).length ? "coinbase+open.er-api" : Object.keys(primary).length ? "coinbase" : "open.er-api";
  return { rates, divergent, source };
}
export const publicFxFresh = (maxAge = PUBLIC_FX_MAX_AGE_MS): boolean => !!publicTable && Date.now() - publicTable.at < maxAge;

/** Units of `ccy` per 1 USD, with the source of the figure. */
export function usdRate(ccy: NetworkCurrency): { rate: number; source: string } | null {
  if (ccy === "USD") return { rate: 1, source: "identity" };
  if (ccy === "XAF") return { rate: usdXaf(), source: ratesMeta().source === "fallback" ? "fallback" : `${ratesMeta().source}+peg` };
  if (ccy === "XOF") return { rate: usdXaf(), source: "peg (XOF = XAF vs EUR)" }; // both CFA francs are pegged at 655.957/EUR
  if (ccy === "BTC") return { rate: 1 / btcUsd(), source: ratesMeta().source };
  const pub = publicTable?.rates[ccy];
  if (pub && publicTable) return { rate: pub, source: publicTable.divergent?.includes(ccy) ? "divergent" : publicFxFresh() ? `public:${publicTable.source}` : "stale" };
  const t = getSettings().network.fxUsd[ccy];
  return typeof t === "number" && t > 0 ? { rate: t, source: "configured" } : null;
}

/** The feed as the admin panel shows it. */
export function fxFeedStatus(): FxFeedStatus {
  const rates: FxFeedStatus["rates"] = {};
  for (const c of ["XAF", "XOF", "BTC", ...NETWORK_CURRENCIES]) { const r = usdRate(c); if (r) rates[c] = r; }
  return { source: publicTable?.source ?? "none", at: publicTable ? new Date(publicTable.at).toISOString() : null, fresh: publicFxFresh(), currencies: Object.keys(publicTable?.rates ?? {}), rates, divergent: publicTable?.divergent ?? [] };
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
    else if (r.source === "stale") reasons.push(`${c}/USD public rate is stale`);
    else if (r.source === "divergent") reasons.push(`${c}/USD: the two public venues disagree by more than ${FX_DIVERGENCE_MAX * 100} %`);
    else if (r.source === "fallback") reasons.push(`${c}/USD is on the fallback rate`);
  }
  if (!ratesFresh()) reasons.push("the FX feed is stale");
  return { live: reasons.length === 0, reasons };
}
export const fxExpired = (q: FxQuote, now = Date.now()) => Date.parse(q.expiresAt) < now;
