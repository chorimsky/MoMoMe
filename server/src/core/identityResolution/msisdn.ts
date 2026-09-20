/* ============================================================
   MSISDN normalization — one place, one library. Inputs like "674123456",
   "+237674123456", "237674123456", "6 74 12 34 56" all become "+237674123456" with the
   country, national number and operator attached. No regex-only parsing: libphonenumber
   decides validity per country; the operator comes from the market's own prefix table
   (Cameroon has no number portability, so prefixes are authoritative; where a market does
   have portability the aggregator's prediction overrides — see operators.ts).
   ============================================================ */
import { parsePhoneNumberFromString, type CountryCode as LibCountry } from "libphonenumber-js/max";
import type { NormalizedIdentifier } from "../../../../shared/identity.js";
import { detectProvider, COUNTRIES, phoneDigits, localDigits } from "../../../../shared/domain.js";
import { MARKETS } from "../network/markets.js";
import { IdentityError } from "./errors.js";

/** Countries whose numbers we can at least identify (V1 countries + network markets). */
export const SUPPORTED_COUNTRIES = (): string[] => [...new Set([...Object.keys(COUNTRIES), ...Object.keys(MARKETS)])];

export function normalizeMsisdn(input: string, defaultCountry = "CM"): NormalizedIdentifier {
  const raw = String(input ?? "").trim();
  if (!raw) throw new IdentityError("IDENTITY_INVALID_IDENTIFIER", "Enter a Mobile Money number.");
  // The same reading as the V1 helpers (shared/domain phoneDigits + localDigits): Unicode
  // digits, "00"/"+" international prefixes and a stray trunk "0" are all understood, so a
  // number V1 accepts is never refused here as "invalid" and vice versa. A number whose
  // digits fit the default country's plan (after its own dial code and trunk 0 are removed)
  // is read as that country's; anything else is read as international.
  const digits = phoneDigits(raw);
  const home = (COUNTRIES as Record<string, { dial: string; nsnLen: number[] }>)[defaultCountry];
  const knownDials = [...Object.values(COUNTRIES).map((c) => c.dial.replace(/\D/g, "")), ...Object.values(MARKETS).map((m) => m.dial.replace(/\D/g, ""))];
  const explicitIntl = /^\s*(\+|00)/.test(raw); // the sender SAID which country
  let cleaned: string;
  if (explicitIntl) {
    // "+237 0674…": the trunk 0 slips in after a dial code too — read it under that country.
    const own = Object.values(COUNTRIES).find((c) => digits.startsWith(c.dial.replace(/\D/g, "")));
    cleaned = own ? `${own.dial}${localDigits(digits, own.code)}` : `+${digits}`;
  } else if (home && home.nsnLen.includes(localDigits(digits, defaultCountry as keyof typeof COUNTRIES).length)) {
    cleaned = `${home.dial}${localDigits(digits, defaultCountry as keyof typeof COUNTRIES)}`;   // a complete home number
  } else if (knownDials.some((d) => digits.startsWith(d) && digits.length > d.length + 5)) {
    cleaned = `+${digits}`;                                                                       // another market's number, dialed
  } else {
    cleaned = home ? `${home.dial}${digits}` : digits;                                             // wrong length for home → invalid, never "Tokelau"
  }
  const parsed = parsePhoneNumberFromString(cleaned, defaultCountry as LibCountry);
  if (!parsed || !parsed.isPossible()) throw new IdentityError("IDENTITY_INVALID_IDENTIFIER", "That is not a valid phone number.");
  const country = parsed.country ?? defaultCountry;
  if (!SUPPORTED_COUNTRIES().includes(country)) throw new IdentityError("IDENTITY_UNSUPPORTED_COUNTRY", `Numbers in ${country} cannot be verified yet.`);
  // isValid() checks the national numbering plan; a possible-but-invalid number is refused
  // rather than sent to a provider (enumeration surface, wasted calls).
  if (!parsed.isValid()) throw new IdentityError("IDENTITY_INVALID_IDENTIFIER", "That number is not valid for its country.");
  const national = parsed.nationalNumber;
  const operator = resolveOperatorByPrefix(country, national);
  const currency = MARKETS[country]?.currency ?? (COUNTRIES as Record<string, { ccy?: string }>)[country]?.ccy ?? null;
  return { type: "MSISDN", identifier: parsed.number, countryCode: parsed.countryCallingCode, nationalNumber: national, country, operator, currency };
}

/** Operator by prefix. Cameroon uses the production table (shared/domain); other markets
 *  fall back to the market's first payout-capable provider until a prediction/contract
 *  says otherwise — and are marked so by the resolver (operator confidence "prefix"). */
export function resolveOperatorByPrefix(country: string, national: string): string | null {
  // A V1 country whose corridor is not open has no confirmed prefix table: its "first
  // provider" is a placeholder, not an operator, and must not be presented as one.
  if (country in COUNTRIES) return COUNTRIES[country as keyof typeof COUNTRIES].active ? detectProvider(national, country as keyof typeof COUNTRIES) : null;
  const m = MARKETS[country];
  return m?.providers[0]?.id ?? null;
}

/** Stable, keyed hash of an identifier for logs, audit rows and cache keys — the raw number
 *  never goes into a log line or an index. */
export function identifierHash(e164: string): string {
  return hmac(e164);
}
export const last4 = (e164: string) => e164.slice(-4);

import { createHmac } from "node:crypto";
const KEY = process.env.IDENTITY_HASH_KEY || process.env.COMPLIANCE_HMAC_KEY || process.env.ADMIN_SESSION_SECRET || "momome-identity-dev";
function hmac(s: string): string { return createHmac("sha256", KEY).update(s).digest("hex").slice(0, 32); }
