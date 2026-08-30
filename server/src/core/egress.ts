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
import { register, touch } from "./persist.js";

export interface EgressStatus {
  /** Current outbound IP as observed from the public internet (null = undetermined). */
  ip: string | null;
  /** The IP an operator registered with the IP-allowlisting rail (EGRESS_ALLOWLISTED_IP). */
  expected: string | null;
  /** Do they agree? null when either side is unknown — "unknown" is NOT "matching". */
  matches: boolean | null;
  /** True when rail traffic leaves via a proxy; then the PROXY's IP is what to allowlist. */
  proxied: boolean;
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
const SOURCES = ["https://api.ipify.org?format=json", "https://ifconfig.co/json"];

async function probe(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { accept: "application/json" } });
      if (!r.ok) return null;
      const d = (await r.json()) as { ip?: string };
      return typeof d.ip === "string" && d.ip ? d.ip : null;
    } finally { clearTimeout(t); }
  } catch { return null; }
}

/** Current outbound IP. Cached, single-flight, best-effort — never throws, never blocks a
 *  money path (callers treat null as "unknown", never as a failure). */
export async function currentEgressIp(): Promise<string | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.ip;
  if (inflight) return inflight;
  const run = (async () => {
    const [a, b] = await Promise.all(SOURCES.map(probe));
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

/** Full allowlist picture for operators (boot log + /admin/rails). */
export async function egressStatus(): Promise<EgressStatus> {
  const ip = await currentEgressIp();
  const expected = config.egress.allowlistedIp || null;
  const proxied = !!config.peexit.proxyUrl;
  const matches = ip && expected ? ip === expected : null;
  const previousIp = changedFrom && changedFrom !== ip ? changedFrom : null;

  let note: string;
  if (proxied) {
    note = "Peexit egresses through PEEXIT_PROXY_URL, so the PROXY's IP is what must be allowlisted — not this address.";
  } else if (!ip) {
    note = "Outbound IP could not be determined (echo services unreachable or disagreeing).";
  } else if (!expected) {
    note = `Outbound IP is ${ip}. Register it with any IP-allowlisting rail (Peexit production), then set EGRESS_ALLOWLISTED_IP=${ip} so drift is detected automatically.`;
  } else if (matches) {
    note = `Outbound IP ${ip} matches the allowlisted address.`;
  } else {
    note = `MISMATCH: traffic leaves from ${ip} but ${expected} is registered as allowlisted. An IP-allowlisting rail will 403 every call regardless of credentials — re-register, or route it through a proxy on the allowlisted IP.`;
  }
  return { ip, expected, matches, proxied, previousIp, checkedAt: cache ? new Date(cache.at).toISOString() : null, note };
}
