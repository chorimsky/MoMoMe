/* ============================================================
   Developer dashboard client — talks to /api/developers with a developer session token
   (never an API credential). The token lives in localStorage under mm:dev:token.
   ============================================================ */
import { API_BASE } from "./client.js";

const TOKEN_KEY = "mm:dev:token";
export const devToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setDevToken = (t: string | null) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* no storage */ } };
/** The public /v1 base for this deployment (API_BASE is …/api). */
export const V1_BASE = API_BASE.replace(/\/api$/, "") + "/v1";

export class DevError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const t = devToken();
  const r = await fetch(`${API_BASE}/developers${path}`, { ...init, headers: { "content-type": "application/json", ...(t ? { authorization: `Bearer ${t}` } : {}), ...(init.headers ?? {}) }, cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { if (r.status === 401) setDevToken(null); throw new DevError(r.status, body.error ?? "error", body.message ?? "Request failed."); }
  return body as T;
}
const post = <T,>(p: string, b: unknown) => req<T>(p, { method: "POST", body: JSON.stringify(b) });
const patch = <T,>(p: string, b: unknown) => req<T>(p, { method: "PATCH", body: JSON.stringify(b) });
const del = <T,>(p: string) => req<T>(p, { method: "DELETE" });

export interface DevUser { id: string; email: string; name: string; createdAt: string; lastLoginAt?: string }
export interface DevOrg { id: string; name: string; slug: string; status: string; createdAt: string; country: string; kyb: string; plan: string; liveEnabled: boolean; role?: string }
export interface DevApp { id: string; orgId: string; name: string; createdAt: string; description?: string }
export interface DevCredential { id: string; orgId: string; appId: string; env: "live" | "test"; label: string; hint: string; scopes: string[]; status: "active" | "revoked"; createdAt: string; revokedAt?: string; lastUsedAt?: string; ipAllowlist?: string[] }
export interface DevMember { user: DevUser; role: string; since: string }
export interface DevWebhook { id: string; url: string; events: string[]; createdAt: string; disabledAt?: string; failures: number; description?: string; secretHint: string; deliveries: Array<{ id: string; type: string; createdAt: string; attempts: number; deliveredAt?: string; dead?: boolean; lastStatus?: number; lastError?: string }> }
export interface UsageSummary { from: string; to: string; requests: number; errors: number; quotes: number; payments: number; completed: number; failed: number; volumeXaf: number; feesXaf: number; webhooks: number; webhookFailures: number; settlements: number; settledXaf: number; avgLatencyMs: number; successRatePct: number }
export interface UsageBlock { summary: UsageSummary; days: Array<{ day: string; requests: number; payments: number; completed: number; failed: number; volumeXaf: number; feesXaf: number }> }

export interface DevPlan { id: string; name: string; description?: string; platformFeePct: number; rateLimitRpm: number; tiers: Array<{ fromXaf: number; feePct: number }> }
export interface DevRequest { id: string; orgId: string; kind: "kyb" | "plan_change" | "live_access"; status: "open" | "approved" | "rejected"; createdAt: string; updatedAt: string; payload: Record<string, unknown>; decisionNote?: string }
export interface ConnectOverview { identity: Record<string, any>; balance: { available: number; currency: string }; funding: Record<string, boolean>; environment: "live" | "test"; invoices: Array<Record<string, any>>; intents: Array<Record<string, any>>; payouts: Array<Record<string, any>>; counterparties: Array<Record<string, any>>; settlement_intents: Array<Record<string, any>> }
export const dev = {
  connect: (id: string) => req<ConnectOverview>(`/orgs/${id}/connect`),
  connectIdentity: (id: string, b: Record<string, unknown>) => patch<Record<string, any>>(`/orgs/${id}/connect/identity`, b),
  connectAlias: (id: string, b: { type: string; value: string }) => post<Record<string, any>>(`/orgs/${id}/connect/identity/aliases`, b),
  connectInvoice: (id: string, b: Record<string, unknown>) => post<Record<string, any>>(`/orgs/${id}/connect/invoices`, b),
  connectCancelInvoice: (id: string, inv: string) => post<Record<string, any>>(`/orgs/${id}/connect/invoices/${inv}/cancel`, {}),
  connectPayout: (id: string, b: Record<string, unknown>) => post<Record<string, any>>(`/orgs/${id}/connect/payouts`, b),
  connectCounterparty: (id: string, b: Record<string, unknown>) => post<Record<string, any>>(`/orgs/${id}/connect/counterparties`, b),
  connectSandboxCredit: (id: string, amount = 100000) => post<{ available: number }>(`/orgs/${id}/connect/sandbox-credit`, { amount }),
  connectIntent: (id: string, pi: string) => req<Record<string, any>>(`/orgs/${id}/connect/intents/${pi}`),
  signup: (b: { email: string; name: string; password: string; organization: string; country?: string; plan?: string; note?: string; expected_monthly_volume_xaf?: string }) => post<{ user: DevUser; organization: DevOrg; token: string; expiresAt: string; email_verification?: { sent: boolean; dev_link?: string } }>("/signup", b),
  login: (b: { email: string; password: string }) => post<{ user: DevUser; token: string; expiresAt: string }>("/login", b),
  logout: (everywhere = false) => post<{ ok: boolean }>("/logout", { everywhere }),
  changePassword: (current: string, password: string) => post<{ ok: boolean; token: string }>("/password", { current, password }),
  verifyEmail: (token: string) => post<{ ok: boolean }>("/verify-email", { token }),
  resendVerification: () => post<{ ok: boolean; sent?: boolean; dev_link?: string; already?: boolean }>("/resend-verification", {}),
  forgotPassword: (email: string) => post<{ ok: boolean; message: string; dev_link?: string }>("/forgot-password", { email }),
  resetPassword: (token: string, password: string) => post<{ ok: boolean; token: string }>("/reset-password", { token, password }),
  invitation: (token: string) => req<{ email: string; name: string; organization: string; needs_password: boolean }>(`/invitation/${token}`),
  acceptInvitation: (token: string, password?: string) => post<{ ok: boolean; token: string }>(`/invitation/${token}/accept`, { password }),
  requests: (id: string) => req<{ requests: DevRequest[]; kyb_fields: string[] }>(`/orgs/${id}/requests`),
  submitRequest: (id: string, b: Record<string, string>) => post<DevRequest>(`/orgs/${id}/requests`, b),
  me: () => req<{ user: DevUser & { emailVerified: boolean }; organizations: DevOrg[]; environment: "live" | "test"; api_base: string; sandbox_base: string | null; plans: DevPlan[] }>("/me"),
  org: (id: string) => req<DevOrg & { plan: { id: string; name: string; rateLimitRpm: number; platformFeePct: number; tiers: Array<{ fromXaf: number; feePct: number }> }; balance: { available: number; pending: number }; applications: DevApp[]; credentials: number }>(`/orgs/${id}`),
  updateOrg: (id: string, b: { name?: string; country?: string }) => patch<DevOrg>(`/orgs/${id}`, b),
  members: (id: string) => req<{ members: DevMember[]; roles: string[] }>(`/orgs/${id}/members`),
  addMember: (id: string, b: { email: string; name?: string; role: string }) => post<{ member: unknown; user: DevUser; invitation?: { sent: boolean; dev_link?: string } }>(`/orgs/${id}/members`, b),
  removeMember: (id: string, uid: string) => del<{ ok: boolean }>(`/orgs/${id}/members/${uid}`),
  apps: (id: string) => req<{ applications: DevApp[] }>(`/orgs/${id}/apps`),
  createApp: (id: string, b: { name: string; description?: string }) => post<DevApp>(`/orgs/${id}/apps`, b),
  archiveApp: (id: string, app: string) => del<{ ok: boolean }>(`/orgs/${id}/apps/${app}`),
  credentials: (id: string) => req<{ credentials: DevCredential[]; scopes: string[] }>(`/orgs/${id}/credentials`),
  createCredential: (id: string, b: { environment: "live" | "test"; label: string; application_id?: string; scopes?: string[]; ip_allowlist?: string[] }) => post<{ credential: DevCredential; secret: string }>(`/orgs/${id}/credentials`, b),
  rotateCredential: (id: string, cred: string, graceSeconds = 0) => post<{ credential: DevCredential; secret: string; previous: string }>(`/orgs/${id}/credentials/${cred}/rotate`, { grace_seconds: graceSeconds }),
  revokeCredential: (id: string, cred: string) => post<DevCredential>(`/orgs/${id}/credentials/${cred}/revoke`, {}),
  updateCredential: (id: string, cred: string, b: { label?: string; scopes?: string[]; ip_allowlist?: string[] | null }) => patch<DevCredential>(`/orgs/${id}/credentials/${cred}`, b),
  webhooks: (id: string) => req<{ endpoints: DevWebhook[] }>(`/orgs/${id}/webhooks`),
  webhookEvents: (id: string) => req<{ events: string[] }>(`/orgs/${id}/webhooks/events`),
  createWebhook: (id: string, b: { url: string; events?: string[]; description?: string }) => post<{ endpoint: DevWebhook; secret: string }>(`/orgs/${id}/webhooks`, b),
  updateWebhook: (id: string, wh: string, b: { url?: string; events?: string[]; enabled?: boolean; description?: string }) => patch<DevWebhook>(`/orgs/${id}/webhooks/${wh}`, b),
  deleteWebhook: (id: string, wh: string) => del<{ ok: boolean }>(`/orgs/${id}/webhooks/${wh}`),
  testWebhook: (id: string, wh: string) => post<{ ok: boolean; event_ids: string[] }>(`/orgs/${id}/webhooks/${wh}/test`, {}),
  replayWebhook: (id: string, wh: string, eventId: string) => post<{ ok: boolean }>(`/orgs/${id}/webhooks/${wh}/replay`, { event_id: eventId }),
  payments: (id: string, q: { environment?: string; q?: string; status?: string } = {}) => req<{ payments: Array<Record<string, any>>; environment: string }>(`/orgs/${id}/payments?${new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([, v]) => v)) as Record<string, string>)}`),
  payment: (id: string, pid: string) => req<Record<string, any>>(`/orgs/${id}/payments/${pid}`),
  settlements: (id: string, environment?: string) => req<{ settlements: Array<Record<string, any>>; balance: { available: number; pending: number } }>(`/orgs/${id}/settlements${environment ? `?environment=${environment}` : ""}`),
  usage: (id: string) => req<{ live: UsageBlock; test: UsageBlock }>(`/orgs/${id}/usage`),
  invoices: (id: string) => req<{ invoices: Array<Record<string, any>>; plan: Record<string, any>; plans: Array<Record<string, any>> }>(`/orgs/${id}/invoices`),
  audit: (id: string) => req<{ events: Array<{ id: string; at: string; action: string; actor: { type: string; id: string; label?: string }; target?: { type: string; id: string }; details?: Record<string, unknown> }> }>(`/orgs/${id}/audit`),
};
