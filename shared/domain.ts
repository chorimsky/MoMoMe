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
  CM: { name: "Cameroon", code: "CM", dial: "+237", ccy: "XAF", providers: ["MTN", "ORANGE"], active: true },
  GA: { name: "Gabon", code: "GA", dial: "+241", ccy: "XAF", providers: ["AIRTEL", "MTN"], active: false },
  TD: { name: "Chad", code: "TD", dial: "+235", ccy: "XAF", providers: ["AIRTEL", "MTN"], active: false },
  CG: { name: "Congo", code: "CG", dial: "+242", ccy: "XAF", providers: ["MTN", "AIRTEL"], active: false },
  CF: { name: "Cent. Afr. Rep.", code: "CF", dial: "+236", ccy: "XAF", providers: ["ORANGE", "MTN"], active: false },
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

/** The domain for Lightning Addresses. Every Mobile Money number is reachable
 *  as <number>@<domain> (LNURL-pay): an external Lightning wallet paying that
 *  address sends Sats that settle to the Mobile Money account. Single source of
 *  truth for merchant/customer identities and the LNURL-pay server. */
export const LN_ADDRESS_DOMAIN = "momome.xyz";

/** Every crypto pay-in method, in the order the product presents them. Single source of
 *  truth: the send flow, the admin analytics split and the ops dashboard all read this, so
 *  adding a method can't leave one of them silently blind to its volume. Whether a method is
 *  actually OFFERED is a separate question — the operator's switches AND real rail support
 *  (see /config `methods`). */
export const ALL_METHODS: Method[] = ["LIGHTNING", "ONCHAIN", "USDT", "USDC"];

/** Per-rail spread in basis points — wider where confirmation exposure is longer. */
export const RAIL_SPREAD_BPS: Record<Method, number> = {
  LIGHTNING: 150, // ~1.5% — near-zero exposure
  USDT: 150,
  USDC: 150, // stablecoin — same low exposure as USDT
  ONCHAIN: 280, // wider; 10–60 min exposure window
};

export const METHOD_ASSET: Record<Method, InboundAsset> = {
  LIGHTNING: "BTC",
  ONCHAIN: "BTC",
  USDT: "USDT",
  USDC: "USDC",
};

/** Flat platform fee shown to the user, on top of the FX spread. */
export const FEE_PCT = 0.025;

export const MIN_XAF = 500; // realistic floor — below this the crypto + MoMo cash-out fees make a transfer uneconomic
export const MAX_XAF = 5_000_000;

/** Per-payout corridor caps (Mobile Money operator limits). */
export const PROVIDER_PAYOUT_MAX: Record<ProviderId, number> = {
  MTN: 1_000_000,
  ORANGE: 1_000_000,
  AIRTEL: 500_000,
};

/** CEILING on XAF payout capacity — a conservative cap, not a measurement. The real
 *  figure comes from live aggregator balances (core/routing aggregatorFloatXaf); this
 *  bounds it so a wrong or spoofed balance response can't authorize unlimited payout,
 *  and stands in when no rail can be queried. Keep it at or below the treasury's actual
 *  funded position. */
export const XAF_FLOAT_MAX = 200_000_000;

/** Quote TTL per rail, in seconds. */
export const QUOTE_TTL_SEC: Record<Method, number> = {
  // 90s was far too short — a person scanning a QR and paying from a mobile
  // Lightning wallet routinely needs longer, so the invoice expired (CANCEL)
  // before the payment landed. 10 min (IBEX max is 15) gives ample time; the
  // per-rail spread covers the slightly longer rate lock.
  LIGHTNING: 600,
  USDT: 150,
  USDC: 150,
  ONCHAIN: 900,
};

// User-facing funding names are mobile-money-first: lead with speed/outcome, not
// crypto jargon. The asset is only named where the payer must know what to send
// (Bitcoin; and "US Dollars" for the USDT/USDC stablecoin rails).
export const METHOD_META: Record<
  Method,
  { name: string; arrival: string; fast: boolean }
> = {
  LIGHTNING: { name: "Instant", arrival: "Within seconds", fast: true },
  ONCHAIN: { name: "Bitcoin", arrival: "10–60 minutes", fast: false },
  USDT: { name: "US Dollars", arrival: "Within seconds", fast: true },
  USDC: { name: "US Dollars", arrival: "Within seconds", fast: true },
};

/* ---------- Bitcoin unit conversion ----------
   1 BTC = 100,000,000 sat = 100,000,000,000 msat. The `1e11` literal was previously
   re-typed at five call sites across the IBEX adapter, treasury, settlement and the bolt11
   parser. A wrong exponent in any of them is a 100,000,000x money error that no type
   catches, so it lives here once. */
export const MSAT_PER_BTC = 1e11;
/** BTC → millisatoshi (rounded — msat is the smallest integral unit). */
export const btcToMsat = (btc: number): number => Math.round(btc * MSAT_PER_BTC);
/** Millisatoshi → BTC. */
export const msatToBtc = (msat: number): number => msat / MSAT_PER_BTC;
