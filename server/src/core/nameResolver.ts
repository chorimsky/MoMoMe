/* ============================================================
   Recipient Identity Resolution — the trust layer.
   Resolution order (the whole point):
     1. Internal identity graph  → "known" (Level 2), highest trust:
        the name the user previously confirmed wins.
     2. Mobile Money provider (PawaPay) → "provider-verified" (Level 1).
     3. Nothing on file → "unknown" (Level 3) → manual confirmation.
   In Cameroon, name confirmation is the trust mechanism: most mistakes
   happen at number entry, not at payment.
   ============================================================ */
import type { ResolveResult, CountryCode } from "../../../shared/types.js";
import { detectProvider } from "../../../shared/domain.js";
import { getIdentityByDigits, touchLastSeen } from "./identity.js";
import * as pawapay from "../adapters/pawapay.js";

/** The name a Mobile Money number is REGISTERED to, as far as we can know it.
 *
 *  Every number belongs to a named account holder. Two sources can tell us who:
 *    1. the operator's own record — authoritative whenever a rail exposes it;
 *    2. our identity graph — the name a payout actually landed under, which the payout
 *       rail accepted for that number. Learned, so second.
 *  The old order was the reverse: a name a sender once TYPED outranked the operator's
 *  record, so a wrong label, once paid, became "verified" for everyone after. Nothing a
 *  sender types can outrank the operator. */
export async function registeredName(phone: string, country: CountryCode = "CM"): Promise<{ name: string; source: "provider" | "internal" } | null> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return null;
  const lookup = await pawapay.lookupName(phone).catch(() => null);
  if (lookup?.name) return { name: lookup.name, source: "provider" };
  // Country-scoped: a subscriber number is only unique inside its own country, and the
  // old country-blind match answered a Congo number with a Cameroonian's name.
  const known = getIdentityByDigits(phone, country);
  if (known?.name) {
    touchLastSeen(known.phone, known.country);
    return { name: known.name, source: "internal" };
  }
  return null;
}

export async function resolveRecipient(phone: string, country: CountryCode = "CM"): Promise<ResolveResult> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return { status: "idle" };
  // Operator detected from the number's prefix — the routing/identity anchor,
  // returned with every result so the UI confirms it and the payout routes right.
  const provider = detectProvider(phone, country);
  const reg = await registeredName(phone, country);
  if (reg) {
    return { status: reg.source, name: reg.name, verified: true, trustLevel: reg.source === "provider" ? 1 : 2, provider };
  }
  // No name on file — the sender must say who this is, and that name is checked against
  // the registered one the moment we learn it.
  return { status: "unknown", verified: false, trustLevel: 3, provider };
}
