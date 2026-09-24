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

const MAX_TRACKED = 20_000;
const WINDOW_MS = 24 * 3600_000;

export function noteInbound(from: string, at = new Date().toISOString()): void {
  lastInbound.set(waDigits(from), at);
  if (lastInbound.size > MAX_TRACKED) evictOne(Date.parse(at));
  touch("whatsapp_inbound");
}

/** Drop an entry that is ALREADY USELESS before dropping one that is not.
 *
 *  This used to delete `keys().next().value` — the first key ever inserted. A Map does not
 *  reorder on `set`, so that is the number that FIRST messaged us, not the one that messaged
 *  us longest ago: the most loyal daily user was first in line to be evicted, and losing
 *  their entry closes their 24 h window, so their next notice degrades to a template (or is
 *  skipped when no template covers that kind). An entry past the window is already dead —
 *  `inReplyWindow` returns false for it — so that is what should go. */
function evictOne(now: number): void {
  let oldestKey: string | undefined; let oldestAt = Infinity;
  for (const [k, v] of lastInbound) {
    const t = Date.parse(v);
    if (now - t >= WINDOW_MS) { lastInbound.delete(k); return; }   // expired: free, take it
    if (t < oldestAt) { oldestAt = t; oldestKey = k; }
  }
  if (oldestKey) lastInbound.delete(oldestKey);                    // none expired: the truly oldest
}
/** Inside Meta's 24 h customer-service window for this number? */
export function inReplyWindow(phone: string, now = Date.now()): boolean {
  const at = lastInbound.get(waDigits(phone));
  return !!at && now - Date.parse(at) < WINDOW_MS;
}
/** Test hook: run one eviction, as a full tracker would. */
export function _evictOnce(now = Date.now()): void { evictOne(now); }
/** Test hook: how many numbers are tracked, and how many still have an open window. */
export function _windowState(now = Date.now()): { tracked: number; open: number } {
  let open = 0;
  for (const v of lastInbound.values()) if (now - Date.parse(v) < WINDOW_MS) open++;
  return { tracked: lastInbound.size, open };
}
export function whatsappContacts(): number { return lastInbound.size; }
