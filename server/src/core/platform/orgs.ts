/* ============================================================
   API v1 — Identity context: User → Organization → Application → (credentials).

   A developer signs up (email + password, or is created by an operator), owns or joins an
   organization, and an organization has applications ("Production", "Sandbox", "Checkout
   service"). Credentials hang off applications (credentials.ts). Roles are per membership:
     owner   — everything, including billing, settlements and deleting the org
     admin   — manage applications, credentials, webhooks, members
     developer — create credentials for test, read everything
     finance — settlements and invoices, read-only elsewhere
     viewer  — read-only
   Permissions are derived from the role (rolePermissions) so a check is one function.

   Nothing here touches money. Persisted through the same register()/touch() seam as the
   rest of the server so it rides SQLite or Postgres unchanged.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";

export type OrgRole = "owner" | "admin" | "developer" | "finance" | "viewer";
export type Permission =
  | "org.read" | "org.update" | "org.delete"
  | "members.read" | "members.manage"
  | "apps.read" | "apps.manage"
  | "credentials.read" | "credentials.manage_test" | "credentials.manage_live"
  | "webhooks.read" | "webhooks.manage"
  | "payments.read" | "payments.write" | "refunds.write"
  | "settlements.read" | "settlements.write"
  | "usage.read" | "billing.read" | "billing.manage";

const ROLE_PERMS: Record<OrgRole, Permission[]> = {
  owner: ["org.read", "org.update", "org.delete", "members.read", "members.manage", "apps.read", "apps.manage", "credentials.read", "credentials.manage_test", "credentials.manage_live", "webhooks.read", "webhooks.manage", "payments.read", "payments.write", "refunds.write", "settlements.read", "settlements.write", "usage.read", "billing.read", "billing.manage"],
  admin: ["org.read", "org.update", "members.read", "members.manage", "apps.read", "apps.manage", "credentials.read", "credentials.manage_test", "credentials.manage_live", "webhooks.read", "webhooks.manage", "payments.read", "payments.write", "refunds.write", "settlements.read", "usage.read", "billing.read"],
  developer: ["org.read", "members.read", "apps.read", "apps.manage", "credentials.read", "credentials.manage_test", "webhooks.read", "webhooks.manage", "payments.read", "usage.read"],
  finance: ["org.read", "members.read", "apps.read", "payments.read", "settlements.read", "settlements.write", "usage.read", "billing.read", "billing.manage"],
  viewer: ["org.read", "members.read", "apps.read", "credentials.read", "webhooks.read", "payments.read", "settlements.read", "usage.read", "billing.read"],
};
export const rolePermissions = (r: OrgRole): Permission[] => ROLE_PERMS[r];
export const ROLES: OrgRole[] = ["owner", "admin", "developer", "finance", "viewer"];

export type OrgStatus = "active" | "suspended" | "closed";
export type KybStatus = "not_started" | "pending" | "verified" | "rejected";

export interface User { id: string; email: string; name: string; createdAt: string; lastLoginAt?: string; disabledAt?: string }
interface StoredUser extends User { passwordHash?: string; salt?: string }
export interface Organization {
  id: string; name: string; slug: string; status: OrgStatus; createdAt: string;
  country: string; // ISO-2 of the legal entity
  kyb: KybStatus;
  plan: string;    // pricing plan id (billing.ts); "developer" by default
  /** Live credentials may only be minted once the org is verified and enabled by an operator. */
  liveEnabled: boolean;
  suspendedAt?: string; suspendedReason?: string;
}
export interface Membership { orgId: string; userId: string; role: OrgRole; createdAt: string }
export interface Application { id: string; orgId: string; name: string; createdAt: string; archivedAt?: string; description?: string }

const users = new Map<string, StoredUser>();
const orgs = new Map<string, Organization>();
const memberships: Membership[] = [];
const apps = new Map<string, Application>();

register("platform_users", () => [...users.values()], (d: StoredUser[]) => { for (const u of d) users.set(u.id, u); });
register("platform_orgs", () => [...orgs.values()], (d: Organization[]) => { for (const o of d) orgs.set(o.id, o); });
register("platform_memberships", () => memberships, (d: Membership[]) => { memberships.length = 0; memberships.push(...d); });
register("platform_apps", () => [...apps.values()], (d: Application[]) => { for (const a of d) apps.set(a.id, a); });

const now = () => new Date().toISOString();
const newId = (p: string) => `${p}_${crypto.randomBytes(8).toString("hex")}`;
const publicUser = ({ passwordHash: _p, salt: _s, ...u }: StoredUser): User => u;

/* ---------- users ---------- */
const hashPassword = (pw: string, salt: string) => crypto.scryptSync(pw, salt, 32).toString("hex");

export function createUser(input: { email: string; name: string; password?: string }): { ok: true; user: User } | { ok: false; error: string } {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "email_invalid" };
  if ([...users.values()].some((u) => u.email === email)) return { ok: false, error: "email_taken" };
  if (input.password !== undefined && input.password.length < 10) return { ok: false, error: "password_too_short" };
  const salt = crypto.randomBytes(16).toString("hex");
  const u: StoredUser = { id: newId("usr"), email, name: input.name.trim().slice(0, 80) || email, createdAt: now(), ...(input.password ? { salt, passwordHash: hashPassword(input.password, salt) } : {}) };
  users.set(u.id, u); touch("platform_users");
  return { ok: true, user: publicUser(u) };
}
export function getUser(id: string): User | undefined { const u = users.get(id); return u && publicUser(u); }
export function userByEmail(email: string): User | undefined { const u = [...users.values()].find((x) => x.email === email.trim().toLowerCase()); return u && publicUser(u); }
export function verifyPassword(email: string, password: string): User | null {
  const u = [...users.values()].find((x) => x.email === email.trim().toLowerCase());
  if (!u || !u.passwordHash || !u.salt || u.disabledAt) return null;
  const a = Buffer.from(u.passwordHash, "hex"); const b = Buffer.from(hashPassword(password, u.salt), "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  u.lastLoginAt = now(); touch("platform_users");
  return publicUser(u);
}
export function setPassword(userId: string, password: string): boolean {
  const u = users.get(userId); if (!u || password.length < 10) return false;
  u.salt = crypto.randomBytes(16).toString("hex"); u.passwordHash = hashPassword(password, u.salt); touch("platform_users"); return true;
}

/* ---------- organizations ---------- */
const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 40) || "org";

export function createOrganization(input: { name: string; country?: string; ownerUserId: string }): Organization {
  let slug = slugify(input.name); let n = 1;
  while ([...orgs.values()].some((o) => o.slug === slug)) slug = `${slugify(input.name)}-${++n}`;
  const o: Organization = { id: newId("org"), name: input.name.trim().slice(0, 80), slug, status: "active", createdAt: now(), country: (input.country ?? "CM").toUpperCase().slice(0, 2), kyb: "not_started", plan: "developer", liveEnabled: false };
  orgs.set(o.id, o); touch("platform_orgs");
  memberships.push({ orgId: o.id, userId: input.ownerUserId, role: "owner", createdAt: now() }); touch("platform_memberships");
  // Every organization starts with one application so the first credential has a home.
  createApplication(o.id, "Default");
  return o;
}
/** The sandbox adopts organizations from production (sync.ts) — consulted after the local table. */
let orgFallback: ((id: string) => Organization | undefined) | null = null;
export function setOrganizationFallback(f: typeof orgFallback): void { orgFallback = f; }
export function getOrganization(id: string): Organization | undefined { return orgs.get(id) ?? orgFallback?.(id); }
export function listOrganizations(): Organization[] { return [...orgs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function updateOrganization(id: string, patch: Partial<Pick<Organization, "name" | "country" | "kyb" | "plan" | "liveEnabled" | "status" | "suspendedReason">>): Organization | undefined {
  const o = orgs.get(id); if (!o) return undefined;
  if (patch.name) o.name = patch.name.trim().slice(0, 80);
  if (patch.country) o.country = patch.country.toUpperCase().slice(0, 2);
  if (patch.kyb) o.kyb = patch.kyb;
  if (patch.plan) o.plan = patch.plan;
  if (patch.liveEnabled !== undefined) o.liveEnabled = patch.liveEnabled;
  if (patch.status) { o.status = patch.status; if (patch.status === "suspended") { o.suspendedAt = now(); o.suspendedReason = patch.suspendedReason; } else { delete o.suspendedAt; delete o.suspendedReason; } }
  touch("platform_orgs"); return o;
}

/* ---------- memberships ---------- */
export function membershipsOf(userId: string): Membership[] { return memberships.filter((m) => m.userId === userId); }
export function membersOf(orgId: string): Array<Membership & { user: User }> { return memberships.filter((m) => m.orgId === orgId).map((m) => ({ ...m, user: getUser(m.userId)! })).filter((m) => m.user); }
export function roleOf(userId: string, orgId: string): OrgRole | undefined { return memberships.find((m) => m.userId === userId && m.orgId === orgId)?.role; }
export function can(userId: string, orgId: string, perm: Permission): boolean { const r = roleOf(userId, orgId); return !!r && ROLE_PERMS[r].includes(perm); }
export function addMember(orgId: string, userId: string, role: OrgRole): Membership | undefined {
  if (!orgs.has(orgId) || !users.has(userId)) return undefined;
  const ex = memberships.find((m) => m.userId === userId && m.orgId === orgId);
  if (ex) { ex.role = role; touch("platform_memberships"); return ex; }
  const m: Membership = { orgId, userId, role, createdAt: now() }; memberships.push(m); touch("platform_memberships"); return m;
}
export function removeMember(orgId: string, userId: string): boolean {
  const i = memberships.findIndex((m) => m.userId === userId && m.orgId === orgId);
  if (i < 0) return false;
  // The last owner cannot leave — an organization without an owner is unmanageable.
  if (memberships[i].role === "owner" && memberships.filter((m) => m.orgId === orgId && m.role === "owner").length === 1) return false;
  memberships.splice(i, 1); touch("platform_memberships"); return true;
}

/* ---------- applications ---------- */
export function createApplication(orgId: string, name: string, description?: string): Application | undefined {
  if (!orgs.has(orgId)) return undefined;
  const a: Application = { id: newId("app"), orgId, name: name.trim().slice(0, 60) || "Application", createdAt: now(), ...(description ? { description: description.slice(0, 200) } : {}) };
  apps.set(a.id, a); touch("platform_apps"); return a;
}
export function getApplication(id: string): Application | undefined { return apps.get(id); }
export function applicationsOf(orgId: string): Application[] { return [...apps.values()].filter((a) => a.orgId === orgId && !a.archivedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
export function archiveApplication(id: string): boolean { const a = apps.get(id); if (!a || a.archivedAt) return false; a.archivedAt = now(); touch("platform_apps"); return true; }

/** Test seam. */
export function _resetPlatformIdentity(): void { users.clear(); orgs.clear(); memberships.length = 0; apps.clear(); }
