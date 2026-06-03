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

  /** IBEX — the single inbound settlement provider for Lightning,
   *  on-chain BTC, and USDT (stablecoin), under one auth + webhook contract. */
  ibex: {
    apiUrl: env("IBEX_API_URL", "https://api.ibexmercado.com"),
    refreshToken: env("IBEX_REFRESH_TOKEN"),
    accountId: env("IBEX_ACCOUNT_ID"),
    webhookSecret: env("IBEX_WEBHOOK_SECRET"),
  },

  pawapay: {
    apiUrl: env("PAWAPAY_API_URL", "https://api.pawapay.io"),
    apiKey: env("PAWAPAY_API_KEY"),
    webhookSecret: env("PAWAPAY_WEBHOOK_SECRET"),
  },

  /** Peexit — the SECOND Mobile Money payout aggregator (routing alternative to
   *  PawaPay). Distinct from the Peex intelligence layer above. */
  peexit: {
    apiUrl: env("PEEXIT_API_URL", "https://api.peexit.io"),
    apiKey: env("PEEXIT_API_KEY"),
    webhookSecret: env("PEEXIT_WEBHOOK_SECRET"),
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

/** Fail fast if live mode is on but a provider isn't configured. */
export function assertLiveConfig(): void {
  if (!isLive()) return;
  const missing: string[] = [];
  if (!config.ibex.refreshToken) missing.push("IBEX_REFRESH_TOKEN");
  if (!config.ibex.accountId) missing.push("IBEX_ACCOUNT_ID");
  if (!config.ibex.webhookSecret) missing.push("IBEX_WEBHOOK_SECRET");
  if (!config.pawapay.apiKey) missing.push("PAWAPAY_API_KEY");
  if (!config.pawapay.webhookSecret) missing.push("PAWAPAY_WEBHOOK_SECRET");
  if (!config.peexit.apiKey) missing.push("PEEXIT_API_KEY");
  if (!config.peexit.webhookSecret) missing.push("PEEXIT_WEBHOOK_SECRET");
  if (config.peex.mode === "live" && !config.peex.webhookSecret) missing.push("PEEX_WEBHOOK_SECRET");
  if (missing.length) {
    throw new Error(`RAILS_MODE=live but missing: ${missing.join(", ")}. Set them or use RAILS_MODE=sandbox.`);
  }
}
