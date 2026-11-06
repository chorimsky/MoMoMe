/* ============================================================
   The RUM beacon endpoint.

   Deliberately its own router rather than another entry in the api.ts monolith: it is
   unauthenticated, it is not on the money path, and it should be readable in one screen
   alongside the validation it depends on.

   Contract: POST /api/rum, a small JSON object of timings, 204 on accept. It answers 204
   and never a body — a beacon has nobody to read a reply, and `navigator.sendBeacon`
   discards it. A rejected sample is also 204: telling an anonymous caller which of its
   fields we dropped invites probing for no gain, and a browser cannot act on the answer.
   The ONLY non-204 is the rate limit, because that one a client should see.
   ============================================================ */
import { Router, type Request } from "express";
import { recordRum } from "../core/rum.js";
import { rateLimitMiddleware } from "../core/ratelimit.js";

export const rum = Router();

/** Country from the CDN's own geo header, never from the body — a client must not be able
 *  to attribute its timings to a market it is not in. Same header order as core/geoip.ts.
 *  Cloudflare's "unknown"/Tor markers are treated as absent. */
function headerCountry(req: Request): string | undefined {
  const g = (k: string): string | undefined => {
    const v = req.headers[k];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === "string" && s ? s : undefined;
  };
  const cc = g("cf-ipcountry") ?? g("x-vercel-ip-country") ?? g("x-geo-country");
  if (!cc || cc === "XX" || cc === "T1") return undefined;
  return cc;
}

// 60 beacons / 5 min / IP. One page view sends one beacon, so this is generous for a
// person on a flaky connection reloading, and still bounded for a flood. In-memory
// (per-instance) is the right limiter here: the route stores nothing durable, mints no
// instruction and answers no question an attacker wants enumerated.
rum.post("/", rateLimitMiddleware("rum", 60, 5 * 60_000), (req, res) => {
  const body = req.body;
  // A beacon sends one object. An array would let one request fill a bucket.
  if (!body || typeof body !== "object" || Array.isArray(body)) return res.status(204).end();
  try { recordRum(body, headerCountry(req)); } catch { /* a metrics beacon never surfaces an error */ }
  return res.status(204).end();
});
