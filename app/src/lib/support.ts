/* ============================================================
   Support contact — single source of truth for the public Help /
   Contact surfaces. Values come from the admin Settings (Company)
   via /config; these defaults are only a pre-load fallback.
   ============================================================ */

export interface SupportContact {
  email: string;
  phone: string;
}

export const DEFAULT_SUPPORT: SupportContact = {
  email: "info@momome.xyz",
  phone: "+237 233 00 00 00",
};

/** Digits only — for the wa.me path. */
export function waLink(phone: string): string {
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

/** tel: URI — keep a leading +, strip everything else but digits. */
export function telLink(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  return `tel:${d.startsWith("+") ? d : `+${d}`}`;
}
