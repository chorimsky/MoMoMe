/* ============================================================
   In-memory fixed-window rate limiter (no external dependency, fits the
   in-memory architecture). Keyed by an arbitrary string, e.g. "login:<ip>".
   Buckets self-expire and a periodic sweep bounds memory under attack.
   ============================================================ */

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

/** Real client IP — relies on app.set("trust proxy", …) so req.ip is trustworthy
 *  (not a raw, spoofable X-Forwarded-For). */
export function clientIp(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/** Express middleware: rate-limit by client IP under a route label. 429 on excess. */
export function rateLimitMiddleware(label: string, max: number, windowMs: number) {
  return (req: { ip?: string; socket?: { remoteAddress?: string } }, res: { status: (c: number) => { json: (b: unknown) => void }; setHeader: (k: string, v: string) => void }, next: () => void): void => {
    const r = rateLimit(`${label}:${clientIp(req)}`, max, windowMs);
    if (!r.ok) {
      res.setHeader("Retry-After", String(r.retryAfterSec));
      res.status(429).json({ error: "rate_limited", message: "Too many requests. Please slow down and try again shortly." });
      return;
    }
    next();
  };
}
