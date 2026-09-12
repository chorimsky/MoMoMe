/* ============================================================
   Payment address resolution — "where can this address receive value?"

   A phone number is a PAYMENT ADDRESS, not a Mobile Money account: today it lands on MTN or
   Orange via a payout aggregator and can be reached from any Lightning wallet through its
   Lightning Address; tomorrow the same number may resolve to a bank or a card. Everything
   here derives from systems that already exist (checkPhone, identity/name resolver,
   merchant registry, LNURL server, receive links). Nothing internal is exposed: the owner
   name is what the operator shows any payer anyway, and only when it is on file.
   ============================================================ */
import type { CountryCode, ProviderId } from "../../../../shared/types.js";
import type { PaymentAddress, PaymentAddressType } from "../../../../shared/interop.js";
import { COUNTRIES, MIN_XAF, PROVIDER_PAYOUT_MAX, MAX_XAF, checkPhone, lnAddressNumber, parseReceiveLink, lightningAddress } from "../../../../shared/domain.js";
import { resolveRecipient } from "../nameResolver.js";
import { isReviewPhone, reviewAccess } from "../review.js";
import { payoutBlocked } from "../merchant.js";
import { merchantByCode } from "../merchantAccount.js";
import { getSettings } from "../settings.js";
import { payoutsFor } from "../../adapters/payouts.js";
import { payoutHealth } from "../routing.js";
import { phoenixdConfigured, ibexConfigured, liveMoney } from "../../config.js";

function countryOf(digits: string): CountryCode {
  for (const c of Object.values(COUNTRIES)) { const d = c.dial.replace(/\D/g, ""); if (digits.startsWith(d) && digits.length > d.length) return c.code; }
  return "CM";
}

/** Classify a raw string a user typed, scanned or pasted. */
export function classify(raw: string): { type: PaymentAddressType; value: string; amount?: number } | null {
  const s = (raw ?? "").trim();
  if (!s) return null;
  const rl = parseReceiveLink(s);
  if (rl) return { type: "PAYMENT_LINK", value: rl.to, ...(rl.amountXaf ? { amount: rl.amountXaf } : {}) };
  const ln = lnAddressNumber(s);
  if (ln) return { type: "LIGHTNING_ADDRESS", value: ln };
  if (/^MOM-[A-Za-z]{2}-\d{4,8}$/i.test(s)) return { type: "MERCHANT_CODE", value: s.toUpperCase() };
  const m = s.match(/\/(?:pay|m)\/([A-Za-z0-9_-]{4,40})/);
  if (m) return { type: "MERCHANT_CODE", value: m[1] };
  const digits = s.replace(/\D/g, "");
  if (digits.length >= 8 && digits.length <= 15 && /^[+\d][\d\s().-]*$/.test(s)) return { type: "PHONE", value: digits };
  return null;
}

/** Resolve a PHONE-shaped address to the rails that can reach it. */
async function resolvePhone(digits: string, countryHint?: CountryCode): Promise<PaymentAddress> {
  const country = countryHint ?? countryOf(digits);
  const chk = checkPhone(digits, country);
  const value = chk.ok ? `${COUNTRIES[country].dial.replace(/\D/g, "")}${chk.local}` : digits;
  const base: PaymentAddress = {
    id: `PHONE:${value}`, type: "PHONE", value,
    owner: { displayName: null, nameVerified: false, kind: "unknown" }, verified: false,
    country, currency: COUNTRIES[country].ccy, rails: [], defaultRail: null, status: "UNSUPPORTED",
  };
  if (!chk.ok) return { ...base, rails: [{ rail: "mobile_money", provider: "-", currency: COUNTRIES[country].ccy, available: false, reason: chk.reason }] };
  if (reviewAccess() && isReviewPhone(chk.local)) return { ...base, status: "RESERVED" };
  if (payoutBlocked(chk.local, country)) return { ...base, status: "BLOCKED" };
  const provider = chk.provider as ProviderId;
  const who = await resolveRecipient(chk.local, country).catch(() => null);
  const payouts = payoutsFor(provider).filter((p) => p.configured());
  const mm = payouts.map((p) => ({ p, h: payoutHealth(p.name) }));
  // A live-money deployment needs a real, eligible payout rail. A demo/sandbox deployment
  // settles through the simulator (exactly as selectFundedAggregator does), so the address
  // is reachable there too — otherwise nothing could be exercised before go-live.
  const simulated = !liveMoney() && mm.length === 0;
  const available = getSettings().ops.acceptingPayments && (mm.some((x) => x.h.eligible) || simulated);
  const rails: PaymentAddress["rails"] = [
    { rail: "mobile_money", provider: provider, currency: COUNTRIES[country].ccy, available, reason: available ? (simulated ? "simulated payout (sandbox deployment)" : undefined) : (mm.length ? "payout rail unavailable" : "no payout rail for this operator") },
  ];
  // Receiving FROM Lightning: the number has a Lightning Address any wallet can pay — our
  // LNURL server always answers for it; the invoice comes from whichever Lightning rail is
  // configured (the simulator on a sandbox deployment).
  const lnRail = phoenixdConfigured() ? "phoenixd" : ibexConfigured() ? "ibex" : !liveMoney() ? "sandbox" : null;
  if (lnRail) rails.push({ rail: "lightning", provider: lnRail, currency: "BTC", available: true, ...(lnRail === "sandbox" ? { reason: "simulated invoice (sandbox deployment)" } : {}) });
  return {
    ...base,
    owner: { displayName: who?.name ?? null, nameVerified: who?.status === "provider" || who?.status === "internal", kind: "person" },
    verified: who?.status === "internal", // an internal name comes from a claimed/anchored account
    rails, defaultRail: "mobile_money", status: available ? "ACTIVE" : "UNSUPPORTED",
    limits: { currency: COUNTRIES[country].ccy, min: MIN_XAF, max: Math.min(MAX_XAF, PROVIDER_PAYOUT_MAX[provider] ?? MAX_XAF) },
  };
}

export async function resolveAddress(raw: string, countryHint?: CountryCode): Promise<(PaymentAddress & { amountHint?: number; lightningAddress?: string }) | null> {
  const c = classify(raw);
  if (!c) return null;
  if (c.type === "PHONE" || c.type === "PAYMENT_LINK" || c.type === "LIGHTNING_ADDRESS") {
    const a = await resolvePhone(c.value, countryHint);
    const ln = a.status === "ACTIVE" && a.country ? lightningAddress(a.value, a.country) : undefined;
    return { ...a, type: c.type === "PHONE" ? "PHONE" : c.type, ...(c.amount ? { amountHint: c.amount } : {}), ...(ln ? { lightningAddress: ln } : {}) };
  }
  if (c.type === "MERCHANT_CODE") {
    const m = merchantByCode(c.value);
    if (!m || !m.settlementPhone) return { id: `MERCHANT_CODE:${c.value}`, type: "MERCHANT_CODE", value: c.value, owner: { displayName: null, nameVerified: false, kind: "merchant" }, verified: false, country: null, currency: null, rails: [], defaultRail: null, status: "UNSUPPORTED" };
    const a = await resolvePhone(m.settlementPhone, m.country ?? "CM");
    return { ...a, id: `MERCHANT_CODE:${c.value}`, type: "MERCHANT_CODE", value: c.value, owner: { displayName: m.businessName, nameVerified: !!m.verifiedPhone, kind: "merchant" }, verified: !!m.verifiedPhone };
  }
  return null;
}
