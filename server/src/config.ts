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

/** True when an *_ENV flag names production — case- and whitespace-insensitive, so
 *  PAWAPAY_ENV="Production" / " production " behave like "production" instead of
 *  silently falling back to sandbox (a real footgun that hid a misconfig). */
function isProdEnv(key: string): boolean {
  return env(key, "sandbox").trim().toLowerCase() === "production";
}

export const config = {
  port: Number(env("PORT", "4000")),
  /** Public base URL the providers can reach for webhook callbacks. */
  publicUrl: env("PUBLIC_URL", "http://localhost:4000"),
  railsMode: (env("RAILS_MODE", "sandbox") as RailsMode),
  /** Whether a real SMS provider is wired up. Until it is (SMS_ENABLED=true),
   *  phone-number OTP verification can't actually reach the user in production, so
   *  the merchant onboarding auto-activates instead of asking for a code. Flip this
   *  to true once an SMS service is integrated to re-enable OTP verification. */
  smsEnabled: env("SMS_ENABLED", "").trim().toLowerCase() === "true",

  /** IBEX Hub (poweredbyibex.io) — crypto inbound for Lightning + on-chain BTC.
   *  OAuth2 client-credentials (M2M). USDT/stablecoin receive is gated per
   *  organization by IBEX (sandbox orgs get 403 until enabled). URLs derive
   *  from IBEX_ENV (sandbox|production) but each is individually overridable. */
  ibex: ((sandbox: boolean) => ({
    env: sandbox ? "sandbox" : "production",
    clientId: env("IBEX_CLIENT_ID"),
    clientSecret: env("IBEX_CLIENT_SECRET"),
    accountId: env("IBEX_ACCOUNT_ID"),
    // Separate IBEX account per stablecoin (IBEX is account-per-currency, so they
    // can't share the Bitcoin account): USDT = currencyId 29, USDC = currencyId 30,
    // both on Ethereum/ERC-20.
    usdtAccountId: env("IBEX_USDT_ACCOUNT_ID"),
    usdcAccountId: env("IBEX_USDC_ACCOUNT_ID"),
    webhookSecret: env("IBEX_WEBHOOK_SECRET"),
    apiUrl: env("IBEX_API_URL", sandbox ? "https://ibexhub-api.sandbox.poweredbyibex.io" : "https://ibexhub-api.poweredbyibex.io"),
    authUrl: env("IBEX_AUTH_URL", sandbox ? "https://auth.hub.sandbox.poweredbyibex.io/oauth/token" : "https://auth.hub.poweredbyibex.io/oauth/token"),
    audience: env("IBEX_AUDIENCE", sandbox ? "https://api-sandbox.poweredbyibex.io" : "https://ibexhub.ibexmercado.com"),
    // Documented IBEX webhook sender IPs (sandbox vs prod) — used to allowlist
    // inbound webhooks alongside the shared secret. Override via IBEX_WEBHOOK_IPS.
    webhookIps: env("IBEX_WEBHOOK_IPS", sandbox ? "35.243.242.121,34.74.236.191" : "34.148.92.171,35.196.168.24")
      .split(",").map((s) => s.trim()).filter(Boolean),
    // IBEX SANDBOX Lightning invoices are payable with real mainnet sats, so a
    // genuinely-settled sandbox inbound is real money. This explicit opt-in lets
    // such an inbound authorize a REAL Mobile Money payout (off by default).
    allowSandboxPayout: env("IBEX_ALLOW_SANDBOX_PAYOUT") === "true",
  }))(!isProdEnv("IBEX_ENV")),

  /** PawaPay — Mobile Money payout aggregator. Activates the REAL payout rail
   *  when PAWAPAY_API_KEY is set (independent of RAILS_MODE), like IBEX. URL
   *  derives from PAWAPAY_ENV (sandbox|production). */
  pawapay: ((sandbox: boolean) => ({
    env: sandbox ? "sandbox" : "production",
    apiUrl: env("PAWAPAY_API_URL", sandbox ? "https://api.sandbox.pawapay.io" : "https://api.pawapay.io"),
    // Accept either name — PawaPay's dashboard/docs call it the "API token", so
    // PAWAPAY_API_TOKEN is the intuitive var; PAWAPAY_API_KEY kept for back-compat.
    apiKey: env("PAWAPAY_API_KEY") || env("PAWAPAY_API_TOKEN"),
    webhookSecret: env("PAWAPAY_WEBHOOK_SECRET"),
  }))(!isProdEnv("PAWAPAY_ENV")),

  /** Peexit (Peex) — the SECOND Mobile Money payout aggregator. Real disbursement
   *  via SECRETKEY-header auth; activates when PEEXIT_API_KEY is set. Distinct
   *  from the Peex intelligence layer above. URL derives from PEEXIT_ENV. */
  peexit: ((sandbox: boolean) => ({
    env: sandbox ? "sandbox" : "production",
    apiUrl: env("PEEXIT_API_URL", sandbox ? "https://sandbox.peexit.com/api/v1" : "https://server.peexit.com/api/v1"),
    // the Peexit SECRETKEY — SAME key for disbursement AND collection. STRIP stray
    // surrounding quotes/whitespace: a trailing `"` in the env var passed /operators
    // + disbursement (lenient) but the Collect service exact-matches → 401 "key does
    // not exist". Sanitizing fixes collection without breaking the others.
    apiKey: (env("PEEXIT_API_KEY") || "").trim().replace(/^["']+|["']+$/g, ""),
    // Peexit's notification callback authenticates with HTTP Basic Auth using
    // credentials WE define and hand to Peexit (NOT an HMAC signature). We
    // validate the inbound Authorization header against these. Sandbox default
    // per Peexit docs is peex/peex_callback; production creds are ours to set.
    callbackUser: env("PEEXIT_CALLBACK_USER", "peex"),
    callbackPass: env("PEEXIT_CALLBACK_PASS"),
  }))(!isProdEnv("PEEXIT_ENV")),

  /** Admin console auth. Per-user accounts gate every /admin/* API and the
   *  console UI. ADMIN_SESSION_SECRET signs session tokens (else a persisted
   *  random secret is used — never the password). */
  admin: {
    password: env("ADMIN_PASSWORD", "momome-admin"), // dev default — SET ADMIN_PASSWORD in production
    sessionSecret: env("ADMIN_SESSION_SECRET"),
    // Master password-reset key (/admin/forgot). Defaults to ADMIN_PASSWORD for
    // back-compat; set a distinct long ADMIN_RECOVERY_KEY in production.
    recoveryKey: env("ADMIN_RECOVERY_KEY") || env("ADMIN_PASSWORD", "momome-admin"),
    // Default when unset OR set to the publicly-known dev value — either way it's
    // not a secret, so production must refuse it.
    passwordIsDefault: !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD === "momome-admin",
  },

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
/** May a SETTLED IBEX inbound authorize a real payout? Production always; sandbox
 *  only with the explicit IBEX_ALLOW_SANDBOX_PAYOUT opt-in (sandbox LN invoices
 *  take real mainnet sats → genuinely real money). Scope this per-payment to the
 *  IBEX rail — a simulated inbound (provider "sandbox") must never qualify. */
export function ibexInboundTrusted(): boolean { return ibexLive() || (ibexConfigured() && config.ibex.allowSandboxPayout); }
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

/** Fail closed in production: never run with the default admin password (it is
 *  also the master recovery key and would be publicly known). Warn — but don't
 *  block — when the session secret isn't pinned (a persisted random one is used).
 *  "Production" = NODE_ENV=production or any real-money rail live. */
export function assertAdminSecurity(): void {
  const inProd = process.env.NODE_ENV === "production" || liveMoney();
  if (inProd && config.admin.passwordIsDefault) {
    throw new Error("Refusing to start in production with the default ADMIN_PASSWORD. Set a strong ADMIN_PASSWORD (and ideally ADMIN_RECOVERY_KEY + ADMIN_SESSION_SECRET).");
  }
  if (inProd && !config.admin.sessionSecret) {
    console.warn("⚠️  ADMIN_SESSION_SECRET is not set — using a persisted random signing secret. Set ADMIN_SESSION_SECRET to pin it across deploys.");
  }
  if (inProd && !process.env.ADMIN_RECOVERY_KEY) {
    console.warn("⚠️  ADMIN_RECOVERY_KEY is not set — /admin/forgot falls back to ADMIN_PASSWORD. Set a distinct ADMIN_RECOVERY_KEY.");
  }
}

/** Fail fast if live (Mobile Money payout) mode is on but a payout provider
 *  isn't configured. IBEX is validated separately (assertIbexConfig). */
export function assertLiveConfig(): void {
  // Gate on liveMoney() — NOT just isLive() (RAILS_MODE) — so a deploy that turns a
  // rail production (e.g. PEEXIT_ENV=production) while RAILS_MODE=sandbox still gets
  // its callback secrets enforced. Real money can move the moment any rail is live.
  if (!liveMoney() && !isLive()) return;
  const missing = new Set<string>();
  // Any LIVE payout rail must have its callback secret set (else its async
  // confirmations can't be verified and settlement silently degrades).
  if (peexitLive() && !config.peexit.callbackPass) missing.add("PEEXIT_CALLBACK_PASS");
  if (pawapayLive() && !config.pawapay.webhookSecret) missing.add("PAWAPAY_WEBHOOK_SECRET");
  if (config.peex.mode === "live" && !config.peex.webhookSecret) missing.add("PEEX_WEBHOOK_SECRET");
  // RAILS_MODE=live must have the primary payout rail (Peexit) fully configured —
  // fail fast rather than boot a live deploy that can't pay out. PawaPay is optional.
  if (isLive()) {
    if (!config.peexit.apiKey) missing.add("PEEXIT_API_KEY");
    if (!config.peexit.callbackPass) missing.add("PEEXIT_CALLBACK_PASS");
  }
  if (missing.size) {
    throw new Error(`Live money is active but missing: ${[...missing].join(", ")}. Set them or run fully in sandbox.`);
  }
}
