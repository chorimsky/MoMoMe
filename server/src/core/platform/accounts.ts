/* ============================================================
   Developer accounts — lifecycle beyond sign-up:
     • one-time action tokens (verify email, reset password, accept invitation): random,
       hashed at rest, single use, expiring (24 h verify/invite, 1 h reset);
     • session versioning: every user has a `sessionVersion`; a token carries the version it
       was issued with and dies when the user logs out everywhere or changes password;
     • requests to the operator: KYB submission (company details), plan change (business /
       enterprise) and live access — one queue the operator works from Admin → API Platform.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { getOrganization, updateOrganization } from "./orgs.js";

export type TokenKind = "verify_email" | "reset_password" | "invitation";
interface ActionToken { hash: string; kind: TokenKind; userId: string; orgId?: string; role?: string; expiresAt: string; usedAt?: string }
const tokens = new Map<string, ActionToken>();
const versions = new Map<string, number>();          // userId -> sessionVersion
const verified = new Set<string>();                  // userIds with a verified email
register("platform_action_tokens", () => [...tokens.values()].filter((t) => !t.usedAt && Date.parse(t.expiresAt) > Date.now()), (d: ActionToken[]) => { for (const t of d) tokens.set(t.hash, t); });
register("platform_session_versions", () => Object.fromEntries(versions), (d: Record<string, number>) => { for (const [k, v] of Object.entries(d ?? {})) versions.set(k, v); });
register("platform_verified_emails", () => [...verified], (d: string[]) => { for (const u of d ?? []) verified.add(u); });

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const TTL: Record<TokenKind, number> = { verify_email: 24 * 3_600_000, reset_password: 3_600_000, invitation: 7 * 24 * 3_600_000 };

export function issueActionToken(kind: TokenKind, userId: string, extra: { orgId?: string; role?: string } = {}): string {
  // One live token per kind per user: issuing a new one invalidates the previous.
  for (const [h, t] of tokens) if (t.userId === userId && t.kind === kind && !t.usedAt) tokens.delete(h);
  const raw = `${kind === "reset_password" ? "rp" : kind === "invitation" ? "inv" : "vf"}_${crypto.randomBytes(24).toString("hex")}`;
  tokens.set(sha(raw), { hash: sha(raw), kind, userId, ...extra, expiresAt: new Date(Date.now() + TTL[kind]).toISOString() });
  touch("platform_action_tokens");
  return raw;
}
/** Consume a token: returns its payload once, never again. */
export function consumeActionToken(kind: TokenKind, raw: string): { userId: string; orgId?: string; role?: string } | null {
  const t = tokens.get(sha(raw ?? ""));
  if (!t || t.kind !== kind || t.usedAt || Date.parse(t.expiresAt) <= Date.now()) return null;
  t.usedAt = new Date().toISOString(); touch("platform_action_tokens");
  return { userId: t.userId, orgId: t.orgId, role: t.role };
}
export function peekActionToken(kind: TokenKind, raw: string): { userId: string; orgId?: string } | null {
  const t = tokens.get(sha(raw ?? "")); return t && t.kind === kind && !t.usedAt && Date.parse(t.expiresAt) > Date.now() ? { userId: t.userId, orgId: t.orgId } : null;
}

export const sessionVersion = (userId: string) => versions.get(userId) ?? 1;
/** Log the user out everywhere (logout, password change, reset). */
export function bumpSessionVersion(userId: string): number { const v = sessionVersion(userId) + 1; versions.set(userId, v); touch("platform_session_versions"); return v; }
export const isEmailVerified = (userId: string) => verified.has(userId);
export function markEmailVerified(userId: string): void { verified.add(userId); touch("platform_verified_emails"); }

/* ---------- requests to the operator ---------- */
export type RequestKind = "kyb" | "plan_change" | "live_access";
export type RequestStatus = "open" | "approved" | "rejected";
export interface OperatorRequest {
  id: string; orgId: string; kind: RequestKind; status: RequestStatus; createdAt: string; updatedAt: string; byUserId: string;
  /** KYB: company details. Plan: { plan, note }. Live: { note }. */
  payload: Record<string, unknown>; decisionNote?: string; decidedBy?: string;
}
const requests = new Map<string, OperatorRequest>();
register("platform_requests", () => [...requests.values()], (d: OperatorRequest[]) => { for (const r of d) requests.set(r.id, r); });

export const KYB_FIELDS = ["legal_name", "registration_number", "country", "address", "website", "business_type", "expected_monthly_volume_xaf", "use_case", "contact_name", "contact_phone"] as const;
export function submitRequest(orgId: string, byUserId: string, kind: RequestKind, payload: Record<string, unknown>): { ok: true; request: OperatorRequest } | { ok: false; error: string } {
  const org = getOrganization(orgId); if (!org) return { ok: false, error: "organization_not_found" };
  const open = [...requests.values()].find((r) => r.orgId === orgId && r.kind === kind && r.status === "open");
  if (open) { open.payload = { ...open.payload, ...payload }; open.updatedAt = new Date().toISOString(); touch("platform_requests"); return { ok: true, request: open }; }
  if (kind === "kyb") {
    const missing = ["legal_name", "registration_number", "country", "contact_name"].filter((k) => !String(payload[k] ?? "").trim());
    if (missing.length) return { ok: false, error: `missing:${missing.join(",")}` };
    updateOrganization(orgId, { kyb: "pending" });
  }
  if (kind === "plan_change" && !["business", "enterprise", "developer"].includes(String(payload.plan))) return { ok: false, error: "plan_invalid" };
  if (kind === "live_access" && org.kyb !== "verified" && org.kyb !== "pending") return { ok: false, error: "kyb_required" };
  const r: OperatorRequest = { id: `rq_${crypto.randomBytes(6).toString("hex")}`, orgId, kind, status: "open", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), byUserId, payload };
  requests.set(r.id, r); touch("platform_requests");
  return { ok: true, request: r };
}
export function requestsOf(orgId: string): OperatorRequest[] { return [...requests.values()].filter((r) => r.orgId === orgId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function openRequests(): OperatorRequest[] { return [...requests.values()].filter((r) => r.status === "open").sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
export function allRequests(): OperatorRequest[] { return [...requests.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function getRequest(id: string): OperatorRequest | undefined { return requests.get(id); }
/** Decide a request; approval applies the change to the organization. */
export function decideRequest(id: string, decision: "approved" | "rejected", by: string, note?: string): OperatorRequest | undefined {
  const r = requests.get(id); if (!r || r.status !== "open") return r;
  r.status = decision; r.decidedBy = by; r.decisionNote = note; r.updatedAt = new Date().toISOString();
  if (decision === "approved") {
    if (r.kind === "kyb") updateOrganization(r.orgId, { kyb: "verified" });
    if (r.kind === "plan_change") updateOrganization(r.orgId, { plan: String(r.payload.plan) });
    if (r.kind === "live_access") updateOrganization(r.orgId, { liveEnabled: true, kyb: "verified" });
  } else if (r.kind === "kyb") updateOrganization(r.orgId, { kyb: "rejected" });
  touch("platform_requests");
  return r;
}
export function _resetAccounts(): void { tokens.clear(); versions.clear(); verified.clear(); requests.clear(); }
