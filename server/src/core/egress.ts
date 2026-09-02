/* ============================================================
   Egress IP awareness — for rails that authenticate on the SOURCE IP.

   Peexit production (server.peexit.com) is IP-ALLOWLISTED: it returns an nginx HTML 403
   to any non-allowlisted source REGARDLESS of the SECRETKEY. That makes our outbound IP a
   piece of production configuration as load-bearing as any credential — and, unlike a
   credential, nothing in the system used to know or check it. Moving hosts (Railway →
   Vercel) silently changed it and every production payout began failing, misreported as
   "insufficient_rail_balance".

   This module makes that dependency explicit and self-monitoring:
     • discovers the current outbound IP (cached; best-effort, never throws),
     • compares it to EGRESS_ALLOWLISTED_IP — the address actually registered with the
       rail — and reports drift,
     • remembers the last observed IP across restarts so a CHANGE is detectable, which is
       the exact event that breaks an allowlisted rail.

   It deliberately does NOT try to mutate anyone's allowlist: no provider here exposes an
   API for that. Managing the allowlist means knowing the value, noticing when it changes,
   and telling an operator precisely what to register — which is what this does.
   ============================================================ */
import { config } from "../config.js";
import { fetchT } from "../adapters/http.js";
import { register, touch } from "./persist.js";
import { getSettings } from "./settings.js";

export interface EgressStatus {
  /** Current outbound IP as observed from the public internet (null = undetermined). */
  ip: string | null;
  /** The IP an operator registered with the IP-allowlisting rail (EGRESS_ALLOWLISTED_IP). */
  expected: string | null;
  /** Do they agree? null when either side is unknown — "unknown" is NOT "matching". */
  matches: boolean | null;
  /** True when rail traffic leaves via a proxy; then `ip` IS the proxy's address. */
  proxied: boolean;
  /** When proxied, this platform's OWN outbound IP — informational only, and NOT the
   *  address to register: rail traffic does not leave from here. null when not proxied. */
  directIp: string | null;
  /** Previously-seen IP, when it differs from `ip` — i.e. the egress moved. */
  previousIp: string | null;
  checkedAt: string | null;
  /** Operator-facing sentence: what to do, if anything. */
  note: string;
}

const TTL_MS = Number(process.env.EGRESS_CACHE_MS ?? 10 * 60_000);
let cache: { ip: string | null; at: number } | null = null;
let inflight: Promise<string | null> | null = null;

/** Last IP we ever observed, persisted so a change ACROSS RESTARTS is still detectable —
 *  a redeploy onto new infrastructure is precisely how an allowlisted rail breaks. */
let lastSeenIp: string | null = null;
register("egress", () => lastSeenIp, (d: unknown) => { if (typeof d === "string") lastSeenIp = d; });
/** The address we moved AWAY from, captured at the moment of the change. Kept separately
 *  because currentEgressIp() advances lastSeenIp as soon as it observes the new IP — reading
 *  "the previous one" off lastSeenIp afterwards always returns the CURRENT one, so the drift
 *  would be logged once and then be invisible to /admin/rails. In-memory is enough: the
 *  detection that matters happens in the freshly-started process after a redeploy. */
let changedFrom: string | null = null;

/** Two independent echo services: if one is down or lying, we still get an answer, and a
 *  disagreement means we report nothing rather than a wrong IP an operator would go
 *  register with a payment provider. */
const DEFAULT_SOURCES = ["https://api.ipify.org?format=json", "https://ifconfig.co/json"];
/** Overridable so the proxied path can be asserted against a real local proxy, and so an
 *  operator on a restricted network can point at echo services they can actually reach.
 *  Comma-separated; each must answer `{"ip": "..."}`. */
const SOURCES = (process.env.EGRESS_ECHO_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean).length
  ? (process.env.EGRESS_ECHO_URLS ?? "").split(",").map((u) => u.trim()).filter(Boolean)
  : DEFAULT_SOURCES;

async function probe(url: string, proxyUrl?: string): Promise<string | null> {
  try {
    // Through fetchT so `proxyUrl` routes the probe over the SAME HTTP CONNECT tunnel the
    // rail calls use — that is the only way to observe the address the rail actually sees.
    const r = await fetchT(url, { headers: { accept: "application/json" } }, 4000, proxyUrl);
    if (!r.ok) return null;
    const d = (await r.json()) as { ip?: string };
    return typeof d.ip === "string" && d.ip ? d.ip : null;
  } catch { return null; }
}

/** The address an IP-allowlisting rail sees us as. With a proxy configured that is the
 *  PROXY's address, not this platform's — and it is the one an operator must register.
 *  Probed through the proxy rather than assumed, so the console can confirm the tunnel is
 *  actually carrying traffic instead of merely being configured. Cached separately from the
 *  direct probe; both are best-effort and never throw. */
let proxyCache: { ip: string | null; at: number } | null = null;
export async function railEgressIp(): Promise<string | null> {
  const proxyUrl = config.peexit.proxyUrl;
  if (!proxyUrl) return currentEgressIp();
  if (proxyCache && Date.now() - proxyCache.at < TTL_MS) return proxyCache.ip;
  const [a, b] = await Promise.all(SOURCES.map((u) => probe(u, proxyUrl)));
  const ip = a && b ? (a === b ? a : null) : (a ?? b ?? null);
  proxyCache = { ip, at: Date.now() };
  return ip;
}

/** Current outbound IP. Cached, single-flight, best-effort — never throws, never blocks a
 *  money path (callers treat null as "unknown", never as a failure). */
export async function currentEgressIp(): Promise<string | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ip;
  if (inflight) return inflight;
  const run = (async () => {
    const [a, b] = await Promise.all(SOURCES.map((u) => probe(u)));
    // Agree, or exactly one answered → trust it. Disagree → report unknown rather than
    // hand an operator an IP that would be allowlisted incorrectly.
    const ip = a && b ? (a === b ? a : null) : (a ?? b ?? null);
    if (ip && ip !== lastSeenIp) {
      if (lastSeenIp) {
        changedFrom = lastSeenIp;
        console.warn(`[egress] outbound IP CHANGED ${lastSeenIp} → ${ip}. Any rail that allowlists our IP (Peexit production) will now REJECT us with 403 until this address is registered.`);
      }
      lastSeenIp = ip;
      touch("egress");
    }
    cache = { ip, at: Date.now() };
    return ip;
  })();
  inflight = run;
  void run.catch(() => {}).then(() => { if (inflight === run) inflight = null; });
  return run;
}

/** Drop the cached IP so the next read re-probes. Used by the admin "re-check" action —
 *  after registering an address with a provider an operator must be able to confirm it
 *  NOW, not after the TTL lapses. */
export function invalidateEgressCache(): void { cache = null; proxyCache = null; }

/** Full allowlist picture for operators (boot log + /admin/rails). */
export async function egressStatus(): Promise<EgressStatus> {
  const proxied = !!config.peexit.proxyUrl;
  // `ip` always means "the address a rail sees", so it is the PROXY's when one is set.
  // Reporting the platform's own address there would hand an operator the wrong value to
  // register — the exact mistake this module exists to prevent.
  const ip = await railEgressIp();
  const directIp = proxied ? await currentEgressIp() : null;
  // Admin-set value wins over the env fallback: a provider can allowlist a new IP at any
  // time, and requiring a redeploy to record that is exactly the wrong shape for it.
  const expected = (getSettings().egress?.allowlistedIp || config.egress.allowlistedIp) || null;
  const matches = ip && expected ? ip === expected : null;
  const previousIp = changedFrom && changedFrom !== ip ? changedFrom : null;

  let note: string;
  if (proxied && !ip) {
    note = "Peexit is routed through a proxy, but the proxy did not answer — traffic is NOT reaching the internet through it. Check PEEXIT_PROXY_URL; until it works every Peexit call will fail.";
  } else if (proxied && !expected) {
    note = `Peexit egresses through the proxy as ${ip}. Register THAT address with Peexit (not this platform's ${directIp ?? "own"} IP), then set EGRESS_ALLOWLISTED_IP=${ip}.`;
  } else if (proxied && matches) {
    note = `Peexit egresses through the proxy as ${ip}, which matches the allowlisted address. Correctly configured.`;
  } else if (proxied) {
    note = `MISMATCH: Peexit traffic leaves the proxy as ${ip} but ${expected} is registered. Every call will 403 regardless of credentials — register ${ip}, or point the proxy at the allowlisted address.`;
  } else if (!ip) {
    note = "Outbound IP could not be determined (echo services unreachable or disagreeing).";
  } else if (!expected) {
    note = `Outbound IP is ${ip}. Register it with any IP-allowlisting rail (Peexit production), then set EGRESS_ALLOWLISTED_IP=${ip} so drift is detected automatically.`;
  } else if (matches) {
    note = `Outbound IP ${ip} matches the allowlisted address.`;
  } else {
    note = `MISMATCH: traffic leaves from ${ip} but ${expected} is registered as allowlisted. An IP-allowlisting rail will 403 every call regardless of credentials — re-register, or route it through a proxy on the allowlisted IP.`;
  }
  return { ip, expected, matches, proxied, directIp, previousIp, checkedAt: cache ? new Date(cache.at).toISOString() : null, note };
}
