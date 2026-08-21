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

/** Read a SECRET (credential / token / key): trims surrounding whitespace and quotes.
 *  These routinely sneak in when secrets are injected via echo/CI — a trailing newline
 *  corrupted IBEX's OAuth body and produced an invalid `Bearer <key>\n` header for
 *  PawaPay (undici rejects it), and a stray quote broke Peexit's exact-match auth — all
 *  with no boot-time signal. Use this for every provider credential. */
function secret(key: string, fallback = ""): string {
  return (process.env[key] ?? fallback).trim().replace(/^["']+|["']+$/g, "");
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
    clientId: secret("IBEX_CLIENT_ID"),
    clientSecret: secret("IBEX_CLIENT_SECRET"),
    accountId: secret("IBEX_ACCOUNT_ID"),
    // Separate IBEX account per stablecoin (IBEX is account-per-currency, so they
    // can't share the Bitcoin account): USDT = currencyId 29, USDC = currencyId 30,
    // both on Ethereum/ERC-20.
    usdtAccountId: secret("IBEX_USDT_ACCOUNT_ID"),
    usdcAccountId: secret("IBEX_USDC_ACCOUNT_ID"),
    webhookSecret: secret("IBEX_WEBHOOK_SECRET"),
    apiUrl: env("IBEX_API_URL", sandbox ? "https://ibexhub-api.sandbox.poweredbyibex.io" : "https://ibexhub-api.poweredbyibex.io"),
    authUrl: env("IBEX_AUTH_URL", sandbox ? "https://auth.hub.sandbox.poweredbyibex.io/oauth/token" : "https://auth.hub.poweredbyibex.io/oauth/token"),
    audience: secret("IBEX_AUDIENCE", sandbox ? "https://api-sandbox.poweredbyibex.io" : "https://ibexhub.ibexmercado.com"),
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
    apiKey: secret("PAWAPAY_API_KEY") || secret("PAWAPAY_API_TOKEN"),
    webhookSecret: secret("PAWAPAY_WEBHOOK_SECRET"),
  }))(!isProdEnv("PAWAPAY_ENV")),

  /** Peexit (Peex) — the SECOND Mobile Money payout aggregator. Real disbursement
   *  via SECRETKEY-header auth; activates when PEEXIT_API_KEY is set. Distinct
   *  from the Peex intelligence layer above. URL derives from PEEXIT_ENV. */
  peexit: ((sandbox: boolean) => ({
    env: sandbox ? "sandbox" : "production",
    apiUrl: env("PEEXIT_API_URL", sandbox ? "https://sandbox.peexit.com/api/v1" : "https://server.peexit.com/api/v1"),
    // the Peexit SECRETKEY — SAME key for disbursement AND collection. secret() strips
    // stray surrounding quotes/whitespace: a trailing `"` passed /operators + disbursement
    // (lenient) but the Collect service exact-matches → 401 "key does not exist".
    apiKey: secret("PEEXIT_API_KEY"),
    // Peexit's notification callback authenticates with HTTP Basic Auth using
    // credentials WE define and hand to Peexit (NOT an HMAC signature). We
    // validate the inbound Authorization header against these. Sandbox default
    // per Peexit docs is peex/peex_callback; production creds are ours to set.
    callbackUser: secret("PEEXIT_CALLBACK_USER", "peex"),
    callbackPass: secret("PEEXIT_CALLBACK_PASS"),
  }))(!isProdEnv("PEEXIT_ENV")),

  /** Blink (Galoy) — SECOND crypto INBOUND rail alongside IBEX (Lightning +
   *  on-chain BTC). GraphQL API authed with an `X-API-KEY` header. Activates
   *  when BLINK_API_KEY + BLINK_WALLET_ID are set (independent of RAILS_MODE,
   *  like IBEX). URL derives from BLINK_ENV: production = mainnet, else the
   *  staging (signet/testnet) endpoint. See server/src/adapters/blink.ts. */
  blink: ((sandbox: boolean) => {
    // The USD (Stablesats) wallet is OPTIONAL — set it to hedge crypto-price risk by
    // receiving value as synthetic USD instead of volatile BTC (we owe XAF, which is
    // EUR-pegged, so USD tracks the liability far better than BTC over the settlement
    // window). NOT an ERC-20 USDT rail. Get both ids from the Blink dashboard or
    // `query me { defaultAccount { wallets { id walletCurrency } } }`.
    const usdWalletId = secret("BLINK_USD_WALLET_ID");
    // Which wallet receives inbound crypto:
    //   split (default when a USD wallet is set) — Lightning → BTC (settles in seconds,
    //     no Stablesats spread), on-chain → USD (10–60 min window = real price risk → hedge).
    //   hedge — everything → USD (max protection, pays the Stablesats spread on every receive).
    //   btc   — everything → BTC (hold Bitcoin; the only option when no USD wallet is set).
    const rawPolicy = env("BLINK_RECEIVE_POLICY", usdWalletId ? "split" : "btc").trim().toLowerCase();
    const receivePolicy = (["btc", "hedge", "split"].includes(rawPolicy) ? rawPolicy : (usdWalletId ? "split" : "btc")) as "btc" | "hedge" | "split";
    return {
      env: sandbox ? "sandbox" : "production",
      apiUrl: env("BLINK_API_URL", sandbox ? "https://api.staging.galoy.io/graphql" : "https://api.blink.sv/graphql"),
      apiKey: secret("BLINK_API_KEY"),
      // The BTC wallet that receives inbound sats (the base wallet — always required).
      walletId: secret("BLINK_WALLET_ID"),
      // The USD/Stablesats wallet (optional; enables the hedge). Empty → BTC-only.
      usdWalletId,
      // Effective receive routing (falls back to BTC for any USD leg if usdWalletId is empty).
      receivePolicy,
      // Blink signs callbacks via Svix. This is the endpoint's Svix SIGNING SECRET
      // (`whsec_…`, shown by Blink when the callback endpoint is registered) — NOT a
      // value we invent. Unset → callbacks are rejected whenever a real payout could
      // result (fail closed). See verifyWebhook in adapters/blink.ts.
      webhookSecret: secret("BLINK_WEBHOOK_SECRET"),
    };
  })(!isProdEnv("BLINK_ENV")),

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

/** True when Blink (Galoy) credentials are present — activates the second real
 *  crypto inbound rail (Lightning + on-chain BTC), independent of RAILS_MODE,
 *  exactly like IBEX. Needs both an API key and the receiving BTC wallet id. */
export function blinkConfigured(): boolean {
  return !!(config.blink.apiKey && config.blink.walletId);
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
/** Blink is production-mainnet or staging-testnet — there is no "sandbox pays real
 *  sats" nuance (staging is signet/testnet), so a Blink inbound is trusted only in
 *  production. Mirrors ibexInboundTrusted() for the second crypto rail. */
export function blinkLive(): boolean { return blinkConfigured() && config.blink.env === "production"; }
export function blinkInboundTrusted(): boolean { return blinkLive(); }
export function pawapayLive(): boolean { return pawapayConfigured() && config.pawapay.env === "production"; }
export function peexitLive(): boolean { return peexitConfigured() && config.peexit.env === "production"; }
export function aggregatorLive(name: string): boolean {
  return name === "pawapay" ? pawapayLive() : name === "peexit" ? peexitLive() : false;
}
/** Any rail that moves REAL funds is active → simulation must be off. A production
 *  crypto inbound (IBEX or Blink) counts too — a real inbound settling would drive a
 *  real payout. NOTE: the FX rate feed currently sources from IBEX (core/rates.ts);
 *  a production deployment therefore still needs IBEX creds present for live pricing
 *  even when Blink is the crypto rail. IBEX is the BASE rail by design. */
export function liveMoney(): boolean { return ibexLive() || blinkLive() || pawapayLive() || peexitLive(); }

/** IBEX is all-or-nothing: reject a partial credential set at boot. In
 *  production, also require a webhook secret and a reachable https PUBLIC_URL,
 *  otherwise settlements can't be verified or delivered. */
export function assertIbexConfig(): void {
  const parts = [config.ibex.clientId, config.ibex.clientSecret, config.ibex.accountId];
  if (parts.some(Boolean) && !parts.every(Boolean)) {
    throw new Error("Partial IBEX config: set IBEX_CLIENT_ID, IBEX_CLIENT_SECRET and IBEX_ACCOUNT_ID together (or none).");
  }
  // Require the webhook secret + a reachable https callback whenever a real payout can
  // result from an IBEX inbound — i.e. production OR sandbox-with-IBEX_ALLOW_SANDBOX_PAYOUT.
  // Otherwise an unsigned (forged) webhook could settle real money (verifyWebhook fails
  // closed in exactly these cases, so the secret must exist).
  if (ibexConfigured() && ibexInboundTrusted()) {
    const missing: string[] = [];
    if (!config.ibex.webhookSecret) missing.push("IBEX_WEBHOOK_SECRET");
    if (!config.publicUrl.startsWith("https://")) missing.push("PUBLIC_URL (must be https)");
    if (missing.length) throw new Error(`IBEX inbound can authorize a real payout — set: ${missing.join(", ")} (or disable IBEX_ALLOW_SANDBOX_PAYOUT).`);
  }
}

/** Blink is all-or-nothing (key + wallet id). In production a settled Blink inbound
 *  authorizes a real payout, so require its callback secret + an https PUBLIC_URL —
 *  verifyWebhook fails closed otherwise, so the secret must exist. Mirrors IBEX. */
export function assertBlinkConfig(): void {
  const parts = [config.blink.apiKey, config.blink.walletId];
  if (parts.some(Boolean) && !parts.every(Boolean)) {
    throw new Error("Partial Blink config: set BLINK_API_KEY and BLINK_WALLET_ID together (or none).");
  }
  if (blinkConfigured() && blinkInboundTrusted()) {
    const missing: string[] = [];
    if (!config.blink.webhookSecret) missing.push("BLINK_WEBHOOK_SECRET");
    if (!config.publicUrl.startsWith("https://")) missing.push("PUBLIC_URL (must be https)");
    if (missing.length) throw new Error(`Blink inbound can authorize a real payout — set: ${missing.join(", ")}.`);
  }
  // A USD receive policy with no Stablesats wallet silently receives as BTC — warn so
  // the hedge isn't assumed active when it isn't (don't crash; BTC receive is safe).
  if (blinkConfigured() && config.blink.receivePolicy !== "btc" && !config.blink.usdWalletId) {
    console.warn(`⚠️  BLINK_RECEIVE_POLICY=${config.blink.receivePolicy} needs BLINK_USD_WALLET_ID — none set, so all receives go to the BTC wallet (no hedge).`);
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

/** Fail closed in production: the cron endpoint (/api/cron/tick, which drives the
 *  reconcile + FX jobs) must require CRON_SECRET, otherwise it's world-triggerable.
 *  Unset is fine in local dev (so the endpoint is testable), but a real-money /
 *  production deploy that forgot the var must not silently run it open. Mirrors
 *  assertAdminSecurity's prod detection. */
export function assertCronSecurity(): void {
  const inProd = process.env.NODE_ENV === "production" || liveMoney();
  if (inProd && !process.env.CRON_SECRET) {
    throw new Error("Refusing to start in production without CRON_SECRET — the cron endpoint would be world-triggerable. Set CRON_SECRET (the value Vercel Cron sends as `Authorization: Bearer <secret>`).");
  }
}

/** The compliance audit chain is a tamper-evident LEGAL guard: it only detects a
 *  privileged insider (someone who can edit the persisted store but not read the app
 *  secret) if the hash chain is KEYED. Unkeyed it degrades to plain SHA-256 — an
 *  insider can alter an event and recompute every hash, defeating the guard. So in
 *  production (or once real money moves) require a chain key. `ADMIN_SESSION_SECRET`
 *  counts ONLY when explicitly set in the env — the persisted-random fallback isn't
 *  visible to core/compliance.ts, so it can't key the chain. Fail closed. */
export function assertComplianceConfig(): void {
  // Gate on liveMoney() (a production rail is live), NOT NODE_ENV — Vercel sets
  // NODE_ENV=production even for the sandbox/demo backend, and a demo audit chain
  // needn't be keyed. The legal guard matters once REAL transactions occur.
  const chainKey = (process.env.COMPLIANCE_HMAC_KEY ?? "").trim() || (process.env.ADMIN_SESSION_SECRET ?? "").trim();
  if (liveMoney() && !chainKey) {
    throw new Error("Refusing to run a live-money rail without a compliance chain key — the tamper-evident audit log would run UNKEYED (plain SHA-256), which a privileged insider can forge. Set COMPLIANCE_HMAC_KEY (or ADMIN_SESSION_SECRET).");
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
