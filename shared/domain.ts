/* ============================================================
   MoMo›Me — shared domain constants (single source of truth)
   ============================================================ */
import type { Country, CountryCode, Method, Provider, ProviderId, InboundAsset } from "./types.js";

export const PROVIDERS: Record<ProviderId, Provider> = {
  MTN: { id: "MTN", name: "MTN MoMo", short: "MTN" },
  ORANGE: { id: "ORANGE", name: "Orange Money", short: "OM" },
  AIRTEL: { id: "AIRTEL", name: "Airtel Money", short: "AT" },
};

export const COUNTRIES: Record<CountryCode, Country> = {
  CM: { name: "Cameroon", code: "CM", dial: "+237", ccy: "XAF", providers: ["MTN", "ORANGE"] },
  GA: { name: "Gabon", code: "GA", dial: "+241", ccy: "XAF", providers: ["AIRTEL", "MTN"] },
  TD: { name: "Chad", code: "TD", dial: "+235", ccy: "XAF", providers: ["AIRTEL", "MTN"] },
  CG: { name: "Congo", code: "CG", dial: "+242", ccy: "XAF", providers: ["MTN", "AIRTEL"] },
  CF: { name: "Cent. Afr. Rep.", code: "CF", dial: "+236", ccy: "XAF", providers: ["ORANGE", "MTN"] },
};

/** Local subscriber digits for a number (strips the country dial code). */
export function localDigits(phone: string, country: CountryCode): string {
  const d = phone.replace(/\D/g, "");
  const dial = COUNTRIES[country].dial.replace(/\D/g, "");
  return d.startsWith(dial) ? d.slice(dial.length) : d;
}

/** Map a Mobile Money number to its operator by prefix — the routing/identity
 *  anchor (the customer's dropdown choice is only a hint). Cameroon allocation:
 *  MTN 650-654 / 67x / 680-684, Orange 655-659 / 69x / 685-689. Returns null for
 *  unknown/unsupported prefixes (e.g. Nexttel 66x, Camtel 62x) and short input. */
export function detectProvider(phone: string, country: CountryCode): ProviderId | null {
  const n = localDigits(phone, country);
  if (country !== "CM") return COUNTRIES[country].providers[0] ?? null; // other CEMAC: single default
  if (n.length < 3 || n[0] !== "6") return null;
  const d2 = n[1];
  const third = +n[2];
  if (d2 === "7") return "MTN";
  if (d2 === "9") return "ORANGE";
  if (d2 === "5") return third <= 4 ? "MTN" : "ORANGE"; // 650-654 MTN, 655-659 Orange
  if (d2 === "8") return third <= 4 ? "MTN" : "ORANGE"; // 680-684 MTN, 685-689 Orange
  return null; // 66x Nexttel, 62x Camtel — not supported
}

/** XAF is pegged to EUR at this fixed rate (BACKEND_DESIGN §3). */
export const EUR_XAF_PEG = 655.957;

/** Per-rail spread in basis points — wider where confirmation exposure is longer. */
export const RAIL_SPREAD_BPS: Record<Method, number> = {
  LIGHTNING: 150, // ~1.5% — near-zero exposure
  USDT: 150,
  ONCHAIN: 280, // wider; 10–60 min exposure window
};

export const METHOD_ASSET: Record<Method, InboundAsset> = {
  LIGHTNING: "BTC",
  ONCHAIN: "BTC",
  USDT: "USDT",
};

/** Flat platform fee shown to the user, on top of the FX spread. */
export const FEE_PCT = 0.025;

export const MIN_XAF = 1; // lowered from 500 for testing (tiny real Lightning amounts)
export const MAX_XAF = 5_000_000;

/** Per-payout corridor caps (Mobile Money operator limits). */
export const PROVIDER_PAYOUT_MAX: Record<ProviderId, number> = {
  MTN: 1_000_000,
  ORANGE: 1_000_000,
  AIRTEL: 500_000,
};

/** Available XAF payout float (treasury). Payouts are blocked below this. */
export const XAF_FLOAT_BASE = 200_000_000;

/** Quote TTL per rail, in seconds. */
export const QUOTE_TTL_SEC: Record<Method, number> = {
  // 90s was far too short — a person scanning a QR and paying from a mobile
  // Lightning wallet routinely needs longer, so the invoice expired (CANCEL)
  // before the payment landed. 10 min (IBEX max is 15) gives ample time; the
  // per-rail spread covers the slightly longer rate lock.
  LIGHTNING: 600,
  USDT: 150,
  ONCHAIN: 900,
};

export const METHOD_META: Record<
  Method,
  { name: string; arrival: string; fast: boolean }
> = {
  LIGHTNING: { name: "Lightning", arrival: "Within seconds", fast: true },
  ONCHAIN: { name: "Bitcoin", arrival: "10–60 minutes", fast: false },
  USDT: { name: "USDT", arrival: "Within seconds", fast: true },
};
