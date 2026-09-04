/* ============================================================
   Typed API client — the single seam to the settlement backend.
   Every network call lives here; swap the base URL to repoint.
   ============================================================ */
import type {
  UnattributedInbound,
  NotificationRecord,
  Quote, QuoteRequest, Payment, CreatePaymentRequest, ResolveResult,
  AdminOverview, AdminCustomer, OpsSnapshot, LedgerEntry, AdminSettings,
  Identity, IdentityStats, LiquiditySnapshot, PricingInfo, RevenueReport, ComplianceReport, SuspiciousTransactionReport, PeexPanel,
  DeliverySnapshot, MobileMoneyInfo, ReportsSnapshot, HealthSnapshot, AuditEntry,
  Merchant, MerchantGraph, CountryCode, ProviderId, RoutingSnapshot,
  TreasuryPool, TreasuryWithdrawal, TreasuryRail, MomoOp, MomoRailBalance, MomoFeeInfo,
  VaultRecord, ApiKey, MerchantAccount, MerchantLink, MerchantLinkPublic, MerchantSummary, MerchantDirectoryEntry, AmbassadorSummary,
  Method, AppFeatures,
} from "@shared/types.js";
import type { AdminRole, AdminUserView } from "@shared/roles.js";
import { devicePublicKeys, signRequest } from "../lib/deviceAccount.js";
import { idbGet, idbSet } from "../lib/idb.js";


/** Egress-IP allowlist state. Peexit production authenticates on the SOURCE IP, so this
 *  is money-path configuration: a mismatch 403s every payout regardless of credentials. */
export interface EgressStatus {
  ip: string | null;
  expected: string | null;
  matches: boolean | null;
  proxied: boolean;
  /** When proxied, this platform's OWN outbound IP — informational, NOT the one to
   *  register: rail traffic leaves via the proxy, so `ip` is the address to allowlist. */
  directIp: string | null;
  previousIp: string | null;
  checkedAt: string | null;
  note: string;
}
export interface RailReachability { ok: boolean; status: number; reason: string; at: string }


/** Go-live readiness: every fact derived from the same functions the boot gates and the
 *  money path use, so it cannot drift from reality the way a written checklist does. */
export interface ReadinessCheck { label: string; state: "ok" | "warn" | "blocked"; detail: string; fix?: string }
export interface ReadinessRail { name: string; env: string; configured: boolean; live: boolean; missing: string[]; reachability?: RailReachability | null; routes?: boolean }
export interface Readiness {
  liveMoney: boolean;
  deployEnv: string;
  gates: ReadinessCheck[];
  secrets: ReadinessCheck[];
  egress: EgressStatus;
  rails: { crypto: ReadinessRail[]; payout: ReadinessRail[] };
}

export interface AdminSessionUser { id: string; username: string; role: AdminRole; }

// Same-origin "/api" by default (Vite proxy in dev, Vercel rewrite in prod).
// Set VITE_API_BASE to point at a separately-hosted backend (e.g. a persistent
// Node host) without code changes.
const BASE = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/$/, "");
/** The API base URL (e.g. "https://…/api"), for the developer docs to display. */
export const API_BASE = BASE;

/* ---------- admin session token ---------- */
const TOKEN_KEY = "mm_admin_token";
let adminToken: string | null = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();

export function setAdminToken(token: string | null): void {
  adminToken = token;
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}
export function getAdminToken(): string | null { return adminToken; }


/* ---------- step-up elevation ----------
   A guarded action answers 403 `elevation_required` when the session has not been
   re-authenticated recently. Rather than surfacing that as a raw error the operator has to
   decode, the console registers a prompt: we ask for the password, elevate, and retry the
   original request ONCE. Retrying only once matters — a loop would turn a genuinely
   forbidden action into repeated password prompts. */
let elevationPrompt: (() => Promise<string | null>) | null = null;
export function setElevationPrompt(fn: (() => Promise<string | null>) | null): void { elevationPrompt = fn; }

/* ---------- anonymous sender identity (no login) ----------
   A persistent per-device id the system uses to recognise the returning user and
   scope their history — without any sign-in. Generated once, kept in localStorage,
   and sent on every request so the backend can attribute and filter the sender's
   payments. */
const SENDER_KEY = "mm_sender_id";
function newId(): string {
  return crypto.randomUUID?.() ?? `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
// True when senderId was minted THIS load (no prior localStorage value) — such an
// id was never enrolled server-side, so early unsigned requests are safely accepted
// and enrolment needn't block them. A PERSISTED id might already be enrolled.
let bornFresh = false;
function ensureSenderId(): string {
  try {
    let v = localStorage.getItem(SENDER_KEY);
    if (!v) { v = newId(); localStorage.setItem(SENDER_KEY, v); bornFresh = true; }
    return v;
  } catch {
    // Storage blocked (private mode): use a fresh PER-SESSION id, never a shared
    // global bucket — otherwise private-mode users would share one another's data.
    bornFresh = true;
    return `eph_${newId()}`;
  }
}
let senderId = ensureSenderId();
/* ---------- device proof-of-possession (signed requests) ----------
   The device enrols a keypair for its id (trust-on-first-use) and signs every
   request thereafter, so a stolen id can't act without the private key. Enrolment
   is best-effort and non-blocking: until it succeeds the server still accepts the
   id unsigned (legacy path), so the app never breaks. See lib/deviceAccount.ts. */
const ENROLLED_IDB = "mm_dev_enrolled";
let signingActive = false;

async function enrollDevice(id: string, authPub: JsonWebKey, wrapPub: JsonWebKey): Promise<"ok" | "conflict" | "error"> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8_000);
    try {
      const res = await fetch(`${BASE}/me/devices`, {
        method: "POST", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "X-MM-Sender": id },
        body: JSON.stringify({ authPub, wrapPub }),
      });
      if (res.ok) return "ok";
      if (res.status === 409) return "conflict";
      return "error";
    } finally { clearTimeout(timer); }
  } catch { return "error"; }
}

/** Enrol + activate signing. Runs once at startup. req() awaits this only when it
 *  MUST (a persisted id that could already be enrolled → rotate before requests
 *  fire); a brand-new id enrols in the background so requests never wait on it. */
const deviceReady: Promise<void> = (async () => {
  try {
    const enrolledId = await idbGet<string>(ENROLLED_IDB);
    if (enrolledId === senderId) { signingActive = true; return; } // returning enrolled device — instant

    // Enrol (and, on conflict, rotate) in the background; flip signing on when done.
    const enrollP = (async () => {
      const { authPubJwk, wrapPubJwk } = await devicePublicKeys();
      let result = await enrollDevice(senderId, authPubJwk, wrapPubJwk);
      if (result === "conflict") {
        // Our keys don't own this id (e.g. IndexedDB was cleared but the id persisted).
        // Rotate to a fresh id and enrol there — the old id's data is unrecoverable
        // (the accepted end-to-end tradeoff), but the app keeps working.
        senderId = newId();
        try { localStorage.setItem(SENDER_KEY, senderId); } catch { /* ignore */ }
        result = await enrollDevice(senderId, authPubJwk, wrapPubJwk);
      }
      if (result === "ok") { await idbSet(ENROLLED_IDB, senderId); signingActive = true; }
      // "error" (offline): stay unsigned and retry next load; server still accepts the id.
    })();

    // A brand-new id is NOT enrolled server-side, so early unsigned requests are
    // safely accepted — don't block them on the enrol round-trip (was an up-to-8s
    // stall on first load over 2G). A PERSISTED-but-unenrolled id might already own a
    // server key (IDB eviction) → await enrol/rotation first so a request can't fire
    // with an enrolled id but no signature (which would 401).
    if (!bornFresh) await enrollP;
  } catch { /* never block the app on enrolment */ }
})();

async function req<T>(path: string, init?: RequestInit, retriedAfterElevation = false): Promise<T> {
  await deviceReady; // returning/persisted devices settle here; brand-new ones resolve instantly

  let res: Response;
  // Timeout so a STALLED (half-open) connection — the dominant failure mode on 2G/
  // metered data in the target market — fails cleanly instead of hanging the spinner
  // forever. Abort → same typed network error as a dropped connection.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  // Sign the request (proof-of-possession) once the device is enrolled. The server
  // verifies the signature for enrolled ids; unsigned is accepted only pre-enrolment.
  const method = (init?.method ?? "GET").toUpperCase();
  const bodyStr = typeof init?.body === "string" ? init.body : "";
  let sigHeaders: Record<string, string> = {};
  if (signingActive) {
    try { const { ts, sig } = await signRequest(method, path, bodyStr); sigHeaders = { "X-MM-Ts": ts, "X-MM-Sig": sig }; }
    catch { /* signing failed → send unsigned */ }
  }
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      // Never serve an API call from the browser HTTP cache — these are live,
      // per-request signed calls (payment status polling especially), and a stale
      // cached body would make the send flow miss a DELIVERED/settled state.
      cache: "no-store",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "X-MM-Sender": senderId,
        ...sigHeaders,
        ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    // No response at all — offline / DNS / dropped connection / timeout (common on
    // patchy mobile data). Surface as a typed network error (status 0) so the UI shows
    // a friendly "you're offline, retry" instead of a raw "Failed to fetch" or a hang.
    throw new ApiError("network", 0);
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    // An expired/invalid session on a protected admin call → drop the token and
    // signal the console to fall back to the login gate.
    if (res.status === 401 && path.startsWith("/admin/") && path !== "/admin/login") {
      setAdminToken(null);
      try { window.dispatchEvent(new Event("mm-admin-unauthorized")); } catch { /* non-browser */ }
    }
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    let payload: Record<string, unknown> | undefined;
    try {
      const body = await res.json();
      payload = body as Record<string, unknown>;
      if (body?.message) message = body.message;
      if (typeof body?.error === "string") code = body.error; // stable code for i18n mapping
    } catch {
      /* non-JSON error */
    }
    // Step-up: the action is allowed for this role but the session needs re-authenticating.
    // Ask once, elevate, replay the SAME request. Guarded so a genuinely forbidden action
    // cannot turn into a password-prompt loop, and so /admin/elevate never recurses.
    if (res.status === 403 && code === "elevation_required" && elevationPrompt && !retriedAfterElevation && path !== "/admin/elevate") {
      const password = await elevationPrompt();
      if (password) {
        await api.adminElevate(password); // throws (bad password / rate-limited) → surfaces below
        return req<T>(path, init, true);
      }
    }
    throw new ApiError(message, res.status, code, payload as Record<string, unknown> | undefined);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  // `code` is the server's stable error slug (e.g. "quote_expired") — map it to a
  // localized string; `message` is the English fallback for unknown codes.
  constructor(message: string, public status: number, public code?: string,
              /** The whole error body. Some refusals carry data the caller needs to act on —
               *  a recipient-confirmation warning returns the token that lets the same
               *  payment through once the sender has actually seen it. */
              public data?: Record<string, unknown>) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  getConfig: () => req<{ demoMode: boolean; demoHint: string; feePct: number; brandLogo: string | null; support: { email: string; phone: string }; methods?: Partial<Record<Method, boolean>>; features?: Partial<AppFeatures> }>("/config"),


  // Admin auth. login stores the session token; session checks the current one.
  adminLogin: async (username: string, password: string) => {
    const r = await req<{ token: string; expiresAt: string; user: AdminSessionUser }>("/admin/login", { method: "POST", body: JSON.stringify({ username, password }) });
    setAdminToken(r.token);
    return r;
  },
  adminSession: () => req<{ authenticated: boolean; passwordIsDefault: boolean; user?: AdminSessionUser }>("/admin/session"),
  adminLogout: () => setAdminToken(null),

  // Forgot password — reset via the server master recovery key (no token needed).
  adminForgotPassword: (username: string, recoveryKey: string, newPassword: string) =>
    req<{ ok: boolean }>("/admin/forgot", { method: "POST", body: JSON.stringify({ username, recoveryKey, newPassword }) }),

  // Change the signed-in user's own password.
  adminChangePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>("/admin/password", { method: "POST", body: JSON.stringify({ currentPassword, newPassword }) }),

  // User administration (Super Admin only).
  adminUsers: () => req<{ users: AdminUserView[]; roles: AdminRole[] }>("/admin/users"),
  adminCreateUser: (username: string, password: string, role: AdminRole) =>
    req<{ user: AdminUserView }>("/admin/users", { method: "POST", body: JSON.stringify({ username, password, role }) }),
  adminUpdateUser: (id: string, patch: { role?: AdminRole; password?: string }) =>
    req<{ user?: AdminUserView }>(`/admin/users/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  adminDeleteUser: (id: string) =>
    req<{ ok: boolean }>(`/admin/users/${id}`, { method: "DELETE" }),

  /** Delete this device's account and its data. Backs the public deletion page Google
   *  Play requires; the device id the client already sends is the only proof of ownership. */
  deleteAccount: () =>
    req<{ ok: boolean; deleted: { contacts: number; device: boolean; referrals: boolean }; retained: { payments: number; reason: string } }>(
      "/me/delete", { method: "POST" }),

  resolveRecipient: (phone: string, country: CountryCode = "CM") =>
    req<ResolveResult>(`/recipients/resolve?phone=${encodeURIComponent(phone)}&country=${country}`),

  createQuote: (body: QuoteRequest) =>
    req<Quote>("/quotes", { method: "POST", body: JSON.stringify(body) }),

  /** `riskToken` echoes back a "is this who you meant?" warning the sender has actually
   *  seen — the server refuses a near-miss payment without it. */
  createPayment: (body: CreatePaymentRequest & { merchantLinkCode?: string; merchantCode?: string; riskToken?: string }) =>
    req<Payment>("/payments", { method: "POST", body: JSON.stringify(body) }),

  confirmPayment: (id: string) =>
    req<Payment>(`/payments/${id}/confirm`, { method: "POST" }),

  // Demo-only: simulate the inbound (sandbox). 403s in production.
  simulatePayment: (id: string) =>
    req<Payment>(`/payments/${id}/simulate`, { method: "POST" }),

  getPayment: (id: string) => req<Payment>(`/payments/${id}`),

  // Refund-claim: when a payout couldn't land, the sender supplies a Lightning
  // invoice to receive their crypto back (paid outbound via IBEX).
  refundDestination: (id: string, bolt11: string) =>
    req<Payment>(`/payments/${id}/refund-destination`, { method: "POST", body: JSON.stringify({ bolt11 }) }),

  listPayments: () => req<Payment[]>("/payments"),

  // The sender's distinct recent recipients (anonymous, no login) — "send again".
  recentRecipients: () => req<Array<{ phone: string; country: CountryCode; provider: ProviderId; name: string }>>("/me/recipients"),

  // ---- Merchant ecosystem ----
  merchantMe: () => req<{ merchant: MerchantAccount }>("/merchant/me"),
  createMerchant: (body: { businessName: string; category: string; country: CountryCode; settlementPhone: string; tier: "individual" | "business"; location?: MerchantAccount["location"]; ref?: string }) =>
    req<{ merchant: MerchantAccount }>("/merchant", { method: "POST", body: JSON.stringify(body) }),
  merchantVerifyRequest: () => req<{ sent: boolean; devCode?: string }>("/merchant/verify/request", { method: "POST", body: "{}" }),
  merchantVerify: (code: string) => req<{ merchant: MerchantAccount }>("/merchant/verify", { method: "POST", body: JSON.stringify({ code }) }),
  merchantSummary: () => req<MerchantSummary>("/merchant/me/summary"),
  merchantLinks: () => req<{ links: MerchantLink[] }>("/merchant/links"),
  createMerchantLink: (body: { amountXaf?: number; label?: string; kind?: MerchantLink["kind"]; clientName?: string; dueDate?: string }) =>
    req<{ link: MerchantLink }>("/merchant/links", { method: "POST", body: JSON.stringify(body) }),
  disableMerchantLink: (code: string) => req<{ ok: boolean }>(`/merchant/links/${code}`, { method: "DELETE" }),
  resolvePayLink: (code: string) => req<MerchantLinkPublic>(`/merchant/pay/${encodeURIComponent(code)}`),
  resolveMerchantByCode: (code: string) => req<MerchantLinkPublic>(`/merchant/by-code/${encodeURIComponent(code)}`),
  setMerchantListing: (listed: boolean) => req<{ merchant: MerchantAccount }>("/merchant/listing", { method: "POST", body: JSON.stringify({ listed }) }),
  discover: (opts: { country?: string; category?: string; q?: string } = {}) => {
    const qs = new URLSearchParams(Object.entries(opts).filter(([, v]) => v) as [string, string][]).toString();
    return req<{ merchants: MerchantDirectoryEntry[] }>(`/discover${qs ? `?${qs}` : ""}`);
  },

  // ---- Referrals / ambassadors ----
  getReferral: () => req<AmbassadorSummary>("/me/referral"),
  claimReferral: (ref: string) => req<{ ok: boolean }>("/me/referral/claim", { method: "POST", body: JSON.stringify({ ref }) }),

  // Encrypted contact vault — the server only ever sees ciphertext (see lib/vault.ts).
  vaultList: (since?: string) => req<VaultRecord[]>(`/me/vault${since ? `?since=${encodeURIComponent(since)}` : ""}`),
  vaultPut: (recordId: string, body: { ciphertext: string; iv: string; ver: number }) =>
    req<VaultRecord>(`/me/vault/${encodeURIComponent(recordId)}`, { method: "PUT", body: JSON.stringify(body) }),
  vaultDelete: (recordId: string) =>
    req<VaultRecord>(`/me/vault/${encodeURIComponent(recordId)}`, { method: "DELETE" }),

  // Phase 4 — phone-anchor + E2E recovery. `recovery` is the vault key wrapped by
  // the user's recovery code (server-opaque). Restore returns account records + blob.
  anchorRequest: (phone: string) =>
    req<{ sent: boolean; devCode?: string }>("/me/anchor/request", { method: "POST", body: JSON.stringify({ phone }) }),
  anchorVerify: (phone: string, code: string, recovery: unknown) =>
    req<{ ok: boolean; accountId: string }>("/me/anchor/verify", { method: "POST", body: JSON.stringify({ phone, code, recovery }) }),
  anchorRestore: (phone: string, code: string) =>
    req<{ accountId: string; records: VaultRecord[]; recovery: { salt: string; iterations: number; iv: string; ct: string } | null }>("/me/anchor/restore", { method: "POST", body: JSON.stringify({ phone, code }) }),

  ledger: (paymentId: string) => req<LedgerEntry[]>(`/ledger/${paymentId}`),

  adminOverview: () => req<AdminOverview>("/admin/overview"),
  adminCustomers: () => req<AdminCustomer[]>("/admin/customers"),
  adminPayments: () => req<Payment[]>("/admin/payments"),
  /** Crypto that arrived with no payment to attach it to — real receipts of funds, held
   *  as a liability until an operator attributes or returns them. */
  adminUnattributed: () => req<{ open: number; items: UnattributedInbound[] }>("/admin/unattributed"),
  resolveUnattributed: (id: string, resolution: "attributed" | "refunded" | "ignored", note?: string) =>
    req<{ ok: boolean }>(`/admin/unattributed/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify({ resolution, note }) }),

  // Developer API keys (Super-Admin). Create returns the plaintext `secret` ONCE.
  adminApiKeys: () => req<{ keys: ApiKey[] }>("/admin/apikeys"),
  adminCreateApiKey: (label: string) => req<{ key: ApiKey; secret: string }>("/admin/apikeys", { method: "POST", body: JSON.stringify({ label }) }),
  adminRevokeApiKey: (id: string) => req<{ ok: boolean }>(`/admin/apikeys/${id}`, { method: "DELETE" }),

  adminSettings: () => req<AdminSettings>("/admin/settings"),
  saveSettings: (patch: Partial<AdminSettings>) =>
    req<AdminSettings>("/admin/settings", { method: "PUT", body: JSON.stringify(patch) }),

  adminIdentities: () => req<Identity[]>("/admin/identities"),
  adminIdentityStats: () => req<IdentityStats>("/admin/identities/stats"),
  claimIdentity: (id: string) => req<Identity>(`/admin/identities/${id}/claim`, { method: "POST" }),

  adminLiquidity: () => req<LiquiditySnapshot>("/admin/liquidity"),
  adminTreasury: () => req<{ pools: TreasuryPool[]; destinations: AdminSettings["treasury"]; history: TreasuryWithdrawal[] }>("/admin/treasury"),
  saveTreasuryDestinations: (d: Partial<AdminSettings["treasury"]>) =>
    req<{ destinations: AdminSettings["treasury"] }>("/admin/treasury/destinations", { method: "PUT", body: JSON.stringify(d) }),
  treasuryWithdraw: (rail: TreasuryRail, amount: number) =>
    req<{ ok: boolean; entry?: TreasuryWithdrawal }>("/admin/treasury/withdraw", { method: "POST", body: JSON.stringify({ rail, amount }) }),
  adminPricing: () => req<PricingInfo>("/admin/pricing"),
  adminRevenue: (period = "30d") => req<RevenueReport>(`/admin/revenue?period=${period}`),
  adminCompliance: () => req<ComplianceReport>("/admin/compliance"),
  complianceDispose: (id: string, status: "cleared" | "escalated", note: string) =>
    req<{ ok: boolean }>(`/admin/compliance/cases/${id}/dispose`, { method: "POST", body: JSON.stringify({ status, note }) }),
  complianceFileSTR: (caseId: string, reason: string) =>
    req<{ ok: boolean; str?: SuspiciousTransactionReport }>("/admin/compliance/str", { method: "POST", body: JSON.stringify({ caseId, reason }) }),
  complianceExportCsv: async (type: "cases" | "strs" | "ctr" | "events"): Promise<"ok" | "fail"> => {
    try {
      const res = await fetch(`${BASE}/admin/compliance/export?type=${type}`, { headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {} });
      if (!res.ok) return "fail";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `momome-compliance-${type}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return "ok";
    } catch { return "fail"; }
  },
  adminDelivery: () => req<DeliverySnapshot>("/admin/delivery"),
  adminMobileMoney: () => req<MobileMoneyInfo>("/admin/mobile-money"),
  adminMomo: () => req<{ balances: MomoRailBalance[]; history: MomoOp[]; fees: MomoFeeInfo | null }>("/admin/momo"),
  momoCashout: (phone: string, amount: number, name?: string, country: CountryCode = "CM") =>
    req<{ ok: boolean; op?: MomoOp }>("/admin/momo/cashout", { method: "POST", body: JSON.stringify({ phone, amount, name, country }) }),
  momoCashin: (phone: string, amount: number, name?: string, country: CountryCode = "CM") =>
    req<{ ok: boolean; op?: MomoOp }>("/admin/momo/cashin", { method: "POST", body: JSON.stringify({ phone, amount, name, country }) }),
  momoTransfer: (phone: string, amount: number) =>
    req<{ ok: boolean; op?: MomoOp }>("/admin/momo/transfer", { method: "POST", body: JSON.stringify({ phone, amount }) }),
  adminReports: (period?: string) => req<ReportsSnapshot>(`/admin/reports${period ? `?period=${period}` : ""}`),
  adminHealth: () => req<HealthSnapshot>("/admin/health"),
  adminAudit: () => req<AuditEntry[]>("/admin/audit"),
  adminPruneIdentities: () => req<{ removed: number; kept: number; customerIds: string[] }>("/admin/identities/prune", { method: "POST" }),
  adminRails: () => req<{
    liveMoney: boolean;
    monitor: { pending: number; delivered24h: number; failed24h: number };
    /** Every crypto inbound rail, base rail first. Replaces the old `crypto` field, which
     *  duplicated the base rail's config and hid the others. */
    cryptoRails: Array<{
      name: string; base: boolean; env: string; configured: boolean; live: boolean;
      apiUrl: string; methods: string[]; webhookSecret: string;
      accountId?: string; clientId?: string; walletId?: string; sandboxPayout?: boolean;
    }>;
    payout: Array<{ name: string; env: string; configured: boolean; live: boolean; apiUrl: string; apiKey: string; reachability?: RailReachability | null }>;
    egress?: EgressStatus;
  }>("/admin/rails"),
  /** Record the IP registered with an IP-allowlisting rail (Peexit production). */
  adminSetEgressIp: (allowlistedIp: string) =>
    req<{ egress: EgressStatus }>("/admin/rails/egress", { method: "PUT", body: JSON.stringify({ allowlistedIp }) }),
  /** Re-probe our outbound IP and re-test the rail right now (after registering an IP). */
  adminRecheckEgress: () =>
    req<{ egress: EgressStatus; reachability: RailReachability | null }>("/admin/rails/egress/recheck", { method: "POST" }),
  adminReadiness: () => req<Readiness>("/admin/readiness"),
  /** Step-up: re-enter the password to elevate this session for a few minutes. Swaps the
   *  stored token for the elevated one so subsequent guarded calls carry it. */
  adminElevate: async (password: string) => {
    const r = await req<{ token: string; expiresAt: string; elevatedUntil: number }>("/admin/elevate", { method: "POST", body: JSON.stringify({ password }) });
    setAdminToken(r.token);
    return r;
  },
  /** The dispatch RECORD — what was sent, what failed, and what was skipped because a
   *  channel is switched on with no provider behind it. */
  adminNotificationOutbox: () => req<{
    health: { total: number; sent: number; failed: number; skipped: number;
      channels: Array<{ name: string; configured: boolean; enabled: boolean; reaches: string[] }> };
    items: NotificationRecord[];
  }>("/admin/notifications/outbox"),
  adminNotifications: () => req<Array<{ id: string; t: string; s: string; tone: string; time: string }>>("/admin/notifications"),
  retryPayment: (id: string) => req<{ ok: boolean; payment: Payment }>(`/admin/payments/${id}/retry`, { method: "POST" }),
  refundPayment: (id: string) => req<{ ok: boolean; payment: Payment }>(`/admin/payments/${id}/refund`, { method: "POST" }),

  adminPeex: () => req<PeexPanel>("/admin/peex"),
  peexTest: () => req<{ ok: boolean; detail: string }>("/admin/peex/test", { method: "POST" }),

  adminMerchants: () => req<MerchantGraph>("/admin/merchants"),
  adminRouting: () => req<RoutingSnapshot>("/admin/routing"),
  validateMerchant: (id: string, displayName?: string) =>
    req<Merchant>(`/admin/merchants/${id}/validate`, { method: "POST", body: JSON.stringify({ displayName }) }),
  flagMerchant: (id: string) => req<Merchant>(`/admin/merchants/${id}/flag`, { method: "POST" }),
  mergeMerchants: (keepId: string, dupeId: string) =>
    req<Merchant>("/admin/merchants/merge", { method: "POST", body: JSON.stringify({ keepId, dupeId }) }),

  requestClaim: (phone: string) =>
    req<{ sent: boolean; devCode?: string }>("/identities/claim/request", { method: "POST", body: JSON.stringify({ phone }) }),
  verifyClaim: (phone: string, code: string) =>
    req<{ claimed: boolean; identity: Identity }>("/identities/claim/verify", { method: "POST", body: JSON.stringify({ phone, code }) }),

  opsSnapshot: () => req<OpsSnapshot>("/ops/snapshot"),
};
