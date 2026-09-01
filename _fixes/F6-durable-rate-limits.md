# F6 — durable rate limits on the money routes

`server/src/core/ratelimit.ts`, `server/src/routes/api.ts`

`rateLimitDurable` already exists and is the right design — its own comment explains why:
the in-memory limiter is per-instance, so an attacker spreads the attempts across
concurrent serverless invocations and never hits the throttle. That reasoning was applied
to admin auth and then not carried to the public routes, all of which use the in-memory
`rateLimitMiddleware`.

On Vercel the effective ceiling is `max × concurrent instances`.

## Patch — an async middleware alongside the sync one

`server/src/core/ratelimit.ts`

```diff
 /** Express middleware: rate-limit by client IP under a route label. 429 on excess. */
 export function rateLimitMiddleware(label: string, max: number, windowMs: number) {
   // ... unchanged (fine for cheap, non-money, non-enumeration routes)
 }
+
+/** DURABLE variant — the same contract, but counted in Postgres so the limit holds
+ *  ACROSS serverless instances. Use for anything that moves money, mints an
+ *  instruction, or answers a question an attacker would want to enumerate. Falls back
+ *  to the per-instance limiter on the memory backend or a DB hiccup, so it never fails
+ *  open to unlimited. */
+export function rateLimitDurableMiddleware(label: string, max: number, windowMs: number) {
+  return async (
+    req: { ip?: string; socket?: { remoteAddress?: string } },
+    res: { status: (c: number) => { json: (b: unknown) => void }; setHeader: (k: string, v: string) => void },
+    next: () => void,
+  ): Promise<void> => {
+    const r = await rateLimitDurable(`${label}:${clientIp(req)}`, max, windowMs);
+    if (!r.ok) {
+      res.setHeader("Retry-After", String(r.retryAfterSec));
+      res.status(429).json({ error: "rate_limited", message: "Too many requests. Please slow down and try again shortly." });
+      return;
+    }
+    next();
+  };
+}
```

## Which routes to switch

Swap `rateLimitMiddleware` → `rateLimitDurableMiddleware` on these, and leave the rest:

| Route | Current | Why it matters |
|---|---|---|
| `POST /quotes` | 60/min | Mints priced quotes; free FX-feed amplification |
| `POST /payments` | 30/min | Mints real pay instructions on the rail |
| `GET /recipients/resolve` | 60/min | **Name-enumeration oracle** — maps numbers to real names |
| `POST /payments/:id/refund-destination` | 10/min | Money-out path |
| `POST /identities/claim/request` `/verify` | 6, 20/min | OTP brute force |
| `POST /me/anchor/request` `/verify` `/restore` | 6, 20/min | Account takeover path |
| `POST /me/devices` | 20/min | Enrollment land-grab on guessed ids |
| `GET /merchant/pay/:code` `/by-code/:code` | 120/min | Merchant-code enumeration |

`/recipients/resolve` is the one I'd move first even if you move nothing else. It turns a
phone number into a verified human name, and at 60/min × N instances it is a bulk data
source.

## Verify

- With `STORE_BACKEND=postgres`, hammer `/quotes` from two processes: the combined count
  hits 429, not `2 × 60`.
- With the memory backend, behaviour is unchanged.
- Kill the DB mid-run: requests still throttle (per-instance fallback), never unlimited.
