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
  CM: { name: "Cameroon", code: "CM", dial: "+237", ccy: "XAF", providers: ["MTN", "ORANGE"], active: true, nsnLen: [9] },
  // The inactive corridors carry a PERMISSIVE length until their numbering plan is
  // confirmed against the operator, rather than a precise-looking guess. Narrow each one
  // when you activate it — a wrong length here refuses real customers.
  GA: { name: "Gabon", code: "GA", dial: "+241", ccy: "XAF", providers: ["AIRTEL", "MTN"], active: false, nsnLen: [8, 9] },
  TD: { name: "Chad", code: "TD", dial: "+235", ccy: "XAF", providers: ["AIRTEL", "MTN"], active: false, nsnLen: [8, 9] },
  CG: { name: "Congo", code: "CG", dial: "+242", ccy: "XAF", providers: ["MTN", "AIRTEL"], active: false, nsnLen: [9] },
  CF: { name: "Cent. Afr. Rep.", code: "CF", dial: "+236", ccy: "XAF", providers: ["ORANGE", "MTN"], active: false, nsnLen: [8] },
};

/** Local subscriber digits for a number (strips the country dial code). */
export function localDigits(phone: string, country: CountryCode): string {
  const d = phone.replace(/\D/g, "");
  const dial = COUNTRIES[country].dial.replace(/\D/g, "");
  return d.startsWith(dial) ? d.slice(dial.length) : d;
}

/** Is this string a real name, or just the number written back?
 *
 *  Payment creation stores `name || phone`, because the payout rails want a label and some
 *  require one. That is fine as a label and wrong as an identity: the digits then flowed
 *  into the identity graph as the person's NAME and came back out at trustLevel 2, verified
 *  — the platform telling a sender that this number belongs to "680344485". */
export function isRealName(name: string | null | undefined, phone: string): boolean {
  const n = (name ?? "").trim();
  if (n.length < 2) return false;
  const nd = n.replace(/\D/g, "");
  const pd = phone.replace(/\D/g, "");
  if (nd && pd && (nd === pd || pd.endsWith(nd) || nd.endsWith(pd))) return false; // the number back again
  return /\p{L}/u.test(n); // must contain an actual letter
}

export interface PhoneCheck {
  ok: boolean;
  /** Local subscriber digits, when they could be determined. */
  local: string;
  /** Operator that owns the number, by prefix. */
  provider: ProviderId | null;
  /** Machine-readable failure, for the caller to map to a message. */
  reason?: "empty" | "foreign_country" | "bad_length" | "unknown_operator";
  /** The country a foreign number actually belongs to, when we can tell. */
  belongsTo?: CountryCode;
}

/** Does this number make sense for this country, and whose network is it on?
 *
 *  Payment creation only ever checked "at least 8 digits". That accepted a number entered
 *  under the wrong country — a Gabon +241 number sent as Cameroon produced the MSISDN
 *  23724112345678, fourteen digits handed to a real payout rail — and accepted a number
 *  with three digits too many, which still matched an MTN prefix and would have been
 *  disbursed. Neither is recoverable once the rail acts on it.
 *
 *  A number whose operator cannot be determined is refused rather than routed on the
 *  dropdown's guess: paying MTN for an Orange number is a failed or misdirected payout, and
 *  the dropdown is the one part of this the sender is most likely to get wrong. */
export function checkPhone(phone: string, country: CountryCode): PhoneCheck {
  const raw = (phone ?? "").replace(/\D/g, "");
  if (!raw) return { ok: false, local: "", provider: null, reason: "empty" };

  // Typed with SOMEONE ELSE'S country code — say whose, so the UI can offer to switch.
  const own = COUNTRIES[country].dial.replace(/\D/g, "");
  if (!raw.startsWith(own)) {
    for (const c of Object.values(COUNTRIES)) {
      const d = c.dial.replace(/\D/g, "");
      if (c.code !== country && raw.startsWith(d) && raw.length > d.length) {
        return { ok: false, local: raw.slice(d.length), provider: null, reason: "foreign_country", belongsTo: c.code };
      }
    }
  }

  const local = localDigits(raw, country);
  if (!COUNTRIES[country].nsnLen.includes(local.length)) {
    return { ok: false, local, provider: null, reason: "bad_length" };
  }
  const provider = detectProvider(local, country);
  if (!provider || !COUNTRIES[country].providers.includes(provider)) {
    return { ok: false, local, provider: null, reason: "unknown_operator" };
  }
  return { ok: true, local, provider };
}

/** The CANONICAL key for a Mobile Money number: country plus local subscriber digits.
 *
 *  Every place that stores, compares or looks up a number must use this, and the reason is
 *  not tidiness. The identity graph used to key on the raw string a person typed and match
 *  on "the last 9 digits", which produced four distinct ways to pay the wrong person:
 *
 *    · "677000789", "677 000 789" and "+237677000789" made THREE identities for one person,
 *      so the trust layer could vouch with a name attached to whichever record it hit first;
 *    · the last-9-digits rule is country-blind, so a Congo +242 number and a Cameroon +237
 *      number sharing nine digits collided — a lookup of the Congo number answered with the
 *      Cameroonian's name, at the highest trust level the system has;
 *    · it also assumes a 9-digit national number, which is true of Cameroon and false of
 *      Gabon, Chad and CAR, where the same person entered locally and with their country
 *      code did not match at all;
 *    · and it silently reused an existing identity across countries, so a Congo recipient
 *      BECAME the Cameroonian.
 *
 *  In this market name confirmation is the safeguard against paying the wrong number, so a
 *  matching rule that can cross people is worse than having no names. Country is part of the
 *  key because a subscriber number is only unique within its country. */
export function phoneKey(phone: string, country: CountryCode): string {
  return `${country}:${localDigits(phone, country)}`;
}

/** Two numbers are the same subscriber only if they are the same country AND the same local
 *  digits. Never compare raw strings or bare digit runs. */
export function samePhone(a: string, b: string, country: CountryCode): boolean {
  return phoneKey(a, country) === phoneKey(b, country);
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

/** The Mobile Money number inside a MoMo›Me Lightning Address, or null.
 *
 *  Accepts the `lightning:` URI scheme (how the Receive screens encode the QR), a bare
 *  `<number>@<domain>`, and both the national and dial-code forms of the number — the LNURL
 *  server resolves either, so anything reading an address must too.
 *
 *  Only OUR domain resolves: an address at someone else's host is a Lightning wallet's
 *  business, not a Mobile Money payout, and treating it as one would send a payer into a
 *  flow that cannot deliver. Lives here beside LN_ADDRESS_DOMAIN so every surface that
 *  reads an address agrees with the one that serves it. */
export function lnAddressNumber(raw: string): string | null {
  const s = (raw || "").trim().replace(/^lightning:/i, "").replace(/^lnurlp:\/\//i, "");
  const at = s.indexOf("@");
  if (at < 1) return null;
  const user = s.slice(0, at);
  const domain = s.slice(at + 1).toLowerCase();
  if (domain !== LN_ADDRESS_DOMAIN.toLowerCase()) return null;
  const digits = user.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  // A bolt11 also starts with "ln" and can contain an @ in some encodings — but it never
  // reduces to a plausible phone number, so the digit-length gate above already excludes it.
  return digits;
}

/** Every crypto pay-in method, in the order the product presents them. Single source of
 *  truth: the send flow, the admin analytics split and the ops dashboard all read this, so
 *  adding a method can't leave one of them silently blind to its volume. Whether a method is
 *  actually OFFERED is a separate question — the operator's switches AND real rail support
 *  (see /config `methods`). */
export const ALL_METHODS: Method[] = ["LIGHTNING", "ONCHAIN", "USDT", "USDC"];

/* ---------- ERC-20 stablecoins (Ethereum mainnet) ----------
   Contract addresses and decimals for the two stablecoins we receive. Needed to build a
   scannable EIP-681 payment URI: without the CONTRACT a wallet cannot know which token is
   being asked for, and without the CHAIN ID it cannot know it is Ethereum rather than
   Tron/BSC/Polygon — where the same-looking 0x address is a different, unrecoverable
   destination. Both are 6-decimal tokens, so base units = amount × 1e6. */
export const ERC20 = {
  USDT: { contract: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6 },
  USDC: { contract: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6 },
} as const;

/** Ethereum mainnet. Named rather than inlined so the chain is never an unlabelled `1`. */
export const ETH_CHAIN_ID = 1;

/** EIP-681 payment URI for an ERC-20 transfer:
 *    ethereum:<token>@<chainId>/transfer?address=<recipient>&uint256=<baseUnits>
 *
 *  This is what goes in the QR. The plain address stays in `code` for copy-paste, exactly
 *  as Bitcoin keeps a bare address in `code` and a BIP-21 URI in `qr`. Two things the bare
 *  address could not carry: the CHAIN (a wallet on the wrong network sends to an address
 *  nobody controls) and the AMOUNT (a hand-typed amount that misses trips the underpayment
 *  guard and parks the payment in review). Base units are computed with string maths, not
 *  floats — 1e6 × a float can land a cent off, and here that is a wrong on-chain amount. */
export function erc20PaymentUri(asset: "USDT" | "USDC", address: string, amount: number): string {
  const { contract, decimals } = ERC20[asset];
  const [whole, frac = ""] = amount.toFixed(decimals).split(".");
  const baseUnits = `${whole}${frac.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  return `ethereum:${contract}@${ETH_CHAIN_ID}/transfer?address=${address}&uint256=${baseUnits}`;
}

/** BIP-21 payment URI. With `bolt11` it is a UNIFIED QR: a Lightning-capable wallet pays
 *  the invoice, and one that isn't simply ignores the unknown `lightning=` parameter and
 *  pays the on-chain address. That graceful degradation is why both fit in one code, and
 *  why there is no equivalent for the ERC-20 stablecoins — `bitcoin:` and `ethereum:` are
 *  disjoint namespaces that no wallet reads both of.
 *
 *  `bolt11` is omitted once the Lightning leg has expired: an invoice outlives its use long
 *  before the address does, and offering a dead one is worse than offering only the address. */
export function bip21(address: string, amountBtc: number, bolt11?: string): string {
  const base = `bitcoin:${address}?amount=${amountBtc.toFixed(8)}`;
  return bolt11 ? `${base}&lightning=${bolt11.toUpperCase()}` : base;
}

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
  // The ticker is in the name because BOTH stablecoins are "US Dollars" to a customer —
  // with USDC live they sat side by side in the method picker as two identical rows, one
  // of which you could only tell apart by its glyph. The pay screen has always said
  // "Send US Dollars (USDT)", so this just matches it.
  USDT: { name: "US Dollars (USDT)", arrival: "Within seconds", fast: true },
  USDC: { name: "US Dollars (USDC)", arrival: "Within seconds", fast: true },
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
