/* ============================================================
   WhatsApp state — who has talked to our number, and when.

   Meta's rule: a business may send free-form text to a person only within 24 h of that
   person's last message; outside the window only an approved template gets delivered.
   So the bot remembers the last inbound per number (persisted), and the channel picks
   text vs template accordingly. Numbers are international digits, no plus.
   ============================================================ */
import { register, touch } from "./persist.js";

const lastInbound = new Map<string, string>(); // digits → ISO
register("whatsapp_inbound", () => Object.fromEntries(lastInbound), (d: Record<string, string>) => { for (const [k, v] of Object.entries(d ?? {})) lastInbound.set(k, v); });

export const waDigits = (phone: string): string => phone.replace(/\D/g, "");

export function noteInbound(from: string, at = new Date().toISOString()): void {
  lastInbound.set(waDigits(from), at);
  if (lastInbound.size > 20_000) { const first = lastInbound.keys().next().value; if (first) lastInbound.delete(first); }
  touch("whatsapp_inbound");
}
/** Inside Meta's 24 h customer-service window for this number? */
export function inReplyWindow(phone: string, now = Date.now()): boolean {
  const at = lastInbound.get(waDigits(phone));
  return !!at && now - Date.parse(at) < 24 * 3600_000;
}
export function whatsappContacts(): number { return lastInbound.size; }
