/* ============================================================
   Typed API client — the single seam to the settlement backend.
   Every network call lives here; swap the base URL to repoint.
   ============================================================ */
import type { ProviderInfo, RailInfo, PaymentEvent, ReconciliationReport, PaymentAddress, PaymentIntent, PaymentRoute } from "@shared/interop.js";
import type { AdminMerchantAccount } from "@shared/types.js";
export interface Observability {
  generatedAt: string;
  api: Array<{ route: string; count: number; p50: number; p95: number; p99: number; errors5xx: number; errors4xx: number }>;
  payments: { windowHours: number; total: number; delivered: number; failed: number; refunded: number; held: number; open: number; expired: number; successRate: number | null;
    timings: { toInboundMs: { p50: number; p95: number } | null; toDeliveredMs: { p50: number; p95: number } | null; payoutMs: { p50: number; p95: number } | null };
    byRail: Array<{ rail: string; method: string; total: number; delivered: number; failed: number; held: number; successRate: number | null; toDeliveredP50Ms: number | null }>;
    reasons: Array<{ reason: string; count: number }> };
  providers: Array<{ id: string; rail: string; health: string; successRate: number; avgLatencyMs: number }>;
  webhooks: { total: number; byStatus: Record<string, number>; byProvider: Record<string, number>; last24hRejected: number };
}
import type { RegulatoryReport, RegulatoryBody, RegulatoryFiling, ApiKeyUsage, MomoTransfer,
  UnattributedInbound, DeletionRequest,
  NotificationRecord,
  Quote, QuoteRequest, Payment, CreatePaymentRequest, ResolveResult,
  AdminOverview, AdminCustomer, OpsSnapshot, LedgerEntry, AdminSettings,
  Identity, IdentityStats, LiquiditySnapshot, PricingInfo, RevenueReport, ComplianceReport, SuspiciousTransactionReport, PeexPanel,
  DeliverySnapshot, MobileMoneyInfo, ReportsSnapshot, HealthSnapshot, AuditEntry,
  Merchant, MerchantGraph, CountryCode, ProviderId, RoutingSnapshot,
  TreasuryPool, TreasuryWithdrawal, TreasuryRail, MomoOp, MomoRailBalance, MomoFeeInfo,
  VaultRecord, ApiKey, MerchantAccount, MerchantLink, MerchantLinkPublic, MerchantSummary, MerchantDirectoryEntry, AmbassadorSummary,
  Method, AppFeatures, TestReport, TestCaseResult,
} from "@shared/types.js";
import type { AdminRole, AdminUserView } from "@shared/roles.js";
import type { IdentityResolveResponse, IdentityProviderHealth, IdentityCapabilityConfig, IdentityStatus, NameMatch } from "@shared/identity.js";
export interface IdentityResolutionStatus {
  enabled: boolean; mode: "advisory" | "gate";
  cache: { ttlSec: number; ttlVerifiedSec: number; records: number };
  providers: IdentityProviderHealth[];
  capabilities: Record<string, Record<string, IdentityCapabilityConfig>>;
  metrics: Record<string, number | { p50: number | null; p95: number | null; n: number }>;
  last24h: { hours: number; total: number; verified: number; notFound: number; inactive: number; unavailable: number; timeouts: number; unknown: number; cacheHits: number; latency: { p50: number | null; p95: number | null }; byProvider: Record<string, { total: number; verified: number; failed: number }> };
  audit: Array<{ requestId: string; actor: string; purpose: string; identifierHash: string; country: string; operator: string | null; provider: string; status: string; error?: string; latencyMs: number; cache: string; at: string }>;
  priority: string[];
}
export interface UnsettledRow { id: string; ref: string; state: string; ageMin: number; xaf: number; method: string; recipient: string; aggregator: string | null; attempts: number; cause: string; action: "awaiting_rail" | "awaiting_sender" | "refund_in_flight" | "retry" | "review" }
export interface UpiOverview {
  flags: Record<string, boolean>; mode: "SHADOW" | "EXECUTE"; rule: { order: string[]; railPriority: string[] };
  providers: Array<{ kind: string; id: string; health: "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "MAINTENANCE"; reason?: string; capabilities: Record<string, unknown> }>;
  assets: Array<{ code: string; network: string | null; status: string; type: string }>;
  pools: Array<{ id: string; currency: string; available: number | null; reserved: number; committed: number; status: string; note?: string }>;
  shadow: { comparisons: number; agreeing: number; disagreeing: number; recent: Array<{ at: string; intentId: string; engineRoute: string; v1Route: string; agree: boolean; fees: number }> };
  metrics: Record<string, number>;
  intents: Array<{ id: string; state: string; identity: string; amount: { value: number; currency: string }; route: string | null; at: string }>;
  chain: Array<{ id: string; asset: string; network: string; state: string; reconciliation?: string; createdAt: string }>;
}
export interface LnPreview { line: string; longDesc: string; success: string }
export interface IdentityLookupResult { status: IdentityStatus; verified: boolean; displayName?: string; operator: string | null; country: string; accountStatus: string; provider: string; source: string; nameMatch?: NameMatch; error?: string; requestId: string }
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
/* sessionStorage, not localStorage: the admin session ends with the tab. A token that
   survives in localStorage outlives the operator's attention — it stays valid for its
   whole 12 h on a shared or left-open machine and is readable by anything that runs in
   the origin. The old localStorage copy is removed on load so upgraded browsers do not
   keep one around. */
let adminToken: string | null = (() => {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
})();

export function setAdminToken(token: string | null): void {
  adminToken = token;
  try { token ? sessionStorage.setItem(TOKEN_KEY, token) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
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
    if (path.startsWith("/admin/") || path.startsWith("/capital/")) { try { window.dispatchEvent(new CustomEvent("mm-admin-connectivity", { detail: { online: false } })); } catch { /* non-browser */ } }
    throw new ApiError("network", 0);
  } finally {
    clearTimeout(timer);
  }
  // A gateway answering for a server that is not there (502/503/504 from the edge or a
  // dev proxy) is the same thing as no answer, for the operator looking at the console.
  if (path.startsWith("/admin/") || path.startsWith("/capital/")) { try { window.dispatchEvent(new CustomEvent("mm-admin-connectivity", { detail: { online: ![502, 503, 504].includes(res.status) } })); } catch { /* non-browser */ } }
  if (!res.ok) {
    // An expired/invalid session on a protected admin call → drop the token and
    // signal the console to fall back to the login gate.
    // A wrong password typed into the step-up prompt or the change-password form is a 401
    // on THOSE routes — not an expired session. Dropping the token there logged the
    // operator out for a typo.
    // The capital platform (/capital/*) uses the same session, so an expired token there
    // falls back to its own sign-in the same way.
    if (res.status === 401 && (path.startsWith("/admin/") || path.startsWith("/capital/")) && !["/admin/login", "/admin/elevate", "/admin/password", "/admin/forgot"].includes(path)) {
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

/** The raw request function, for feature modules that keep their own typed service layer
 *  (capital/data/apiAdapter.ts). Same auth, signing, timeout and error mapping as `api`. */
export function request<T>(path: string, init?: RequestInit): Promise<T> { return req<T>(path, init); }

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

export interface AnalyticsReport {
  generatedAt: string; days: number; from: string;
  totals: { sessions: number; visitors: number; returning: number; views: number; actions: number; sessionSec: { avg: number; p50: number; p90: number }; bounce: number };
  platforms: Array<{ platform: "web" | "android" | "ios"; sessions: number; visitors: number; sessionSecP50: number; share: number }>;
  countries: Array<{ country: string; sessions: number; visitors: number; share: number }>;
  pages: Array<{ path: string; views: number; sessions: number; avgSec: number; entries: number; exits: number }>;
  funnel: Array<{ step: string; sessions: number; ofPrevious: number | null }>;
  actions: Array<{ name: string; count: number; sessions: number; top?: Array<{ value: string; count: number }> }>;
  byHour: number[]; byDay: Array<{ day: string; sessions: number; visitors: number }>;
  languages: Array<{ lang: string; sessions: number }>; versions: Array<{ platform: "web" | "android" | "ios"; ver: string; sessions: number }>;
  screens: Array<{ scr: string; sessions: number }>; referrers: Array<{ ref: string; sessions: number }>;
  durations: Array<{ bucket: string; sessions: number }>;
}

import type { CorridorChecklist, NetworkOverview, NetworkSettings, NetworkIntent, NetworkRoute, NetworkQuote, NetworkTransaction } from "@shared/network.js";
export interface NetworkMarkets { source: { code: string; name: string; currency: string; dial: string; providers: Array<{ id: string; name: string }> }; destinations: Array<{ code: string; name: string; currency: string; dial: string; providers: Array<{ id: string; name: string }>; minPerTx: number; maxPerTx: number }> }
export type OtpVia = "whatsapp" | "sms";
export type OtpSent = { sent: boolean; via?: OtpVia; channels?: Record<OtpVia, boolean>; devCode?: string };

export type ReceivedItem = { ref: string; xaf: number; state: string; displayStatus: string; createdAt: string; updatedAt: string; method: string };
export type ReceivedList = { phone: string; items: ReceivedItem[]; totals: { count: number; xaf: number } };

// /config is asked for by several independent parts of the page at mount (feature switches,
// the brand mark, the send flow's demo hint). Each request costs a full round trip — about a
// second on a Cameroonian mobile link — so one in-flight promise is shared and the answer is
// reused for a minute. A failed load is not cached: the next caller tries again.
const CONFIG_TTL_MS = 60_000;
let _config: { at: number; p: Promise<AppConfigResponse> } | null = null;
function getConfigShared(): Promise<AppConfigResponse> {
  if (_config && Date.now() - _config.at < CONFIG_TTL_MS) return _config.p;
  const p = req<AppConfigResponse>("/config");
  _config = { at: Date.now(), p };
  p.catch(() => { if (_config?.p === p) _config = null; });
  return p;
}
export type AppConfigResponse = { demoMode: boolean; demoHint: string; feePct: number; minFeeXaf?: number; brandLogo: string | null; support: { email: string; phone: string }; methods?: Partial<Record<Method, boolean>>; features?: Partial<AppFeatures>; network?: { enabled: boolean }; identity?: { enabled: boolean; mode: "advisory" | "gate" } };

export interface UsageSum { requests: number; errors: number; quotes: number; payments: number; completed: number; failed: number; volumeXaf: number; feesXaf: number; webhooks: number; webhookFailures: number; settlements: number; settledXaf: number; avgLatencyMs: number; successRatePct: number }
export interface PlatformOrgRow { id: string; name: string; slug: string; status: string; createdAt: string; country: string; kyb: string; plan: string; liveEnabled: boolean; suspendedReason?: string; members?: number; credentials?: number; live?: UsageSum; test?: UsageSum; balance?: { available: number; pending: number } }
export interface PlatformOrgDetail { organization: PlatformOrgRow; plan: PlatformPlan; members: Array<{ userId: string; role: string; createdAt: string; user: { id: string; email: string; name: string; lastLoginAt?: string } }>; applications: Array<{ id: string; name: string; createdAt: string }>; credentials: Array<{ id: string; env: string; label: string; hint: string; scopes: string[]; status: string; createdAt: string; lastUsedAt?: string }>; usage: { live: { summary: UsageSum }; test: { summary: UsageSum } }; balance: { available: number; pending: number }; payments: { live: number; test: number }; reservations: Array<{ id: string; xaf: number; paymentId?: string; createdAt: string; expiresAt: string }>; invoices: Array<Record<string, any>>; audit: Array<{ id: string; at: string; action: string; actor: { type: string; id: string; label?: string }; details?: Record<string, unknown> }> }
export interface PlatformPlan { id: string; name: string; rateLimitRpm: number; paymentEndpointRpm: number; platformFeePct: number; minFeeXaf: number; tiers: Array<{ fromXaf: number; feePct: number }>; fixedMonthlyXaf: number; negotiatedFeePct?: number; description?: string; custom?: boolean }
export interface PlatformLimitRule { id: string; name: string; enabled: boolean; priority: number; scope: { orgIds?: string[]; envs?: string[]; countries?: string[]; assets?: string[]; currencies?: string[]; operators?: string[]; plans?: string[] }; ceilings: { maxTransactionXaf?: number; minTransactionXaf?: number; dailyXaf?: number; monthlyXaf?: number; velocityPerHour?: number; dailyCount?: number }; createdAt: string; updatedAt: string }

export const api = {
  getConfig: (): Promise<AppConfigResponse> => getConfigShared(),
  /* ---------- the Pan-African network (send abroad) — device-signed like everything else ---------- */
  networkMarkets: () => req<NetworkMarkets>("/network/markets"),
  networkIntent: (body: { sourceProvider: string; sourcePhone: string; destinationMarket: string; destinationProvider: string; destinationPhone: string; destinationName?: string; sourceAmount: number }) =>
    req<{ intent: NetworkIntent; routes: NetworkRoute[]; quotes: NetworkQuote[]; best: { route: NetworkRoute; quote: NetworkQuote } | null; unavailable: string[] }>("/network/intents", { method: "POST", body: JSON.stringify({ sourceMarket: "CM", ...body }) }),
  networkConfirm: (id: string) => req<{ transaction: NetworkTransaction }>(`/network/intents/${encodeURIComponent(id)}/confirm`, { method: "POST", body: "{}" }),
  networkTransaction: (id: string) => req<{ transaction: NetworkTransaction }>(`/network/transactions/${encodeURIComponent(id)}`),


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
  /** For someone who no longer has the device: file a deletion request against a number.
   *  Nothing is deleted on the spot — it is put on record for an operator to verify. */
  requestDeletion: (body: { phone: string; country: CountryCode; note?: string }) =>
    req<{ ok: boolean; ref: string; receivedAt: string; alreadyOpen: boolean }>("/me/delete-request", { method: "POST", body: JSON.stringify(body) }),
  deleteAccount: () =>
    req<{ ok: boolean; deleted: { contacts: number; device: boolean; referrals: boolean }; retained: { payments: number; reason: string } }>(
      "/me/delete", { method: "POST" }),

  /** Identity Resolution v2 (docs/identity) — POST, signed by the device, purpose-bound.
   *  404 while IDENTITY_RESOLUTION_ENABLED is off: callers gate on /config.identity first. */
  identityResolve: (identifier: string, country: CountryCode = "CM", expectedName?: string) =>
    req<IdentityResolveResponse>("/v2/identity/resolve", { method: "POST", body: JSON.stringify({ identifier, country, purpose: "RECIPIENT_VERIFICATION", ...(expectedName ? { expected_name: expectedName } : {}) }) }),
  identityVerify: (identifier: string, expectedName: string, country: CountryCode = "CM") =>
    req<IdentityResolveResponse>("/v2/identity/verify", { method: "POST", body: JSON.stringify({ identifier, country, purpose: "PAYMENT_CREATION", expected_name: expectedName }) }),

  resolveRecipient: (phone: string, country: CountryCode = "CM") =>
    req<ResolveResult>(`/recipients/resolve?phone=${encodeURIComponent(phone)}&country=${country}`),

  /** Indicative cost of each way of paying, for the "choose how to pay" step. Stateless —
   *  mints no quote and locks no rate; the binding number is the quote on the next step. */
  previewMethods: (xaf: number) =>
    req<{ xaf: number; feeXaf: number; totalXaf: number; ratesFresh: boolean; methods: Array<{
      method: Method; asset: string; amount: number; amountLabel: string; usd: number;
      spreadBps: number; etaSeconds: number; senderPaysNetworkFee: boolean;
    }> }>(`/preview?xaf=${encodeURIComponent(String(xaf))}`),

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
  /** Long-poll: resolves the moment the payment leaves `state`, or after ~25 s with the
   *  current record. One request instead of a dozen; "paid" shows the second it lands. */
  waitPayment: (id: string, state: string, timeoutMs = 15_000) => req<Payment>(`/payments/${id}/wait?state=${encodeURIComponent(state)}&timeout=${timeoutMs}`), // under the 20 s request ceiling

  // Refund-claim: when a payout couldn't land, the sender supplies a Lightning
  // invoice to receive their crypto back (paid outbound via IBEX).
  refundDestination: (id: string, bolt11: string) =>
    req<Payment>(`/payments/${id}/refund-destination`, { method: "POST", body: JSON.stringify({ bolt11 }) }),
  /** The sender chooses delivery over a refund — the payout is tried again (another rail). */
  retryDelivery: (id: string) => req<Payment>(`/payments/${id}/retry-delivery`, { method: "POST", body: "{}" }),

  listPayments: () => req<Payment[]>("/payments"),

  // The sender's distinct recent recipients (anonymous, no login) — "send again".
  recentRecipients: () => req<Array<{ phone: string; country: CountryCode; provider: ProviderId; name: string }>>("/me/recipients"),

  // ---- Merchant ecosystem ----
  merchantMe: () => req<{ merchant: MerchantAccount }>("/merchant/me"),
  createMerchant: (body: { businessName: string; category: string; country: CountryCode; settlementPhone: string; tier: "individual" | "business"; location?: MerchantAccount["location"]; ref?: string }) =>
    req<{ merchant: MerchantAccount }>("/merchant", { method: "POST", body: JSON.stringify(body) }),
  /** `via` = the person's channel preference; the reply says where the code actually went
   *  and which channels exist, so the UI can offer "send by SMS instead". */
  merchantVerifyRequest: (opts: { via?: OtpVia; lang?: "en" | "fr" } = {}) =>
    req<OtpSent>("/merchant/verify/request", { method: "POST", body: JSON.stringify(opts) }),
  merchantVerify: (code: string) => req<{ merchant: MerchantAccount }>("/merchant/verify", { method: "POST", body: JSON.stringify({ code }) }),
  merchantSummary: () => req<MerchantSummary>("/merchant/me/summary"),
  merchantLinks: () => req<{ links: MerchantLink[] }>("/merchant/links"),
  createMerchantLink: (body: { amountXaf?: number; label?: string; kind?: MerchantLink["kind"]; clientName?: string; dueDate?: string }) =>
    req<{ link: MerchantLink }>("/merchant/links", { method: "POST", body: JSON.stringify(body) }),
  disableMerchantLink: (code: string) => req<{ ok: boolean }>(`/merchant/links/${code}`, { method: "DELETE" }),
  resolvePayLink: (code: string) => req<MerchantLinkPublic>(`/merchant/pay/${encodeURIComponent(code)}`),
  resolveMerchantByCode: (code: string) => req<MerchantLinkPublic>(`/merchant/by-code/${encodeURIComponent(code)}`),
  setMerchantFeeMode: (mode: "customer" | "merchant") => req<{ merchant: MerchantAccount }>("/merchant/fee-mode", { method: "POST", body: JSON.stringify({ mode }) }),
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
  anchorRequest: (phone: string, opts: { via?: OtpVia; lang?: "en" | "fr" } = {}) =>
    req<OtpSent>("/me/anchor/request", { method: "POST", body: JSON.stringify({ phone, ...opts }) }),
  anchorVerify: (phone: string, code: string, recovery: unknown) =>
    req<{ ok: boolean; accountId: string }>("/me/anchor/verify", { method: "POST", body: JSON.stringify({ phone, code, recovery }) }),
  anchorRestore: (phone: string, code: string) =>
    req<{ accountId: string; records: VaultRecord[]; recovery: { salt: string; iterations: number; iv: string; ct: string } | null }>("/me/anchor/restore", { method: "POST", body: JSON.stringify({ phone, code }) }),

  ledger: (paymentId: string) => req<LedgerEntry[]>(`/ledger/${paymentId}`),

  adminOverview: () => req<AdminOverview>("/admin/overview"),
  adminCustomers: () => req<AdminCustomer[]>("/admin/customers"),
  adminPayments: () => req<Payment[]>("/admin/payments"),
  /** Debited but not delivered — the list that must be empty. */
  adminUnsettled: () => req<{ count: number; xaf: number; rows: UnsettledRow[] }>("/admin/payments/unsettled"),
  /** Crypto that arrived with no payment to attach it to — real receipts of funds, held
   *  as a liability until an operator attributes or returns them. */
  adminDeletionRequests: () => req<{ open: number; items: DeletionRequest[] }>("/admin/deletion-requests"),
  /** Tester programme: file one checklist run (momome.xyz/test) and read them all back. */
  submitTestReport: (body: { testerId: string; name: string; phone: string; country: CountryCode; platform: TestReport["platform"]; device?: string; build?: string; lang: "en" | "fr"; results: TestCaseResult[] }) =>
    req<{ ok: boolean; ref: string; receivedAt: string; passed: number; failed: number; skipped: number }>("/testing/report", { method: "POST", body: JSON.stringify(body) }),
  adminTestReports: () => req<{ total: number; testers: number; items: TestReport[]; cases: Array<{ id: string; title: string; section: string }> }>("/admin/testing/reports"),
  resolveDeletionRequest: (id: string, resolution: "deleted" | "no_account" | "rejected", note?: string) =>
    req<{ ok: boolean; request: DeletionRequest }>(`/admin/deletion-requests/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify({ resolution, note }) }),
  adminUnattributed: () => req<{ open: number; items: UnattributedInbound[] }>("/admin/unattributed"),
  resolveUnattributed: (id: string, resolution: "attributed" | "refunded" | "ignored", note?: string) =>
    req<{ ok: boolean }>(`/admin/unattributed/${encodeURIComponent(id)}/resolve`, { method: "POST", body: JSON.stringify({ resolution, note }) }),

  // Developer API keys (Super-Admin). Create returns the plaintext `secret` ONCE.
  adminApiKeys: () => req<{ keys: ApiKey[] }>("/admin/apikeys"),
  adminCreateApiKey: (label: string) => req<{ key: ApiKey; secret: string }>("/admin/apikeys", { method: "POST", body: JSON.stringify({ label }) }),
  adminRevokeApiKey: (id: string) => req<{ ok: boolean }>(`/admin/apikeys/${id}`, { method: "DELETE" }),

  adminSettings: () => req<AdminSettings>("/admin/settings"),
  /** Recipient message: the rendered notice for a sample payment, and a real test send. */
  adminMessagePreview: () => req<{ en: string; fr: string; variables: string[]; lightning: { variables: string[]; named: LnPreview; masked: LnPreview; unnamed: LnPreview } }>("/admin/settings/messages/preview"),
  adminMessageTest: (to: string, lang?: "en" | "fr", country: CountryCode = "CM") =>
    req<{ body: string; lang: "en" | "fr"; records: Array<{ channel: string; status: string; detail?: string }> }>("/admin/settings/messages/test", { method: "POST", body: JSON.stringify({ to, lang, country }) }),
  saveSettings: (patch: Partial<AdminSettings>) =>
    req<AdminSettings>("/admin/settings", { method: "PUT", body: JSON.stringify(patch) }),

  /** Recipient verification (Identity Resolution v2) — status whether the flag is on or off. */
  adminIdentityResolution: () => req<IdentityResolutionStatus>("/admin/identity-resolution"),
  adminIdentityLookup: (identifier: string, country: CountryCode = "CM", expectedName?: string) =>
    req<IdentityLookupResult>("/admin/identity-resolution/lookup", { method: "POST", body: JSON.stringify({ identifier, country, expectedName }) }),
  adminIdentities: () => req<Identity[]>("/admin/identities"),
  adminIdentityStats: () => req<IdentityStats>("/admin/identities/stats"),
  claimIdentity: (id: string) => req<Identity>(`/admin/identities/${id}/claim`, { method: "POST" }),

  adminLiquidity: () => req<LiquiditySnapshot>("/admin/liquidity"),
  adminMarkSold: (id: string, realizedXaf: number) => req<TreasuryWithdrawal>(`/admin/treasury/withdrawals/${id}/sold`, { method: "POST", body: JSON.stringify({ realizedXaf }) }),
  adminSetApiKeyFee: (id: string, feePct: number | null) => req<{ ok: true }>(`/admin/apikeys/${id}`, { method: "PATCH", body: JSON.stringify({ feePct }) }),
  adminApiKeyUsage: (month?: string) => req<{ month: string; usage: ApiKeyUsage[] }>(`/admin/apikeys/usage${month ? `?month=${month}` : ""}`),
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
  /* Regulatory reporting — per-body periodic reports and the filing register. */
  adminRegulatory: (period?: string) => req<RegulatoryReport>(`/admin/regulatory${period ? `?period=${encodeURIComponent(period)}` : ""}`),
  regulatoryFile: (body: RegulatoryBody, kind: string, period: string, reference?: string, note?: string) =>
    req<{ ok: boolean; filing: RegulatoryFiling }>("/admin/regulatory/file", { method: "POST", body: JSON.stringify({ body, kind, period, reference, note }) }),
  regulatoryExportCsv: async (body: RegulatoryBody, period: string): Promise<"ok" | "fail"> => {
    try {
      const res = await fetch(`${BASE}/admin/regulatory/export?body=${body}&period=${encodeURIComponent(period)}`, { headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {} });
      if (!res.ok) return "fail";
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `momome-${body.toLowerCase()}-${period}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
      return "ok";
    } catch { return "fail"; }
  },
  /* The Pan-African network (shared/network.ts). */
  adminNetwork: () => req<NetworkOverview>("/admin/network"),
  /** Universal Payment Identity layer — flags, routing mode, shadow agreement, registry, pools. */
  adminUpi: () => req<UpiOverview>("/admin/upi"),
  /* ---------- API v1 platform (Admin → Platform) ---------- */
  platformOrgs: () => req<{ organizations: PlatformOrgRow[] }>("/admin/platform/organizations"),
  platformOrg: (id: string) => req<PlatformOrgDetail>(`/admin/platform/organizations/${id}`),
  platformUpdateOrg: (id: string, b: { status?: string; suspendedReason?: string; kyb?: string; plan?: string; liveEnabled?: boolean }) => req<PlatformOrgRow>(`/admin/platform/organizations/${id}`, { method: "PATCH", body: JSON.stringify(b) }),
  platformCredit: (id: string, xaf: number, reference: string) => req<{ ok: boolean; balance: { available: number } }>(`/admin/platform/organizations/${id}/credit`, { method: "POST", body: JSON.stringify({ xaf, reference }) }),
  platformPlans: () => req<{ plans: PlatformPlan[] }>("/admin/platform/plans"),
  platformSavePlan: (p: PlatformPlan) => req<PlatformPlan>(`/admin/platform/plans/${p.id}`, { method: "PUT", body: JSON.stringify(p) }),
  platformLimits: () => req<{ rules: PlatformLimitRule[] }>("/admin/platform/limits"),
  platformSaveLimit: (r: Partial<PlatformLimitRule>) => req<PlatformLimitRule>("/admin/platform/limits", { method: "PUT", body: JSON.stringify(r) }),
  platformDeleteLimit: (id: string) => req<{ ok: boolean }>(`/admin/platform/limits/${id}`, { method: "DELETE" }),
  platformSettlements: () => req<{ settlements: Array<Record<string, any>> }>("/admin/platform/settlements"),
  platformSettlementAction: (id: string, action: "approve" | "submit" | "complete" | "fail", b: Record<string, string> = {}) => req<Record<string, any>>(`/admin/platform/settlements/${id}/${action}`, { method: "POST", body: JSON.stringify(b) }),
  platformTreasury: () => req<{ pool: string; currency: string; total: number | null; reserved: number; settlement_pending: number; available: number | null }>("/admin/platform/treasury"),
  platformUsage: (period?: string) => req<{ period: string; organizations: Array<{ id: string; name: string; plan: string; live: UsageSum; test: UsageSum }> }>(`/admin/platform/usage${period ? `?period=${period}` : ""}`),
  platformInvoice: (orgId: string, period: string, action?: "issue" | "paid") => req<Record<string, any>>(`/admin/platform/organizations/${orgId}/invoices/${period}`, { method: "POST", body: JSON.stringify({ action }) }),
  platformRequests: (all = false) => req<{ requests: Array<{ id: string; orgId: string; organization: string; requester: string; kind: string; status: string; createdAt: string; payload: Record<string, unknown>; decisionNote?: string }>; email_configured: boolean }>(`/admin/platform/requests${all ? "?all=1" : ""}`),
  platformDecide: (id: string, decision: "approve" | "reject", note?: string) => req<Record<string, any>>(`/admin/platform/requests/${id}/${decision}`, { method: "POST", body: JSON.stringify({ note }) }),
  platformEmails: () => req<{ configured: boolean; outbox: Array<{ id: string; at: string; to: string; subject: string; kind: string; status: string; error?: string }> }>("/admin/platform/emails"),
  platformConnectMetrics: (days = 30) => req<Record<string, any>>(`/admin/platform/connect/metrics?days=${days}`),
  platformConnectTreasury: () => req<Record<string, any>>("/admin/platform/connect/treasury"),
  platformConnectSettlements: (all = false) => req<{ settlements: Array<Record<string, any>> }>(`/admin/platform/connect/settlements${all ? "?all=1" : ""}`),
  platformConnectSettlementAction: (id: string, action: "submit" | "settle" | "fail" | "execute" | "retry", b: Record<string, string> = {}) => req<Record<string, any>>(`/admin/platform/connect/settlements/${id}/${action}`, { method: "POST", body: JSON.stringify(b) }),
  platformAudit: () => req<{ events: Array<{ id: string; at: string; orgId?: string; action: string; actor: { type: string; id: string; label?: string }; target?: { type: string; id: string }; details?: Record<string, unknown> }> }>("/admin/platform/audit"),
  platformSetPassword: (userId: string, password: string) => req<{ ok: boolean }>(`/admin/platform/users/${userId}/password`, { method: "POST", body: JSON.stringify({ password }) }),
  networkSettings: (patch: { [K in keyof NetworkSettings]?: Partial<NetworkSettings[K]> }) => req<{ network: NetworkSettings }>("/admin/network/settings", { method: "PUT", body: JSON.stringify(patch) }),
  networkShadowRun: () => req<{ compared: number }>("/admin/network/shadow/run", { method: "POST", body: "{}" }),
  networkTick: () => req<{ examined: number }>("/admin/network/tick", { method: "POST", body: "{}" }),
  networkFxRefresh: () => req<{ ok: boolean; source: string; count: number }>("/admin/network/fx/refresh", { method: "POST", body: "{}" }),
  networkChecklist: (corridor: string) => req<CorridorChecklist>(`/admin/network/corridors/${encodeURIComponent(corridor)}/checklist`),
  networkRecover: (id: string, action: "retry" | "alternate_provider" | "manual" | "refund") => req<{ transaction: unknown }>(`/admin/network/tx/${id}/recover`, { method: "POST", body: JSON.stringify({ action }) }),
  adminDelivery: () => req<DeliverySnapshot>("/admin/delivery"),
  adminMobileMoney: () => req<MobileMoneyInfo>("/admin/mobile-money"),
  momoQuote: (xaf: number) => req<{ xaf: number; feeXaf: number; collectXaf: number; feePct: number }>(`/momo/transfers/quote?xaf=${xaf}`),
  momoResolve: (to: string, country?: string) => req<{ route: "direct" | "lightning"; to: MomoTransfer["to"] }>("/momo/transfers/resolve", { method: "POST", body: JSON.stringify({ to, country }) }),
  momoCreate: (b: { from: string; to: string; xaf: number; country?: string; fromName?: string; toName?: string }) => req<MomoTransfer>("/momo/transfers", { method: "POST", body: JSON.stringify(b) }),
  momoGet: (id: string) => req<MomoTransfer>(`/momo/transfers/${id}`),
  momoCancel: (id: string) => req<MomoTransfer>(`/momo/transfers/${id}/cancel`, { method: "POST" }),
  adminMomoTransfers: () => req<{ enabled: boolean; transfers: MomoTransfer[] }>("/admin/momo/transfers"),
  adminMomoRefund: (id: string) => req<MomoTransfer>(`/admin/momo/transfers/${id}/refund`, { method: "POST" }),
  adminMomoRelease: (id: string) => req<MomoTransfer>(`/admin/momo/transfers/${id}/release`, { method: "POST" }),
  adminMomo: () => req<{ balances: MomoRailBalance[]; history: MomoOp[]; fees: MomoFeeInfo | null }>("/admin/momo"),
  momoCashout: (phone: string, amount: number, name?: string, country: CountryCode = "CM") =>
    req<{ ok: boolean; op?: MomoOp }>("/admin/momo/cashout", { method: "POST", body: JSON.stringify({ phone, amount, name, country }) }),
  momoCashin: (phone: string, amount: number, name?: string, country: CountryCode = "CM") =>
    req<{ ok: boolean; op?: MomoOp }>("/admin/momo/cashin", { method: "POST", body: JSON.stringify({ phone, amount, name, country }) }),
  momoTransfer: (phone: string, amount: number) =>
    req<{ ok: boolean; op?: MomoOp }>("/admin/momo/transfer", { method: "POST", body: JSON.stringify({ phone, amount }) }),
  adminAnalytics: (days = 7) => req<AnalyticsReport>(`/admin/analytics?days=${days}`),
  adminReports: (period?: string) => req<ReportsSnapshot>(`/admin/reports${period ? `?period=${period}` : ""}`),
  adminHealth: () => req<HealthSnapshot>("/admin/health"),
  adminAudit: () => req<AuditEntry[]>("/admin/audit"),
  adminPruneIdentities: () => req<{ removed: number; kept: number; customerIds: string[] }>("/admin/identities/prune", { method: "POST" }),
  /* ---- interoperability layer (/api/v1) — paths are relative to BASE, so "/v1/…" ---- */
  v1Providers: () => req<{ providers: ProviderInfo[] }>("/v1/providers"),
  v1Rails: () => req<{ rails: RailInfo[] }>("/v1/rails"),
  v1Events: (provider?: string) => req<{ stats: { total: number; byStatus: Record<string, number>; byProvider: Record<string, number>; last24hRejected: number }; events: PaymentEvent[] }>(`/v1/webhooks/events${provider ? `?provider=${encodeURIComponent(provider)}` : ""}`),
  v1Reconciliation: () => req<ReconciliationReport>("/v1/reconciliation"),
  v1Resolve: (address: string) => req<PaymentAddress>("/v1/payment-addresses/resolve", { method: "POST", body: JSON.stringify({ address }) }),
  /** Ask the router which way to pay is best for this destination and amount. The key makes
   *  repeated asks for the same (destination, amount) reuse one intent instead of minting many. */
  v1Recommend: async (destination: string, amount: number, country: string) => {
    const key = `pick-${destination.replace(/\D/g, "")}-${amount}`;
    const it = await req<PaymentIntent | { error: string; intent?: PaymentIntent }>("/v1/payment-intents", { method: "POST", headers: { "Idempotency-Key": key }, body: JSON.stringify({ destination, amount, country }) });
    if (!("id" in it)) return null;
    return req<{ intent: PaymentIntent; routes: PaymentRoute[]; recommended: string | null }>(`/v1/payment-intents/${it.id}/routes`, { method: "POST" });
  },

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
  /** Live state of each crypto pay-in method — what the operator asked for AND whether the
   *  rail can actually receive it, which are not the same thing. */
  adminMethods: () => req<{ methods: Array<{ method: Method; enabled: boolean; offered: boolean; blocked: string | null; state: "off" | "unavailable" | "no_rail" | "live" }> }>("/admin/methods"),
  adminNotificationOutbox: () => req<{
    health: { total: number; sent: number; failed: number; skipped: number;
      channels: Array<{ name: string; configured: boolean; enabled: boolean; reaches: string[] }> };
    items: NotificationRecord[];
  }>("/admin/notifications/outbox"),
  adminNotifications: () => req<Array<{ id: string; t: string; s: string; tone: string; time: string }>>("/admin/notifications"),
  /** Cancel an un-paid payment (before any pay-in). 409 once anything has arrived. */
  cancelPayment: (id: string) => req<Payment>(`/payments/${id}/cancel`, { method: "POST" }),
  v1Observability: (hours = 24) => req<Observability>(`/v1/observability?hours=${hours}`),
  retryPayment: (id: string) => req<{ ok: boolean; reason?: string; message?: string; payment: Payment }>(`/admin/payments/${id}/retry`, { method: "POST" }),
  refundPayment: (id: string) => req<{ ok: boolean; payment: Payment }>(`/admin/payments/${id}/refund`, { method: "POST" }),

  adminPeex: () => req<PeexPanel>("/admin/peex"),
  peexTest: () => req<{ ok: boolean; detail: string }>("/admin/peex/test", { method: "POST" }),

  adminMerchants: () => req<MerchantGraph>("/admin/merchants"),
  adminMerchantSearch: (q: string) => req<{ merchants: Merchant[] }>(`/admin/merchants/search?q=${encodeURIComponent(q)}`),
  unflagMerchant: (id: string, reason?: string) => req<Merchant>(`/admin/merchants/${id}/unflag`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminMerchantAccounts: (q = "") => req<{ accounts: AdminMerchantAccount[]; stats: { total: number; active: number; pending: number; suspended: number; verified: number; listed: number; business: number } }>(`/admin/merchant-accounts${q ? `?q=${encodeURIComponent(q)}` : ""}`),
  adminMerchantAccount: (id: string) => req<AdminMerchantAccount & { links: MerchantLink[]; recent: Payment[] }>(`/admin/merchant-accounts/${id}`),
  adminMerchantAccountAction: (id: string, action: "suspend" | "reactivate" | "verify" | "unlist", reason?: string) => req<AdminMerchantAccount>(`/admin/merchant-accounts/${id}/${action}`, { method: "POST", body: JSON.stringify({ reason }) }),
  adminRouting: () => req<RoutingSnapshot>("/admin/routing"),
  validateMerchant: (id: string, displayName?: string) =>
    req<Merchant>(`/admin/merchants/${id}/validate`, { method: "POST", body: JSON.stringify({ displayName }) }),
  flagMerchant: (id: string, reason?: string) => req<Merchant>(`/admin/merchants/${id}/flag`, { method: "POST", body: JSON.stringify({ reason }) }),
  mergeMerchants: (keepId: string, dupeId: string) =>
    req<Merchant>("/admin/merchants/merge", { method: "POST", body: JSON.stringify({ keepId, dupeId }) }),

  requestClaim: (phone: string, opts: { via?: OtpVia; lang?: "en" | "fr" } = {}) =>
    req<OtpSent>("/identities/claim/request", { method: "POST", body: JSON.stringify({ phone, ...opts }) }),
  /** Payments received by the number this device has proven it owns (claim / own-your-number). */
  received: () => req<ReceivedList>("/me/received"),
  verifyClaim: (phone: string, code: string) =>
    req<{ claimed: boolean; identity: Identity }>("/identities/claim/verify", { method: "POST", body: JSON.stringify({ phone, code }) }),

  opsSnapshot: () => req<OpsSnapshot>("/ops/snapshot"),
};
