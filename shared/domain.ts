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
  LIGHTNING: 90,
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
