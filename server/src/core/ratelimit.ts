/* ============================================================
   In-memory fixed-window rate limiter (no external dependency, fits the
   in-memory architecture). Keyed by an arbitrary string, e.g. "login:<ip>".
   Buckets self-expire and a periodic sweep bounds memory under attack.
   ============================================================ */

import { usingPostgres } from "../db/store.js";
import { bumpRateLimit as pgBump, resetRateLimit as pgReset } from "../db/repo.js";

interface Bucket { count: number; resetAt: number; }
const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

export interface RateResult { ok: boolean; retryAfterSec: number; remaining: number; }

/** Count a hit against `key`; allow up to `max` per `windowMs`. */
export function rateLimit(key: string, max: number, windowMs: number): RateResult {
  const now = Date.now();
  if (now - lastSweep > 60_000) {
    for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    lastSweep = now;
  }
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
  b.count++;
  const ok = b.count <= max;
  return { ok, retryAfterSec: ok ? 0 : Math.ceil((b.resetAt - now) / 1000), remaining: Math.max(0, max - b.count) };
}

/** Clear a key — e.g. on a successful login so a legit user isn't penalised. */
export function rateLimitReset(key: string): void { buckets.delete(key); }

/** DURABLE, cross-instance rate limit (Postgres) for AUTH-sensitive endpoints. The
 *  in-memory limiter is per-instance, so an attacker could spread brute-force of the
 *  admin password / recovery key across concurrent serverless invocations and never hit
 *  the throttle. Falls back to the in-memory limiter on the memory backend or a transient
 *  DB error — that still bounds per-instance, so it NEVER fails open to unlimited. */
export async function rateLimitDurable(key: string, max: number, windowMs: number): Promise<RateResult> {
  if (!usingPostgres()) return rateLimit(key, max, windowMs);
  try {
    const { count, resetInMs } = await pgBump(key, windowMs);
    const ok = count <= max;
    return { ok, retryAfterSec: ok ? 0 : Math.ceil(resetInMs / 1000), remaining: Math.max(0, max - count) };
  } catch {
    return rateLimit(key, max, windowMs); // DB hiccup → per-instance limit (still bounded)
  }
}
/** Clear a durable counter (e.g. on a successful login). Best-effort. */
export async function rateLimitResetDurable(key: string): Promise<void> {
  if (!usingPostgres()) { rateLimitReset(key); return; }
  try { await pgReset(key); } catch { /* best-effort — a lingering counter self-expires */ }
}

/** Real client IP — relies on app.set("trust proxy", …) so req.ip is trustworthy
 *  (not a raw, spoofable X-Forwarded-For). */
export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

type RlReq = { ip?: string; socket?: { remoteAddress?: string } };
type RlRes = { status: (c: number) => { json: (b: unknown) => void }; setHeader: (k: string, v: string) => void };

/** Express middleware: rate-limit by client IP under a route label. 429 on excess.
 *  In-memory / per-instance — fine for cheap, non-money, non-enumeration routes. */
export function rateLimitMiddleware(label: string, max: number, windowMs: number) {
  return (req: RlReq, res: RlRes, next: () => void): void => {
    const r = rateLimit(`${label}:${clientIp(req)}`, max, windowMs);
    if (!r.ok) {
      res.setHeader("Retry-After", String(r.retryAfterSec));
      res.status(429).json({ error: "rate_limited", message: "Too many requests. Please slow down and try again shortly." });
      return;
    }
    next();
  };
}

/** DURABLE variant — the same contract, but counted in Postgres so the limit holds
 *  ACROSS serverless instances (in-memory is per-instance, so an attacker spreads the
 *  attempts across concurrent invocations and never hits the throttle). Use for anything
 *  that moves money, mints an instruction, or answers a question an attacker would want
 *  to enumerate. Falls back to the per-instance limiter on the memory backend or a DB
 *  hiccup, so it never fails open to unlimited. */
export function rateLimitDurableMiddleware(label: string, max: number, windowMs: number) {
  return async (req: RlReq, res: RlRes, next: () => void): Promise<void> => {
    const r = await rateLimitDurable(`${label}:${clientIp(req)}`, max, windowMs);
    if (!r.ok) {
      res.setHeader("Retry-After", String(r.retryAfterSec));
      res.status(429).json({ error: "rate_limited", message: "Too many requests. Please slow down and try again shortly." });
      return;
    }
    next();
  };
}
