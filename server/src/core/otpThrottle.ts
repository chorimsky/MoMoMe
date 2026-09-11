/* ============================================================
   Per-PHONE OTP throttle. The per-IP rate limit does not protect the person being
   texted: six requests a minute from each of many IPs is an SMS bomb against one number,
   and each message costs us money. Whatever the source, a number gets at most 3 codes per
   15 minutes and 10 per day. Persisted so a restart does not reset the budget.
   ============================================================ */
import { register, touch } from "./persist.js";

const sends = new Map<string, number[]>(); // digits → send timestamps (ms)
register("otp_sends", () => Object.fromEntries(sends), (d: Record<string, number[]>) => { for (const [k, v] of Object.entries(d ?? {})) sends.set(k, v); });

const WINDOW_15M = 15 * 60_000, WINDOW_DAY = 24 * 3600_000;
export const OTP_PER_15M = 3, OTP_PER_DAY = 10;

/** Record and allow, or refuse with how long to wait. */
export function otpSendAllowed(phone: string, now = Date.now()): { ok: true } | { ok: false; retryAfterSec: number } {
  const d = phone.replace(/\D/g, "");
  const hist = (sends.get(d) ?? []).filter((t) => now - t < WINDOW_DAY);
  const last15 = hist.filter((t) => now - t < WINDOW_15M);
  if (last15.length >= OTP_PER_15M) return { ok: false, retryAfterSec: Math.ceil((last15[0] + WINDOW_15M - now) / 1000) };
  if (hist.length >= OTP_PER_DAY) return { ok: false, retryAfterSec: Math.ceil((hist[0] + WINDOW_DAY - now) / 1000) };
  hist.push(now);
  sends.set(d, hist);
  if (sends.size > 50_000) { const k = sends.keys().next().value; if (k) sends.delete(k); }
  touch("otp_sends");
  return { ok: true };
}
