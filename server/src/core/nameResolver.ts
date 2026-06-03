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

export async function resolveRecipient(phone: string, country: CountryCode = "CM"): Promise<ResolveResult> {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 8) return { status: "idle" };
  // Operator detected from the number's prefix — the routing/identity anchor,
  // returned with every result so the UI confirms it and the payout routes right.
  const provider = detectProvider(phone, country);

  // 1. Internal identity graph — a number we've paid before. The previously
  //    confirmed name takes precedence over the provider's record.
  const known = getIdentityByDigits(digits);
  if (known?.name) {
    touchLastSeen(known.phone);
    return { status: "internal", name: known.name, verified: true, trustLevel: 2, provider };
  }

  // 2. Mobile Money provider name lookup, cached per number.
  const lookup = await pawapay.lookupName(phone);
  if (lookup?.name) {
    return { status: "provider", name: lookup.name, verified: true, trustLevel: 1, provider };
  }

  // 3. No name on file — require manual confirmation before paying.
  return { status: "unknown", verified: false, trustLevel: 3, provider };
}
