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

const BASE = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
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
  resolveRecipient: (phone: string) =>
    req<ResolveResult>(`/recipients/resolve?phone=${encodeURIComponent(phone)}`),

  createQuote: (body: QuoteRequest) =>
    req<Quote>("/quotes", { method: "POST", body: JSON.stringify(body) }),

  createPayment: (body: CreatePaymentRequest) =>
    req<Payment>("/payments", { method: "POST", body: JSON.stringify(body) }),

  confirmPayment: (id: string) =>
    req<Payment>(`/payments/${id}/confirm`, { method: "POST" }),

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
