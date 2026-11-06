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
