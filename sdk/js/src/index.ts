/* ============================================================
   @momome/sdk — a thin, typed client for the MoMo›Me API v1 (https://momome.xyz/developers).
   Aligned with GET /v1/openapi.json: every method maps 1:1 to an operationId there.

     import { MoMoMe } from "@momome/sdk";
     const momome = new MoMoMe("mm_test_…");            // sandbox
     const quote = await momome.quotes.create({ source: { asset: "USDT", network: "ETHEREUM" }, destination: { country: "CM", amount: "25000" } });
     const payment = await momome.payments.create({ quote_id: quote.id, reference: "ORDER-1", recipient: { phone: "+237670123456" } }, { idempotencyKey: "ORDER-1" });

   Errors throw MoMoMeError { status, code, message, details, requestId }.
   Idempotency: writes take { idempotencyKey }; when omitted a random one is generated
   per call (safe: a retry YOU make must pass the same key to be deduplicated).
   ============================================================ */
export type Environment = "live" | "test";
export interface ClientOptions { baseUrl?: string; sandboxUrl?: string; fetch?: typeof fetch; timeoutMs?: number; userAgent?: string }
export interface RequestOptions { idempotencyKey?: string; requestId?: string; signal?: AbortSignal }

export class MoMoMeError extends Error {
  constructor(public status: number, public code: string, message: string, public details: Record<string, unknown> = {}, public requestId?: string) { super(message); this.name = "MoMoMeError"; }
}

export interface Money { amount: string; currency: string }
export interface Quote { id: string; object: "quote"; status: "active" | "expired" | "used"; source: { asset: string; network: string; amount: string }; destination: { country: string; currency: string; amount: string }; rate: { pair: string; value: string; spread_bps: number; locked_until: string; estimate_only: boolean }; fees: { platform: Money; total: Money; [k: string]: unknown }; total_cost: unknown; usd_equivalent: string; created_at: string; expires_at: string }
export type PaymentStatus = "CREATED" | "AWAITING_PAYMENT" | "PAYMENT_DETECTED" | "PAYMENT_CONFIRMED" | "CONVERSION_PROCESSING" | "PAYOUT_PROCESSING" | "PAYOUT_SUBMITTED" | "COMPLETED" | "EXPIRED" | "FAILED" | "CANCELLED" | "REFUNDED" | "MANUAL_REVIEW";
export interface PaymentInstructions { method: "lightning_invoice" | "bitcoin_address" | "erc20_address"; asset: string; network: string; amount: string; amount_label: string; code: string; uri: string; expires_at: string; alternative?: { method: string; asset: string; amount: string; code: string; expires_at: string } }
export interface Payment { id: string; object: "payment"; reference: string | null; status: PaymentStatus; quote_id: string; source: { asset: string; network: string; amount: string | null }; destination: { country: string; currency: string; amount: string; quoted_amount?: string }; recipient: { phone: string; operator: string; name: string | null; name_verified: boolean }; fees: { platform: Money; total: Money }; payment_instructions: PaymentInstructions | null; refund: { status: string; asset: string; network: string; amount_sats?: number; transaction_id?: string } | null; failure: { reason: string | null } | null; metadata: Record<string, string>; expires_at: string | null; timeline: Record<string, string | null>; created_at: string; updated_at: string; livemode: boolean }
export interface List<T> { object: "list"; data: T[]; has_more?: boolean; next_cursor?: string }
export interface WebhookEndpoint { id: string; object: "webhook_endpoint"; url: string; events: string[]; enabled: boolean; description: string | null; secret_hint: string; consecutive_failures: number; created_at: string; secret?: string }
export interface Settlement { id: string; object: "settlement"; status: "REQUESTED" | "PROCESSING" | "SUBMITTED" | "COMPLETED" | "FAILED" | "CANCELLED"; currency: string; amount: string; fee: string; net_amount: string; destination: Record<string, unknown>; reference: string | null; provider_reference: string | null; requested_at: string; completed_at: string | null; livemode: boolean }
export interface RecipientValidation { phone: string; country: string; currency: string; valid: boolean; reason?: string; message?: string; operator: string | null; name: string | null; name_status: string; name_match?: "match" | "mismatch" | "not_available"; active?: boolean | null }

const DEFAULT_LIVE = "https://api.momome.xyz/v1";
const DEFAULT_SANDBOX = "https://sandbox.api.momome.xyz/v1";
const randomKey = () => `sdk_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

export class MoMoMe {
  readonly environment: Environment;
  readonly baseUrl: string;
  private readonly f: typeof fetch;
  private readonly timeoutMs: number;
  private readonly ua: string;
  constructor(private readonly credential: string, opts: ClientOptions = {}) {
    if (!/^mm_(live|test)_[0-9a-f]{32}$/.test(credential)) throw new MoMoMeError(0, "credential_invalid", "Pass an API credential (mm_live_… or mm_test_…).");
    this.environment = credential.startsWith("mm_live_") ? "live" : "test";
    this.baseUrl = (opts.baseUrl ?? (this.environment === "live" ? DEFAULT_LIVE : opts.sandboxUrl ?? DEFAULT_SANDBOX)).replace(/\/$/, "");
    this.f = opts.fetch ?? globalThis.fetch; this.timeoutMs = opts.timeoutMs ?? 30_000; this.ua = opts.userAgent ?? "momome-sdk-js/1.0.0";
  }
  /** Low-level call: returns `data`; throws MoMoMeError on the error envelope. */
  async request<T>(method: string, path: string, body?: unknown, o: RequestOptions = {}, idempotent = false): Promise<T> {
    const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    o.signal?.addEventListener("abort", () => ctrl.abort());
    try {
      const res = await this.f(`${this.baseUrl}${path}`, { method, headers: { authorization: `Bearer ${this.credential}`, "content-type": "application/json", "user-agent": this.ua, ...(idempotent ? { "idempotency-key": o.idempotencyKey ?? randomKey() } : {}), ...(o.requestId ? { "x-request-id": o.requestId } : {}) }, body: body === undefined ? undefined : JSON.stringify(body), signal: ctrl.signal });
      const text = await res.text(); let j: { data?: T; error?: { code: string; message: string; details?: Record<string, unknown> }; meta?: { request_id?: string } } = {};
      try { j = text ? JSON.parse(text) : {}; } catch { throw new MoMoMeError(res.status, "bad_response", `Non-JSON response (${res.status}).`); }
      if (!res.ok || j.error) throw new MoMoMeError(res.status, j.error?.code ?? "http_error", j.error?.message ?? `HTTP ${res.status}`, j.error?.details ?? {}, j.meta?.request_id);
      return j.data as T;
    } finally { clearTimeout(timer); }
  }
  private q = (params: Record<string, string | number | undefined>) => { const s = new URLSearchParams(); for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") s.set(k, String(v)); const str = s.toString(); return str ? `?${str}` : ""; };

  readonly quotes = {
    create: (body: { source: { asset: string; network?: string; amount?: string }; destination: { country: string; currency?: string; amount?: string; phone?: string } }, o?: RequestOptions) => this.request<Quote>("POST", "/quotes", body, o, true),
    get: (id: string, o?: RequestOptions) => this.request<Quote>("GET", `/quotes/${id}`, undefined, o),
  };
  readonly payments = {
    create: (body: { quote_id: string; reference?: string; recipient: { phone: string; name?: string }; metadata?: Record<string, string>; confirmation_token?: string }, o?: RequestOptions) => this.request<Payment>("POST", "/payments", body, o, true),
    get: (id: string, o?: RequestOptions) => this.request<Payment>("GET", `/payments/${id}`, undefined, o),
    /** Long-poll until the status changes from `status` (≤30 s per call). */
    wait: (id: string, status: PaymentStatus, seconds = 25, o?: RequestOptions) => this.request<Payment>("GET", `/payments/${id}${this.q({ wait: seconds, status })}`, undefined, o),
    /** Poll until a terminal status (or `until` matches) — resolves with the payment. */
    waitUntilSettled: async (id: string, opts: { timeoutMs?: number; until?: (p: Payment) => boolean } = {}): Promise<Payment> => {
      const t0 = Date.now(); let p = await this.payments.get(id);
      const done = (x: Payment) => (opts.until ? opts.until(x) : ["COMPLETED", "EXPIRED", "FAILED", "CANCELLED", "REFUNDED", "MANUAL_REVIEW"].includes(x.status));
      while (!done(p) && Date.now() - t0 < (opts.timeoutMs ?? 15 * 60_000)) p = await this.payments.wait(id, p.status, 25);
      return p;
    },
    list: (params: { limit?: number; status?: PaymentStatus; reference?: string; created_after?: string; starting_after?: string } = {}, o?: RequestOptions) => this.request<List<Payment>>("GET", `/payments${this.q(params)}`, undefined, o),
    cancel: (id: string, o?: RequestOptions) => this.request<Payment>("POST", `/payments/${id}/cancel`, {}, o, true),
    refund: (id: string, body: { destination: { asset?: "BTC"; network?: "LIGHTNING"; invoice: string } }, o?: RequestOptions) => this.request<Payment>("POST", `/payments/${id}/refund`, body, o, true),
    retry: (id: string, o?: RequestOptions) => this.request<Payment>("POST", `/payments/${id}/retry`, {}, o, true),
  };
  readonly recipients = { validate: (body: { phone: string; country?: string; name?: string }, o?: RequestOptions) => this.request<RecipientValidation>("POST", "/recipients/validate", body, o) };
  readonly webhooks = {
    create: (body: { url: string; events?: string[]; description?: string }, o?: RequestOptions) => this.request<WebhookEndpoint>("POST", "/webhooks", body, o, true),
    list: (o?: RequestOptions) => this.request<List<WebhookEndpoint>>("GET", "/webhooks", undefined, o),
    get: (id: string, o?: RequestOptions) => this.request<WebhookEndpoint & { recent_deliveries: unknown[] }>("GET", `/webhooks/${id}`, undefined, o),
    update: (id: string, body: { url?: string; events?: string[]; enabled?: boolean; description?: string }, o?: RequestOptions) => this.request<WebhookEndpoint>("PATCH", `/webhooks/${id}`, body, o),
    delete: (id: string, o?: RequestOptions) => this.request<{ id: string; deleted: boolean }>("DELETE", `/webhooks/${id}`, undefined, o),
    test: (id: string, o?: RequestOptions) => this.request<{ sent: boolean; event_ids: string[] }>("POST", `/webhooks/${id}/test`, {}, o),
    replay: (id: string, eventId: string, o?: RequestOptions) => this.request<{ replayed: boolean }>("POST", `/webhooks/${id}/replay`, { event_id: eventId }, o),
    deliveries: (id: string, o?: RequestOptions) => this.request<List<unknown>>("GET", `/webhooks/${id}/deliveries`, undefined, o),
  };
  readonly settlements = {
    create: (body: { currency?: "XAF"; amount: string; destination: { type: "mobile_money"; phone: string; name?: string; country?: string } | { type: "bank"; bank: string; account: string; name?: string }; reference?: string }, o?: RequestOptions) => this.request<Settlement>("POST", "/settlements", body, o, true),
    list: (o?: RequestOptions) => this.request<List<Settlement>>("GET", "/settlements", undefined, o),
    get: (id: string, o?: RequestOptions) => this.request<Settlement>("GET", `/settlements/${id}`, undefined, o),
    cancel: (id: string, o?: RequestOptions) => this.request<Settlement>("POST", `/settlements/${id}/cancel`, {}, o, true),
  };
  readonly account = {
    get: (o?: RequestOptions) => this.request<Record<string, unknown>>("GET", "/account", undefined, o),
    balances: (o?: RequestOptions) => this.request<List<{ currency: string; available: string; pending_settlement: string }>>("GET", "/account/balances", undefined, o),
    usage: (params: { from?: string; to?: string } = {}, o?: RequestOptions) => this.request<Record<string, unknown>>("GET", `/usage${this.q(params)}`, undefined, o),
  };
  readonly transactions = {
    list: (params: { limit?: number } = {}, o?: RequestOptions) => this.request<List<unknown>>("GET", `/transactions${this.q(params)}`, undefined, o),
    get: (id: string, o?: RequestOptions) => this.request<Record<string, unknown>>("GET", `/transactions/${id}`, undefined, o),
  };
  readonly sandbox = {
    scenarios: (o?: RequestOptions) => this.request<List<{ phone: string; scenario: string }>>("GET", "/sandbox/scenarios", undefined, o),
    pay: (paymentId: string, o?: RequestOptions) => this.request<Payment & { sandbox: { paid: boolean } }>("POST", `/sandbox/payments/${paymentId}/pay`, {}, o),
  };
  readonly health = () => this.request<Record<string, unknown>>("GET", "/health");
}

/** Verify a webhook delivery. Pass the RAW request body (string/Buffer) exactly as received. */
export async function verifyWebhookSignature(rawBody: string | Uint8Array, signatureHeader: string | undefined, secret: string, toleranceMs = 5 * 60_000): Promise<boolean> {
  if (!signatureHeader) return false;
  const t = /t=(\d+)/.exec(signatureHeader)?.[1]; const v1 = /v1=([0-9a-f]+)/.exec(signatureHeader)?.[1];
  if (!t || !v1 || Math.abs(Date.now() - Number(t)) > toleranceMs) return false;
  const enc = new TextEncoder();
  const bodyBytes = typeof rawBody === "string" ? enc.encode(rawBody) : rawBody;
  const msg = new Uint8Array(t.length + 1 + bodyBytes.length); msg.set(enc.encode(`${t}.`)); msg.set(bodyBytes, t.length + 1);
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, msg));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex.length !== v1.length) return false;
  let diff = 0; for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ v1.charCodeAt(i);
  return diff === 0;
}
export default MoMoMe;
