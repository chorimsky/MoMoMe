/* ============================================================
   Support contact — single source of truth for the public Help /
   Contact surfaces. Values come from the admin Settings (Company)
   via /config; these defaults are only a pre-load fallback.
   ============================================================ */

export interface SupportContact {
  email: string;
  phone: string;
  /** The WhatsApp Business number the BOT answers on — not the support number, which is a
   *  person. Empty when no bot number is configured, and every surface that would point at
   *  it simply does not render: an advertised bot nobody answers is worse than none. */
  whatsappBot?: string;
}

export const DEFAULT_SUPPORT: SupportContact = {
  email: "info@momome.xyz",
  phone: "+237 233 00 00 00",
};

/** Digits only — for the wa.me path. An optional prefilled first message means the bot's
 *  very first reply is its menu, instead of the person having to guess what to type. */
export function waLink(phone: string, text?: string): string {
  const base = `https://wa.me/${phone.replace(/\D/g, "")}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/** tel: URI — keep a leading +, strip everything else but digits. */
export function telLink(phone: string): string {
  const d = phone.replace(/[^\d+]/g, "");
  return `tel:${d.startsWith("+") ? d : `+${d}`}`;
}
