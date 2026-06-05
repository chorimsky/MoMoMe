/* ============================================================
   Lightning Address (LNURL-pay) — every Mobile Money number is reachable as
   <number>@momome.xyz. An external Lightning wallet that resolves the address
   sees the linked Mobile Money recipient, then pays a bolt11 invoice; the Sats
   settle to that Mobile Money account through the normal settlement engine.

   Spec: LUD-06 (payRequest) + LUD-16 (Lightning Address). The user part of the
   address is the Mobile Money number.
   ============================================================ */
import type { CountryCode, ProviderId } from "../../../shared/types.js";
import { COUNTRIES, LN_ADDRESS_DOMAIN, MIN_XAF, MAX_XAF, detectProvider, localDigits } from "../../../shared/domain.js";
import { getSettings } from "./settings.js";
import { rateFor } from "./fx.js";

export const SATS_PER_BTC = 100_000_000;
export const MSAT_PER_SAT = 1_000;

export interface LnRecipient {
  /** National significant number (no country code) — the payout target. */
  national: string;
  country: CountryCode;
  provider: ProviderId;
}

/** Parse the user part of a Lightning Address (the Mobile Money number) into a
 *  routable recipient. Accepts national (677000789) or full (237677000789). */
export function parseLnUser(user: string): LnRecipient | null {
  const d = String(user ?? "").replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return null;
  // If the number carries a CEMAC dial code prefix, adopt that country; else CM.
  let country: CountryCode = "CM";
  for (const co of Object.values(COUNTRIES)) {
    const dial = co.dial.replace(/\D/g, "");
    if (d.startsWith(dial) && d.length > dial.length) { country = co.code; break; }
  }
  const national = localDigits(d, country);
  if (national.length < 8) return null;
  const provider = detectProvider(national, country);
  if (!provider || !COUNTRIES[country].providers.includes(provider)) return null;
  return { national, country, provider };
}

/** Convert a payer-chosen msat amount into the XAF the recipient receives.
 *  Inverse of the normal quote: the payer picks BTC, we derive XAF after the
 *  FX spread, then split out the platform fee. */
export function quoteFromMsat(msat: number): { btc: number; totalXaf: number; xaf: number; feeXaf: number } {
  const btc = msat / MSAT_PER_SAT / SATS_PER_BTC;
  const rq = rateFor("LIGHTNING");
  const totalXaf = Math.round(btc * rq.customerXafPerUnit);
  const feePct = getSettings().pricing.feePct;
  const xaf = Math.round(totalXaf / (1 + feePct));
  const feeXaf = totalXaf - xaf;
  return { btc, totalXaf, xaf, feeXaf };
}

/** msat needed to deliver a given XAF total (for min/max sendable bounds). */
export function msatForXaf(totalXaf: number): number {
  const rq = rateFor("LIGHTNING");
  const btc = totalXaf / rq.customerXafPerUnit;
  return Math.round(btc * SATS_PER_BTC * MSAT_PER_SAT);
}

/** Sendable range (msat), derived from the corridor's XAF limits + the platform
 *  fee, so a payer can never under/overshoot what the engine will settle. */
export function sendableRangeMsat(): { min: number; max: number } {
  const feePct = getSettings().pricing.feePct;
  return {
    min: Math.max(1000, msatForXaf(Math.round(MIN_XAF * (1 + feePct)))),
    max: msatForXaf(Math.round(MAX_XAF * (1 + feePct))),
  };
}

/** LUD-06 metadata array (JSON-encoded). The text/plain line is what the payer's
 *  wallet shows — it names the linked Mobile Money recipient + number. */
export function lnurlMetadata(opts: { national: string; provider: ProviderId; name?: string | null; address: string }): string {
  const who = opts.name && opts.name.trim() ? `${opts.name.trim()} · ` : "";
  const desc = `Pay ${who}${opts.provider} Mobile Money ${opts.national} via MoMo›Me`;
  const meta: Array<[string, string]> = [
    ["text/plain", desc],
    ["text/identifier", opts.address],
  ];
  return JSON.stringify(meta);
}

export function lnAddress(national: string): string {
  return `${national}@${LN_ADDRESS_DOMAIN}`;
}
