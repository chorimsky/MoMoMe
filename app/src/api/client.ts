/* ============================================================
   Typed API client — the single seam to the settlement backend.
   Every network call lives here; swap the base URL to repoint.
   ============================================================ */
import type {
  Quote, QuoteRequest, Payment, CreatePaymentRequest, ResolveResult,
  AdminOverview, AdminCustomer, OpsSnapshot, LedgerEntry, AdminSettings,
  Identity, IdentityStats, LiquiditySnapshot, PricingInfo, ComplianceSnapshot, PeexPanel,
  DeliverySnapshot, MobileMoneyInfo, ReportsSnapshot, HealthSnapshot, AuditEntry,
  Merchant, MerchantGraph, ResolveMerchantResult, CountryCode, ProviderId, RoutingSnapshot,
} from "@shared/types.js";

// Same-origin "/api" by default (Vite proxy in dev, Vercel rewrite in prod).
// Set VITE_API_BASE to point at a separately-hosted backend (e.g. a persistent
// Node host) without code changes.
const BASE = (import.meta.env.VITE_API_BASE ?? "/api").replace(/\/$/, "");

/* ---------- admin session token ---------- */
const TOKEN_KEY = "mm_admin_token";
let adminToken: string | null = (() => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } })();

export function setAdminToken(token: string | null): void {
  adminToken = token;
  try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked */ }
}
export function getAdminToken(): string | null { return adminToken; }

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    // An expired/invalid session on a protected admin call → drop the token and
    // signal the console to fall back to the login gate.
    if (res.status === 401 && path.startsWith("/admin/") && path !== "/admin/login") {
      setAdminToken(null);
      try { window.dispatchEvent(new Event("mm-admin-unauthorized")); } catch { /* non-browser */ }
    }
    let message = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.message) message = body.message;
    } catch {
      /* non-JSON error */
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export const api = {
  getConfig: () => req<{ demoMode: boolean; demoHint: string; brandLogo: string | null }>("/config"),

  // Admin auth. login stores the session token; session checks the current one.
  adminLogin: async (password: string) => {
    const r = await req<{ token: string; expiresAt: string }>("/admin/login", { method: "POST", body: JSON.stringify({ password }) });
    setAdminToken(r.token);
    return r;
  },
  adminSession: () => req<{ authenticated: boolean; passwordIsDefault: boolean }>("/admin/session"),
  adminLogout: () => setAdminToken(null),

  resolveRecipient: (phone: string, country: CountryCode = "CM") =>
    req<ResolveResult>(`/recipients/resolve?phone=${encodeURIComponent(phone)}&country=${country}`),

  createQuote: (body: QuoteRequest) =>
    req<Quote>("/quotes", { method: "POST", body: JSON.stringify(body) }),

  createPayment: (body: CreatePaymentRequest) =>
    req<Payment>("/payments", { method: "POST", body: JSON.stringify(body) }),

  confirmPayment: (id: string) =>
    req<Payment>(`/payments/${id}/confirm`, { method: "POST" }),

  // Demo-only: simulate the inbound (sandbox). 403s in production.
  simulatePayment: (id: string) =>
    req<Payment>(`/payments/${id}/simulate`, { method: "POST" }),

  getPayment: (id: string) => req<Payment>(`/payments/${id}`),

  listPayments: () => req<Payment[]>("/payments"),

  ledger: (paymentId: string) => req<LedgerEntry[]>(`/ledger/${paymentId}`),

  adminOverview: () => req<AdminOverview>("/admin/overview"),
  adminCustomers: () => req<AdminCustomer[]>("/admin/customers"),
  adminPayments: () => req<Payment[]>("/admin/payments"),

  adminSettings: () => req<AdminSettings>("/admin/settings"),
  saveSettings: (patch: Partial<AdminSettings>) =>
    req<AdminSettings>("/admin/settings", { method: "PUT", body: JSON.stringify(patch) }),

  adminIdentities: () => req<Identity[]>("/admin/identities"),
  adminIdentityStats: () => req<IdentityStats>("/admin/identities/stats"),
  claimIdentity: (id: string) => req<Identity>(`/admin/identities/${id}/claim`, { method: "POST" }),

  adminLiquidity: () => req<LiquiditySnapshot>("/admin/liquidity"),
  adminPricing: () => req<PricingInfo>("/admin/pricing"),
  adminCompliance: () => req<ComplianceSnapshot>("/admin/compliance"),
  adminDelivery: () => req<DeliverySnapshot>("/admin/delivery"),
  adminMobileMoney: () => req<MobileMoneyInfo>("/admin/mobile-money"),
  adminReports: (period?: string) => req<ReportsSnapshot>(`/admin/reports${period ? `?period=${period}` : ""}`),
  adminHealth: () => req<HealthSnapshot>("/admin/health"),
  adminAudit: () => req<AuditEntry[]>("/admin/audit"),
  adminRails: () => req<{
    liveMoney: boolean;
    crypto: { provider: string; env: string; configured: boolean; live: boolean; apiUrl: string; accountId: string; clientId: string; webhookSecret: string; methods: string[]; sandboxPayout: boolean };
    payout: Array<{ name: string; env: string; configured: boolean; live: boolean; apiUrl: string; apiKey: string }>;
  }>("/admin/rails"),
  adminNotifications: () => req<Array<{ id: string; t: string; s: string; tone: string; time: string }>>("/admin/notifications"),
  retryPayment: (id: string) => req<{ ok: boolean; payment: Payment }>(`/admin/payments/${id}/retry`, { method: "POST" }),
  refundPayment: (id: string) => req<{ ok: boolean; payment: Payment }>(`/admin/payments/${id}/refund`, { method: "POST" }),

  adminPeex: () => req<PeexPanel>("/admin/peex"),
  peexTest: () => req<{ ok: boolean; detail: string }>("/admin/peex/test", { method: "POST" }),

  resolveMerchant: (input: string, country?: CountryCode, provider?: ProviderId) =>
    req<ResolveMerchantResult>("/merchants/resolve", { method: "POST", body: JSON.stringify({ input, country, provider }) }),
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
