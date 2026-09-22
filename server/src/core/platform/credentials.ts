/* ============================================================
   API v1 — credentials.

     mm_live_<32 hex>   accepted only by the live deployment
     mm_test_<32 hex>   accepted only by the sandbox deployment

   Stored: id, SHA-256 of the secret (the plaintext is returned ONCE), organization,
   application, environment, scopes, status, created/revoked/last-used, optional IP
   allow-list, and a secret HINT (`mm_live_ab12…`) so a developer can tell keys apart.
   128 bits of random entropy make an unsalted hash safe against precomputation; the
   lookup is by hash, constant-time on the compare.

   Scopes (a credential can be narrowed below its role):
     quotes:write payments:read payments:write refunds:write webhooks:manage
     settlements:read settlements:write account:read usage:read recipients:validate
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { getOrganization, getApplication, type Organization } from "./orgs.js";

export type Environment = "live" | "test";
export type Scope = "quotes:write" | "payments:read" | "payments:write" | "refunds:write" | "webhooks:manage" | "settlements:read" | "settlements:write" | "account:read" | "usage:read" | "recipients:validate"
  | "identities:read" | "identities:write" | "invoices:read" | "invoices:write" | "payouts:read" | "payouts:write" | "balances:read";
export const ALL_SCOPES: Scope[] = ["quotes:write", "payments:read", "payments:write", "refunds:write", "webhooks:manage", "settlements:read", "settlements:write", "account:read", "usage:read", "recipients:validate", "identities:read", "identities:write", "invoices:read", "invoices:write", "payouts:read", "payouts:write", "balances:read"];

export interface Credential {
  id: string; orgId: string; appId: string; env: Environment; label: string;
  hint: string; scopes: Scope[]; status: "active" | "revoked";
  createdAt: string; createdBy: string; revokedAt?: string; lastUsedAt?: string;
  ipAllowlist?: string[];
  /** Optional HMAC signing requirement (enterprise): every request must carry X-MoMoMe-Signature. */
  requireSigning?: boolean;
}
interface Stored extends Credential { hash: string; /** hex sha256(secret); for signing-required keys the HMAC key is derived from the secret hash */ }

const creds = new Map<string, Stored>();
const byHash = new Map<string, string>(); // hash -> id
register("platform_credentials", () => [...creds.values()], (d: Stored[]) => { for (const c of d) { creds.set(c.id, c); byHash.set(c.hash, c.id); } });

const sha = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const pub = ({ hash: _h, ...c }: Stored): Credential => c;
const now = () => new Date().toISOString();

export function parseSecret(secret: string | undefined): { env: Environment; body: string } | null {
  if (!secret) return null;
  const m = /^mm_(live|test)_([0-9a-f]{32})$/.exec(secret.trim());
  return m ? { env: m[1] as Environment, body: m[2] } : null;
}

export function createCredential(input: { orgId: string; appId: string; env: Environment; label: string; scopes?: Scope[]; createdBy: string; ipAllowlist?: string[] }): { ok: true; credential: Credential; secret: string } | { ok: false; error: string } {
  const org = getOrganization(input.orgId); const app = getApplication(input.appId);
  if (!org || org.status !== "active") return { ok: false, error: "organization_unavailable" };
  if (!app || app.orgId !== org.id || app.archivedAt) return { ok: false, error: "application_invalid" };
  if (input.env === "live" && !org.liveEnabled) return { ok: false, error: "live_not_enabled" };
  const scopes = (input.scopes && input.scopes.length ? input.scopes : ALL_SCOPES).filter((s) => ALL_SCOPES.includes(s));
  if (!scopes.length) return { ok: false, error: "scopes_invalid" };
  const secret = `mm_${input.env}_${crypto.randomBytes(16).toString("hex")}`;
  const c: Stored = {
    id: `cred_${crypto.randomBytes(8).toString("hex")}`, orgId: org.id, appId: app.id, env: input.env,
    label: input.label.trim().slice(0, 80) || "Untitled", hint: `${secret.slice(0, 12)}…${secret.slice(-4)}`,
    scopes, status: "active", createdAt: now(), createdBy: input.createdBy, hash: sha(secret),
    ...(input.ipAllowlist?.length ? { ipAllowlist: input.ipAllowlist.slice(0, 20) } : {}),
  };
  creds.set(c.id, c); byHash.set(c.hash, c.id); touch("platform_credentials");
  return { ok: true, credential: pub(c), secret };
}

export function listCredentials(orgId: string, appId?: string): Credential[] {
  return [...creds.values()].filter((c) => c.orgId === orgId && (!appId || c.appId === appId)).map(pub).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function getCredential(id: string): Credential | undefined { const c = creds.get(id); return c && pub(c); }
export function revokeCredential(id: string): boolean {
  const c = creds.get(id); if (!c || c.status === "revoked") return false;
  c.status = "revoked"; c.revokedAt = now(); touch("platform_credentials"); return true;
}
/** Rotate: a new secret with the same org/app/env/scopes/label; the old one is revoked
 *  after `graceMs` (default 0 — immediately) so a deploy can swap without an outage. */
export function rotateCredential(id: string, by: string, graceMs = 0): ReturnType<typeof createCredential> {
  const c = creds.get(id); if (!c || c.status === "revoked") return { ok: false, error: "credential_not_found" };
  const r = createCredential({ orgId: c.orgId, appId: c.appId, env: c.env, label: c.label, scopes: c.scopes, createdBy: by, ipAllowlist: c.ipAllowlist });
  if (!r.ok) return r;
  if (graceMs > 0) setTimeout(() => revokeCredential(id), graceMs).unref?.(); else revokeCredential(id);
  return r;
}
export function updateCredential(id: string, patch: { label?: string; scopes?: Scope[]; ipAllowlist?: string[] | null; requireSigning?: boolean }): Credential | undefined {
  const c = creds.get(id); if (!c) return undefined;
  if (patch.label) c.label = patch.label.trim().slice(0, 80);
  if (patch.scopes) { const s = patch.scopes.filter((x) => ALL_SCOPES.includes(x)); if (s.length) c.scopes = s; }
  if (patch.ipAllowlist === null) delete c.ipAllowlist; else if (patch.ipAllowlist) c.ipAllowlist = patch.ipAllowlist.slice(0, 20);
  if (patch.requireSigning !== undefined) c.requireSigning = patch.requireSigning;
  touch("platform_credentials"); return pub(c);
}

export interface AuthContext { credential: Credential; org: Organization; env: Environment }

/** Resolve a presented secret. Returns the context, or a reason. The environment check
 *  is the CALLER's (index.ts knows which deployment this is). */
export function authenticate(secret: string | undefined, ip?: string): { ok: true; ctx: AuthContext } | { ok: false; reason: "malformed" | "unknown" | "revoked" | "org_suspended" | "ip_not_allowed" } {
  const parsed = parseSecret(secret);
  if (!parsed) return { ok: false, reason: "malformed" };
  const h = sha(secret!.trim());
  const id = byHash.get(h);
  const c = id ? creds.get(id) : undefined;
  // Constant-time confirmation even though the map lookup already matched (defence in depth).
  if (!c || !crypto.timingSafeEqual(Buffer.from(c.hash, "hex"), Buffer.from(h, "hex"))) return { ok: false, reason: "unknown" };
  if (c.status === "revoked") return { ok: false, reason: "revoked" };
  const org = getOrganization(c.orgId);
  if (!org || org.status !== "active") return { ok: false, reason: "org_suspended" };
  if (c.ipAllowlist?.length && ip && !c.ipAllowlist.includes(ip)) return { ok: false, reason: "ip_not_allowed" };
  // Stamp last use no more than once a minute — the write is a snapshot, not a row.
  if (!c.lastUsedAt || Date.now() - Date.parse(c.lastUsedAt) > 60_000) { c.lastUsedAt = now(); touch("platform_credentials"); }
  return { ok: true, ctx: { credential: pub(c), org, env: c.env } };
}

/** Sandbox verification of a production-issued test key: the sandbox sends the HASH,
 *  production answers with the credential record (never the secret). See sync.ts. */
export function credentialByHash(hashHex: string): Credential | undefined { const id = byHash.get(hashHex); const c = id && creds.get(id); return c ? pub(c) : undefined; }
/** Adopt a credential record verified elsewhere (sandbox side). */
export function adoptCredential(c: Credential, hashHex: string): void { creds.set(c.id, { ...c, hash: hashHex }); byHash.set(hashHex, c.id); touch("platform_credentials"); }
export const secretHash = sha;

export function _resetCredentials(): void { creds.clear(); byHash.clear(); }
