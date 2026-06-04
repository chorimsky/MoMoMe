/* ============================================================
   Runtime config. Rails default to "sandbox" so the app runs with
   zero credentials. Set RAILS_MODE=live + the provider envs to switch
   on real IBEX — the single inbound provider for Lightning, on-chain
   BTC, and USDT.
   ============================================================ */

export type RailsMode = "sandbox" | "live";

function env(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: Number(env("PORT", "4000")),
  /** Public base URL the providers can reach for webhook callbacks. */
  publicUrl: env("PUBLIC_URL", "http://localhost:4000"),
  railsMode: (env("RAILS_MODE", "sandbox") as RailsMode),

  /** IBEX Hub (poweredbyibex.io) — crypto inbound for Lightning + on-chain BTC.
   *  OAuth2 client-credentials (M2M). USDT/stablecoin receive is gated per
   *  organization by IBEX (sandbox orgs get 403 until enabled). URLs derive
   *  from IBEX_ENV (sandbox|production) but each is individually overridable. */
  ibex: ((sandbox: boolean) => ({
    env: sandbox ? "sandbox" : "production",
    clientId: env("IBEX_CLIENT_ID"),
    clientSecret: env("IBEX_CLIENT_SECRET"),
    accountId: env("IBEX_ACCOUNT_ID"),
    webhookSecret: env("IBEX_WEBHOOK_SECRET"),
    apiUrl: env("IBEX_API_URL", sandbox ? "https://ibexhub-api.sandbox.poweredbyibex.io" : "https://ibexhub-api.poweredbyibex.io"),
    authUrl: env("IBEX_AUTH_URL", sandbox ? "https://auth.hub.sandbox.poweredbyibex.io/oauth/token" : "https://auth.hub.poweredbyibex.io/oauth/token"),
    audience: env("IBEX_AUDIENCE", sandbox ? "https://api-sandbox.poweredbyibex.io" : "https://ibexhub.ibexmercado.com"),
    // Documented IBEX webhook sender IPs (sandbox vs prod) — used to allowlist
    // inbound webhooks alongside the shared secret. Override via IBEX_WEBHOOK_IPS.
    webhookIps: env("IBEX_WEBHOOK_IPS", sandbox ? "35.243.242.121,34.74.236.191" : "34.148.92.171,35.196.168.24")
      .split(",").map((s) => s.trim()).filter(Boolean),
  }))(env("IBEX_ENV", "sandbox") !== "production"),

  /** PawaPay — Mobile Money payout aggregator. Activates the REAL payout rail
   *  when PAWAPAY_API_KEY is set (independent of RAILS_MODE), like IBEX. URL
   *  derives from PAWAPAY_ENV (sandbox|production). */
  pawapay: ((sandbox: boolean) => ({
    env: sandbox ? "sandbox" : "production",
    apiUrl: env("PAWAPAY_API_URL", sandbox ? "https://api.sandbox.pawapay.io" : "https://api.pawapay.io"),
    apiKey: env("PAWAPAY_API_KEY"),
    webhookSecret: env("PAWAPAY_WEBHOOK_SECRET"),
  }))(env("PAWAPAY_ENV", "sandbox") !== "production"),

  /** Peexit (Peex) — the SECOND Mobile Money payout aggregator. Real disbursement
   *  via SECRETKEY-header auth; activates when PEEXIT_API_KEY is set. Distinct
   *  from the Peex intelligence layer above. URL derives from PEEXIT_ENV. */
  peexit: ((sandbox: boolean) => ({
    env: sandbox ? "sandbox" : "production",
    apiUrl: env("PEEXIT_API_URL", sandbox ? "https://sandbox.peexit.com/api/v1" : "https://peexit.com/api/v1"),
    apiKey: env("PEEXIT_API_KEY"), // the Peexit SECRETKEY
    webhookSecret: env("PEEXIT_WEBHOOK_SECRET"),
  }))(env("PEEXIT_ENV", "sandbox") !== "production"),

  /** Peex — OPTIONAL intelligence / verification / metadata layer.
   *  "off" disables it entirely (MoMo›Me works identically); "sandbox"
   *  simulates it; "live" calls the real API. NEVER in the payment path. */
  peex: {
    mode: env("PEEX_MODE", "sandbox") as "off" | "sandbox" | "live",
    baseUrl: env("PEEX_BASE_URL", "https://api.peex.example"),
    apiKey: env("PEEX_API_KEY"),
    // No public default — an unset secret rejects all webhooks (see service.handleWebhook).
    webhookSecret: env("PEEX_WEBHOOK_SECRET"),
  },
};

export function isLive(): boolean {
  return config.railsMode === "live";
}

/** True when IBEX Hub credentials are present — activates the real crypto
 *  inbound rail (Lightning + on-chain BTC) independently of RAILS_MODE, so
 *  you can run real IBEX inbound with simulated Mobile Money payout. */
export function ibexConfigured(): boolean {
  return !!(config.ibex.clientId && config.ibex.clientSecret && config.ibex.accountId);
}

/** Real Mobile Money payout rails activate per-aggregator when their key is
 *  set — independent of RAILS_MODE — so one can go live before the other. */
export function pawapayConfigured(): boolean { return !!config.pawapay.apiKey; }
export function peexitConfigured(): boolean { return !!config.peexit.apiKey; }

/* ---- "live money" gates — REAL value moves only when a rail is production ----
   Sandbox rails simulate; only production envs move real funds. These gates let
   us forbid real payouts driven by test crypto, and disable simulation whenever
   real money can move. */
export function ibexLive(): boolean { return ibexConfigured() && config.ibex.env === "production"; }
export function pawapayLive(): boolean { return pawapayConfigured() && config.pawapay.env === "production"; }
export function peexitLive(): boolean { return peexitConfigured() && config.peexit.env === "production"; }
export function aggregatorLive(name: string): boolean {
  return name === "pawapay" ? pawapayLive() : name === "peexit" ? peexitLive() : false;
}
/** Any rail that moves REAL funds is active → simulation must be off. */
export function liveMoney(): boolean { return ibexLive() || pawapayLive() || peexitLive(); }

/** IBEX is all-or-nothing: reject a partial credential set at boot. In
 *  production, also require a webhook secret and a reachable https PUBLIC_URL,
 *  otherwise settlements can't be verified or delivered. */
export function assertIbexConfig(): void {
  const parts = [config.ibex.clientId, config.ibex.clientSecret, config.ibex.accountId];
  if (parts.some(Boolean) && !parts.every(Boolean)) {
    throw new Error("Partial IBEX config: set IBEX_CLIENT_ID, IBEX_CLIENT_SECRET and IBEX_ACCOUNT_ID together (or none).");
  }
  if (ibexConfigured() && config.ibex.env === "production") {
    const missing: string[] = [];
    if (!config.ibex.webhookSecret) missing.push("IBEX_WEBHOOK_SECRET");
    if (!config.publicUrl.startsWith("https://")) missing.push("PUBLIC_URL (must be https)");
    if (missing.length) throw new Error(`IBEX production requires: ${missing.join(", ")}.`);
  }
}

/** Fail fast if live (Mobile Money payout) mode is on but a payout provider
 *  isn't configured. IBEX is validated separately (assertIbexConfig). */
export function assertLiveConfig(): void {
  if (!isLive()) return;
  const missing: string[] = [];
  if (!config.pawapay.apiKey) missing.push("PAWAPAY_API_KEY");
  if (!config.pawapay.webhookSecret) missing.push("PAWAPAY_WEBHOOK_SECRET");
  if (!config.peexit.apiKey) missing.push("PEEXIT_API_KEY");
  if (!config.peexit.webhookSecret) missing.push("PEEXIT_WEBHOOK_SECRET");
  if (config.peex.mode === "live" && !config.peex.webhookSecret) missing.push("PEEX_WEBHOOK_SECRET");
  if (missing.length) {
    throw new Error(`RAILS_MODE=live but missing: ${missing.join(", ")}. Set them or use RAILS_MODE=sandbox.`);
  }
}
