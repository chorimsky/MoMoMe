/* ============================================================
   Best-effort geo-origin of a request, for operator fraud / AML visibility.

   Order of preference, cheapest first:
     1. A proxy/CDN geo header (Cloudflare `cf-ipcountry`, Vercel `x-vercel-ip-*`,
        or a generic `x-geo-*`) — free, no external call.
     2. A cached IP → location lookup via a free, keyless HTTPS service.
   Private/loopback IPs and failures return null. Never throws; callers run it
   fire-and-forget so payment creation is never blocked or slowed.
   ============================================================ */
import type { Request } from "express";
import type { SenderLocation } from "../../../shared/types.js";

const cache = new Map<string, { loc: SenderLocation | null; at: number }>();
const TTL_MS = 24 * 3600_000;
const CACHE_MAX = 5_000;

/** Real client IP (trust-proxy is set, so req.ip is the client, not the proxy). */
export function clientIp(req: Request): string {
  const ip = req.ip || req.socket?.remoteAddress || "";
  return ip.replace(/^::ffff:/, ""); // unwrap IPv4-mapped IPv6
}

function isPrivate(ip: string): boolean {
  return !ip
    || ip === "::1" || ip === "127.0.0.1"
    || ip.startsWith("127.") || ip.startsWith("10.") || ip.startsWith("192.168.")
    || /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
    || ip.startsWith("fc") || ip.startsWith("fd"); // unique-local IPv6
}

/** ISO country code → English display name (falls back to the code). */
function countryName(cc?: string): string | undefined {
  if (!cc) return undefined;
  try { return new Intl.DisplayNames(["en"], { type: "region" }).of(cc.toUpperCase()) ?? cc; }
  catch { return cc; }
}

/** Location straight from a proxy/CDN geo header, when present. */
function fromHeaders(headers: Request["headers"], ip: string): SenderLocation | null {
  const g = (k: string): string | undefined => {
    const v = headers[k];
    const s = Array.isArray(v) ? v[0] : v;
    if (typeof s !== "string" || !s) return undefined;
    try { return decodeURIComponent(s); } catch { return s; }
  };
  const cc = g("cf-ipcountry") ?? g("x-vercel-ip-country") ?? g("x-geo-country");
  const city = g("x-vercel-ip-city") ?? g("x-geo-city");
  const region = g("x-vercel-ip-country-region") ?? g("x-geo-region");
  if (!cc && !city) return null;
  if (cc === "XX" || cc === "T1") return null; // Cloudflare "unknown" / Tor markers
  return { ip, countryCode: cc, country: countryName(cc), region, city, source: "header", at: new Date().toISOString() };
}

/** Free, keyless HTTPS lookup (ipwho.is). Times out fast; null on any failure. */
async function fromLookup(ip: string): Promise<SenderLocation | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3_500);
    let res: Response;
    try {
      res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}?fields=success,country,country_code,region,city`, { signal: ctrl.signal });
    } finally { clearTimeout(timer); }
    if (!res.ok) return null;
    const d = (await res.json()) as { success?: boolean; country?: string; country_code?: string; region?: string; city?: string };
    if (!d.success) return null;
    return { ip, country: d.country, countryCode: d.country_code, region: d.region, city: d.city, source: "lookup", at: new Date().toISOString() };
  } catch { return null; }
}

/** Resolve a coarse location for a request. Best-effort, cached, never throws. */
export async function resolveLocation(req: Request): Promise<SenderLocation | null> {
  const ip = clientIp(req);
  const header = fromHeaders(req.headers, ip);
  if (header) return header;
  if (isPrivate(ip)) return null;
  const hit = cache.get(ip);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.loc;
  const loc = await fromLookup(ip);
  if (cache.size >= CACHE_MAX) cache.clear(); // simple bound; locations are stable enough to re-fetch
  cache.set(ip, { loc, at: Date.now() });
  return loc;
}
