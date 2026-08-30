/* Shared HTTP helper for the money-moving rail adapters. */
import { ProxyAgent, fetch as undiciFetch } from "undici";

/** EGRESS PROXY — for rails that authenticate on the SOURCE IP, not just credentials.
 *  Peexit production (server.peexit.com) is IP-allowlisted: it returns an nginx HTML 403
 *  to any non-allowlisted source REGARDLESS of the SECRETKEY. That coupled the payout rail
 *  to whichever host we happened to run on — moving the backend from Railway (whose egress
 *  152.55.177.87 Peexit had whitelisted) to Vercel's dynamic egress silently broke every
 *  production Peexit call. Routing those calls through a fixed, allowlistable proxy
 *  decouples the rail from the hosting choice permanently.
 *
 *  Agents are cached per proxy URL: a ProxyAgent owns a connection pool, so constructing
 *  one per request would leak sockets on a hot payout path. */
const agents = new Map<string, ProxyAgent>();
function agentFor(proxyUrl: string): ProxyAgent {
  let a = agents.get(proxyUrl);
  if (!a) { a = new ProxyAgent(proxyUrl); agents.set(proxyUrl, a); }
  return a;
}

/** fetch() with an AbortController timeout. Node's fetch has NO body/response timeout,
 *  so a hung provider socket (IBEX / Peexit / PawaPay) would otherwise block a payout
 *  submit, status poll, or the reconcile backstop indefinitely — stranding a payment in
 *  PAYOUT_REQUESTED. Every real-money provider call must go through this.
 *
 *  `proxyUrl` (optional) sends this request through an HTTP CONNECT proxy so it leaves
 *  from that proxy's IP. Unset → a direct connection, exactly as before. */
export async function fetchT(
  url: string | URL,
  init: RequestInit = {},
  ms = 12_000,
  proxyUrl?: string,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    if (!proxyUrl) return await fetch(url, { ...init, signal: ctrl.signal });
    // Proxied path uses undici's OWN fetch, not the global one. Node bundles its own copy
    // of undici internally, and handing it a dispatcher built from the undici PACKAGE
    // fails at runtime with "invalid onRequestStart method" — the two copies have
    // incompatible internal handler APIs. Pairing undici's fetch with undici's ProxyAgent
    // keeps them on the same copy, and stays correct whatever undici the host Node bundles.
    // The response is structurally a Response (ok/status/json/text); the cast bridges the
    // duplicated type declarations only.
    const opts = { ...init, signal: ctrl.signal, dispatcher: agentFor(proxyUrl) } as unknown as Parameters<typeof undiciFetch>[1];
    return (await undiciFetch(url as string, opts)) as unknown as Response;
  } finally {
    clearTimeout(timer);
  }
}
