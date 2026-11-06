/* ============================================================
   Which forwarded hops to trust, so `req.ip` is the caller and not our own plumbing.

   THE BUG THIS REPLACES. `app.set("trust proxy", 1)` means "exactly one proxy in front",
   so Express takes the RIGHTMOST X-Forwarded-For entry as the client. That is correct for
   one hop. Production has more than one, and the symptom was silent: every IP-keyed control
   simply stopped working, with no error anywhere.

   Measured in production before this change — 155 requests to a 60-per-5-minutes endpoint,
   including 75 with a constant X-Forwarded-For, and not one 429. A pre-existing route
   (/lnurl/pay/:user, 30/min) behaved the same, so it was never one route's bug. Locally,
   with the limiter as the oracle: a constant single-entry chain throttled at request 61; a
   two-entry chain whose LAST entry varied never throttled; a two-entry chain whose FIRST
   entry varied but last was constant throttled at 61. `req.ip` was the rightmost entry,
   which in production is an internal address, not the caller.

   What that switched off: every rateLimitMiddleware route, the identity-enumeration guard,
   and — worst — the `ip` field on roughly a dozen operator audit records in
   routes/platformAdmin.ts, which were being attributed to infrastructure rather than to a
   person. In a system with ANIF/COBAC reporting duties that is an integrity problem.

   WHY A PREDICATE AND NOT `2`. A hop count hardcodes today's topology into a security
   boundary. Too low and `req.ip` is our own proxy (today's bug: controls silently off).
   Too high and Express walks PAST the real client into attacker-supplied bytes, so the
   address becomes CLIENT-SPOOFABLE — a forged IP written into the audit log and used to
   evade limits, which is strictly worse than no IP at all. Either error is silent.

   A predicate has no count to get wrong. Express (via proxy-addr) walks from the socket
   leftwards through X-Forwarded-For and stops at the first address this function does not
   trust. Trusting exactly the internal ranges means it skips however many of our own hops
   there are and stops at the first address that could only have come from outside.

   WHY THIS IS NOT MORE SPOOFABLE THAN WHAT IT REPLACES. A client that sends its own
   `X-Forwarded-For: 1.2.3.4` gets its real address appended by the platform, so the chain
   reads `1.2.3.4, <real client>, <our internal hop>`. Walking from the right: the internal
   hop is trusted and skipped, `<real client>` is public and is where we stop. The forged
   entry sits to the LEFT of the truth and is never reached. Spoofing would need the
   attacker to connect from inside the trusted ranges.

   WHEN IT STILL CANNOT KNOW. If a platform's own hop ever appears as a PUBLIC address,
   this returns that address — exactly what `1` did. No regression, but no fix either; the
   `rail` would be our own IP. The honest check is empirical and cheap: hit a rate-limited
   endpoint past its limit from one machine and see whether a 429 arrives. If it does,
   `req.ip` is the caller.
   ============================================================ */

/** An address belonging to the infrastructure in front of us, rather than to a caller.
 *  Loopback, the three RFC-1918 ranges, link-local, CGNAT (RFC 6598 — the range PaaS
 *  internal networks commonly use), and the IPv6 equivalents. IPv4-mapped IPv6
 *  (`::ffff:10.0.0.1`) is unwrapped first, because that is how a dual-stack socket
 *  presents an IPv4 peer and a missed unwrap would leave an internal hop looking public. */
export function isInternalHop(addr: string): boolean {
  if (!addr) return false;
  let ip = addr.trim().toLowerCase();
  // Strip a port if one came along (`1.2.3.4:5678`), and an IPv6 zone index (`fe80::1%eth0`).
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  if (ip.startsWith("[")) ip = ip.slice(1, ip.indexOf("]") === -1 ? undefined : ip.indexOf("]"));
  if (ip.startsWith("::ffff:")) ip = ip.slice(7);
  // A trailing :port only on IPv4 (an IPv6 literal has many colons and arrives bracketed).
  if ((ip.match(/:/g) ?? []).length === 1 && /^\d{1,3}(\.\d{1,3}){3}:/.test(ip)) ip = ip.slice(0, ip.indexOf(":"));

  if (ip === "::1" || ip === "::") return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // fc00::/7 unique-local
  if (ip.startsWith("fe8") || ip.startsWith("fe9") || ip.startsWith("fea") || ip.startsWith("feb")) return true; // fe80::/10

  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([a, b, Number(m[3]), Number(m[4])].some((n) => n > 255)) return false;
  if (a === 127) return true;                       // loopback
  if (a === 10) return true;                        // 10/8
  if (a === 192 && b === 168) return true;          // 192.168/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16/12
  if (a === 169 && b === 254) return true;          // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64/10 CGNAT
  return false;
}

/** The value for `app.set("trust proxy", …)`. Express calls it per hop, from the socket
 *  leftwards, and stops at the first address it is told not to trust. */
export const trustProxy = (addr: string): boolean => isInternalHop(addr);

/* ============================================================
   A one-shot diagnostic, because this failed silently once already.

   After switching to the predicate, the production rate limit STILL did not engage: 75
   requests to a 60-per-5-minutes endpoint, no 429. Multiple instances were ruled out (12
   probes of /health/deep all reported the same jobs.lastTickAt, so one process). That
   leaves the limitation named above — a platform hop presenting as a PUBLIC address — but
   "leaves" is not "shows", and the whole lesson of this bug is that guessing at the chain
   is how it stayed broken.

   So the server says what it sees, once per process, in a form that is safe to put in a
   log an operator reads: the SHAPE of the chain, never an address. Positions are reported
   as `internal` or `external`, which is exactly what the predicate decides on and exactly
   what is needed to pick the right configuration — and which identifies nobody.

   Read it in Railway → service → logs, looking for `[proxy]`. If it reports
   `resolved=external depth=1` the predicate is working and something else is wrong; if it
   reports `resolved=external` with a depth above 1 and every position external, the
   platform's own hop is public and trusting ranges cannot find the caller — that needs a
   platform-specific header instead.
   ============================================================ */
let logged = false;
let seen = 0;
/** How many requests to wait for a forwarded header before concluding there is none.
 *  A platform health prober hits /health from inside with no X-Forwarded-For, so "the
 *  first request" is the wrong thing to report on — it would describe the prober and warn
 *  about an internal address that is genuinely internal. */
const NO_HEADER_AFTER = 50;

/** Express middleware: log the forwarded chain's shape once — on the first request that
 *  actually carries a forwarded header, since that is the only informative one. If none
 *  arrives in the first NO_HEADER_AFTER requests, say THAT once instead: a platform that
 *  forwards nothing is itself the finding. */
export function logProxyShapeOnce(
  req: { ip?: string; ips?: string[]; socket?: { remoteAddress?: string }; headers?: Record<string, unknown> },
  _res: unknown,
  next: () => void,
): void {
  if (logged) return next();
  try {
    const raw0 = req.headers?.["x-forwarded-for"];
    const has = (Array.isArray(raw0) ? raw0.join(",") : typeof raw0 === "string" ? raw0 : "").trim().length > 0;
    if (!has) {
      if (++seen >= NO_HEADER_AFTER) {
        logged = true;
        console.warn(`[proxy] no x-forwarded-for on any of the first ${NO_HEADER_AFTER} requests — req.ip is the socket peer, so IP-keyed controls identify the proxy, not callers.`);
      }
      return next();
    }
  } catch { return next(); }
  logged = true;
  try {
    const raw = req.headers?.["x-forwarded-for"];
    const chain = (Array.isArray(raw) ? raw.join(",") : typeof raw === "string" ? raw : "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const shape = chain.map((a) => (isInternalHop(a) ? "internal" : "external"));
    const socket = req.socket?.remoteAddress ?? "";
    // `ips` is what Express trusted, left to right; its length tells us how many hops the
    // predicate skipped. Addresses are deliberately not printed.
    console.log(
      `[proxy] x-forwarded-for depth=${chain.length} [${shape.join(" ")}]` +
      ` socket=${socket ? (isInternalHop(socket) ? "internal" : "external") : "none"}` +
      ` resolved=${req.ip ? (isInternalHop(req.ip) ? "internal" : "external") : "none"}` +
      ` trusted=${req.ips?.length ?? 0}` +
      ` resolved_is_rightmost=${chain.length > 0 && req.ip === chain[chain.length - 1]}` +
      ` resolved_is_leftmost=${chain.length > 0 && req.ip === chain[0]}`,
    );
    if (req.ip && isInternalHop(req.ip)) {
      console.warn("[proxy] WARNING: req.ip is an INTERNAL address — IP rate limits and the audit trail's ip field are not identifying callers. See core/trustProxy.ts.");
    }
  } catch { /* a diagnostic must never affect a request */ }
  next();
}
