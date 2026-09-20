/* ============================================================
   Lightning Address (LNURL-pay) — every Mobile Money number is reachable as
   <number>@momome.xyz. An external Lightning wallet that resolves the address
   sees the linked Mobile Money recipient, then pays a bolt11 invoice; the Sats
   settle to that Mobile Money account through the normal settlement engine.

   Spec: LUD-06 (payRequest) + LUD-16 (Lightning Address). The user part of the
   address is the Mobile Money number.
   ============================================================ */
import type { CountryCode, ProviderId } from "../../../shared/types.js";
import { MIN_XAF, MAX_XAF, checkPhone, lightningAddress, phoneDigits, splitDialed } from "../../../shared/domain.js";
import { getSettings, renderTemplate } from "./settings.js";
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
  const d = phoneDigits(user);
  if (d.length < 8 || d.length > 15) return null;
  // The same reading every other entry point uses: a dialed number adopts its country
  // (only when the rest fits that country's plan), a bare one is Cameroon.
  const { country } = splitDialed(d, "CM");
  // The SAME shape check a payout recipient gets. This rule used to be its own copy —
  // "at least 8 digits and a known prefix", with no upper bound — so a Lightning Address
  // for 677000789000 resolved, returned a payable request, and a wallet anywhere in the
  // world could pay it. The crypto would land against a number that can never be paid out:
  // the payout MSISDN would be 237677000789000. Minting an invoice for a number we cannot
  // settle to is taking money we cannot deliver.
  const check = checkPhone(d, country);
  if (!check.ok) return null;
  return { national: check.local, country, provider: check.provider! };
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

/** LUD-06 metadata array (JSON-encoded), from the operator-managed templates (Settings →
 *  Lightning Address message). The text/plain line is the ONLY thing an external wallet
 *  shows before "Pay": it is the payer's chance to see that the number belongs to the person
 *  they mean, so the registered name leads — and when there is none, the line says so
 *  instead of looking reassuring. Mobile Money cannot be reversed. */
export function lnurlMetadata(opts: { national: string; provider: ProviderId; name?: string | null; address: string }): string {
  const name = opts.name?.trim();
  const t = getSettings().messages.lightningAddress;
  const vars = lnVars({ national: opts.national, provider: opts.provider, name });
  const meta: Array<[string, string]> = [
    ["text/plain", renderTemplate(name ? t.line : t.lineNoName, vars)],
    ["text/long-desc", renderTemplate(name ? t.longDesc : t.longDescNoName, vars)],
    ["text/identifier", opts.address],
  ];
  return JSON.stringify(meta);
}
/** LUD-09 success message, from the same templates; the spec caps it at 144 characters. */
export function lnurlSuccessMessage(opts: { national: string; provider: ProviderId; name?: string | null; ref: string }): string {
  const name = opts.name?.trim();
  const vars = lnVars({ national: opts.national, provider: opts.provider, name: name || `${opts.provider} ···${opts.national.slice(-4)}`, ref: opts.ref });
  return renderTemplate(getSettings().messages.lightningAddress.success, vars).slice(0, 144);
}
export function lnVars(o: { national: string; provider: string; name?: string | null; ref?: string }): Record<"name" | "operator" | "number" | "last4" | "brand" | "ref", string> {
  return { name: o.name ?? "", operator: o.provider, number: o.national, last4: o.national.slice(-4), brand: getSettings().company.brand, ref: o.ref ?? "" };
}

/** The canonical address for a resolved recipient — the same builder the Receive screens
 *  and the identity layer use, so metadata, sender ids and what the customer shows agree. */
export function lnAddress(r: Pick<LnRecipient, "national" | "country">): string {
  return lightningAddress(r.national, r.country);
}
