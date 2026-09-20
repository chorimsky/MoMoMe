/* PaymentIdentityResolver — from whatever a person typed to WHO is being paid and WHERE
   value can reach them. The phone number is the identity; the Lightning Address is one
   interoperable representation of it (LUD-16); Mobile Money is one destination. Nothing
   here fabricates: a destination is listed only when a configured provider can reach it,
   and the holder's name comes only from the Identity Resolution chain. */
import type { PaymentIdentity, PaymentDestination, IdentityType } from "../../../../shared/upi.js";
import { normalizeMsisdn } from "../identityResolution/msisdn.js";
import { resolveIdentity, cachedSnapshot, snapshotOf, capabilityConfig, identityEnabled } from "../identityResolution/resolver.js";
import type { IdentityPurpose } from "../../../../shared/identity.js";
import { lightningAddress, lnAddressNumber, LN_ADDRESS_DOMAIN, COUNTRIES } from "../../../../shared/domain.js";
import { MARKETS } from "../network/markets.js";
import { PAYOUTS } from "../../adapters/payouts.js";
import { flag } from "./flags.js";
import { liveMoney } from "../../config.js";
import { IdentityError } from "../identityResolution/errors.js";

export interface ResolveOptions { purpose: IdentityPurpose; actor: string; defaultCountry?: string; live?: boolean }

/** What kind of identity is this string? MSISDN unless it is clearly something else. */
export function classifyIdentity(raw: string): IdentityType {
  const s = raw.trim();
  if (/^\$[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) return "UMA";
  if (/^momome:/i.test(s)) return "MOMOME_ADDRESS";
  if (/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(s)) return /^\d{8,15}@/.test(s) && s.toLowerCase().endsWith(`@${LN_ADDRESS_DOMAIN}`) ? "MOMOME_ADDRESS" : /^[^@\s]+@/.test(s) && /\d{8,15}@/.test(s) ? "LIGHTNING_ADDRESS" : (/^[a-z0-9._%+-]+@/i.test(s) ? "LIGHTNING_ADDRESS" : "EMAIL");
  return "MSISDN";
}

export async function resolve(raw: string, o: ResolveOptions): Promise<PaymentIdentity> {
  switch (classifyIdentity(raw)) {
    case "MSISDN": return resolvePhone(raw, o);
    case "MOMOME_ADDRESS": return resolveMomoMeAddress(raw, o);
    case "LIGHTNING_ADDRESS": return resolveLightningAddress(raw, o);
    case "UMA": return resolveUMA(raw);
    default: throw new IdentityError("IDENTITY_INVALID_IDENTIFIER", "Enter a Mobile Money number.");
  }
}

export async function resolvePhone(raw: string, o: ResolveOptions): Promise<PaymentIdentity> {
  const n = normalizeMsisdn(raw, o.defaultCountry ?? "CM");
  const id: PaymentIdentity = { type: "MSISDN", canonical: n.identifier, country: n.country, currency: n.currency ?? undefined, operator: n.operator, native: true };
  if (identityEnabled()) {
    const snap = cachedSnapshot(n.identifier, n.country) ?? (o.live !== false ? snapshotOf(await resolveIdentity({ identifier: n.identifier, defaultCountry: n.country, purpose: o.purpose, actor: o.actor })) : null);
    if (snap) id.verification = snap;
  }
  return id;
}
/** "237674123456@momome.xyz" or "momome:+237674123456" → the same identity as the number. */
export async function resolveMomoMeAddress(raw: string, o: ResolveOptions): Promise<PaymentIdentity> {
  const s = raw.trim().replace(/^momome:/i, "");
  const digits = lnAddressNumber(s) ?? s;
  return resolvePhone(digits.startsWith("+") ? digits : `+${digits}`, o);
}
/** A Lightning Address at OUR domain is a MoMo›Me identity; at any other domain it is a
 *  foreign destination we can pay as given (LUD-16) but cannot resolve further. */
export async function resolveLightningAddress(raw: string, o: ResolveOptions): Promise<PaymentIdentity> {
  const s = raw.trim().toLowerCase();
  if (s.endsWith(`@${LN_ADDRESS_DOMAIN}`)) return resolveMomoMeAddress(s, o);
  return { type: "LIGHTNING_ADDRESS", canonical: s, native: false };
}
/** UMA ($alice@provider) is LUD-16 with compliance messaging on top. We can model it as a
 *  destination; we do not speak the protocol yet, and say so. */
export async function resolveUMA(raw: string): Promise<PaymentIdentity> {
  if (!flag("UMA_COMPATIBILITY_ENABLED")) throw new IdentityError("IDENTITY_UNSUPPORTED_OPERATOR", "UMA addresses are not supported yet.");
  return { type: "UMA", canonical: raw.trim().toLowerCase(), native: false };
}

/** Every place value can reach this identity, with what we actually know about each. */
export function getDestinations(id: PaymentIdentity): PaymentDestination[] {
  if (id.type === "LIGHTNING_ADDRESS") return [{ rail: "LIGHTNING", protocol: "LIGHTNING_ADDRESS", address: id.canonical, status: "UNVERIFIED" }];
  if (id.type === "UMA") return [{ rail: "UMA", address: id.canonical, status: "UNVERIFIED" }];
  if (id.type !== "MSISDN" || !id.country) return [];
  const out: PaymentDestination[] = [];
  const digits = id.canonical.replace(/^\+/, "");
  const cm = id.country in COUNTRIES ? COUNTRIES[id.country as keyof typeof COUNTRIES] : null;
  const market = MARKETS[id.country];
  const currency = id.currency ?? market?.currency ?? cm?.ccy ?? "";
  if (id.operator) {
    const v = id.verification?.status;
    // Reachable = the V1 engine would pay it: a configured rail for the operator, or the
    // sandbox's simulated rail while no real money is live (exactly V1's own rule).
    const reachable = id.country === "CM" ? (!!cm?.providers.includes(id.operator as never) && (PAYOUTS.some((r) => r.configured() && r.supports(id.operator as never)) || !liveMoney())) : !!market?.providers.find((p) => p.id === id.operator)?.payout;
    out.push({ rail: "MOBILE_MONEY", provider: id.operator, country: id.country, currency, identifier: id.canonical, status: !reachable ? "UNSUPPORTED" : v === "VERIFIED" ? "ACTIVE" : v === "INACTIVE" ? "INACTIVE" : v === "NOT_FOUND" ? "INACTIVE" : "UNVERIFIED" });
  }
  // Never a STABLECOIN or BANK destination: the settlement model is pass-through to local
  // money — MoMo›Me holds nothing and sends no stablecoin (docs/upi/STABLECOIN_CUSTODY_MODEL.md).
  // The LUD-16 representation exists for every payable number — it is how the world's
  // Lightning wallets reach a Mobile Money account today.
  if (id.country === "CM" && id.operator) out.push({ rail: "LIGHTNING", protocol: "LIGHTNING_ADDRESS", address: lightningAddress(digits.slice(3), "CM"), status: out[0]?.status === "UNSUPPORTED" ? "UNSUPPORTED" : "ACTIVE" });
  return out;
}
/** Which rails a payer could use to fund a payment to this identity, and which can settle it. */
export function getCapabilities(id: PaymentIdentity): { funding: string[]; settlement: string[]; identity_verification: boolean } {
  const d = getDestinations(id);
  const mm = d.find((x) => x.rail === "MOBILE_MONEY");
  const idCap = id.type === "MSISDN" && id.country && id.operator ? !!capabilityConfig()[id.country]?.[id.operator]?.identity_resolution : false;
  return {
    funding: mm && mm.status !== "UNSUPPORTED" ? ["LIGHTNING", "USDT/ETHEREUM", "USDC/ETHEREUM", "MOBILE_MONEY"] : d.some((x) => x.rail === "LIGHTNING") ? ["LIGHTNING"] : [],
    settlement: d.filter((x) => x.status !== "UNSUPPORTED").map((x) => x.rail),
    identity_verification: idCap && identityEnabled(),
  };
}
