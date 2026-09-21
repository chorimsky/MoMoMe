/* ============================================================
   /api/developers — the developer dashboard's backend (docs/api-v1 §29).

   Sessions are developer tokens (core/platform/devAuth), never API credentials: a
   credential moves money, a dashboard session manages who may. Every write is audited.

     POST /signup  /login  /logout        GET /me
     GET  /orgs                           POST /orgs
     GET  /orgs/:org                      PATCH /orgs/:org
     GET  /orgs/:org/members              POST /orgs/:org/members   DELETE /orgs/:org/members/:uid
     GET  /orgs/:org/apps                 POST /orgs/:org/apps      DELETE /orgs/:org/apps/:app
     GET  /orgs/:org/credentials          POST /orgs/:org/credentials
     POST /orgs/:org/credentials/:id/rotate  /revoke   PATCH /orgs/:org/credentials/:id
     GET  /orgs/:org/webhooks  (+ deliveries)   POST …/webhooks/:id/replay
     GET  /orgs/:org/payments             GET /orgs/:org/payments/:id
     GET  /orgs/:org/settlements          GET /orgs/:org/usage      GET /orgs/:org/invoices
     GET  /orgs/:org/audit
   ============================================================ */
import { Router, type Request, type Response, type NextFunction } from "express";
import { rateLimitDurableMiddleware, clientIp } from "../core/ratelimit.js";
import { createUser, verifyPassword, getUser, userByEmail, createOrganization, getOrganization, updateOrganization, membershipsOf, membersOf, addMember, removeMember, can, createApplication, applicationsOf, archiveApplication, ROLES, type OrgRole, type Permission } from "../core/platform/orgs.js";
import { createCredential, listCredentials, getCredential, revokeCredential, rotateCredential, updateCredential, ALL_SCOPES, type Scope, type Environment } from "../core/platform/credentials.js";
import { issueDevToken, verifyDevToken } from "../core/platform/devAuth.js";
import { audit, auditOf } from "../core/platform/audit.js";
import { listSubscriptions, eventsOf, replayEvent } from "../core/interop/outbound.js";
import { metasOf, metaOf } from "../core/platform/paymentMeta.js";
import { publicPayment } from "../core/platform/mapping.js";
import { settlementsOf, publicSettlement, orgBalance } from "../core/platform/settlements.js";
import { usageSummary } from "../core/platform/usage.js";
import { invoicesOf, planOfOrg, listPlans } from "../core/platform/billing.js";
import { store } from "../db/store.js";
import { liveMoney, config } from "../config.js";

export const developers = Router();
type DevReq = Request & { dev: { uid: string } };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const bad = (res: Response, status: number, error: string, message: string) => res.status(status).json({ error, message });
const tokenOf = (req: Request) => { const a = req.headers.authorization; const s = Array.isArray(a) ? a[0] : a; return s?.startsWith("Bearer ") ? s.slice(7).trim() : undefined; };

/* ---------- accounts ---------- */
developers.post("/signup", rateLimitDurableMiddleware("dev_signup", 10, 3_600_000), (req, res) => {
  if (process.env.DEVELOPER_SIGNUP === "off") return bad(res, 403, "signup_closed", "Developer sign-up is by invitation right now. Write to developers@momome.xyz.");
  const b = req.body ?? {};
  const r = createUser({ email: str(b.email), name: str(b.name), password: str(b.password) });
  if (!r.ok) return bad(res, 400, r.error, r.error === "email_taken" ? "An account with this email already exists." : r.error === "password_too_short" ? "Use at least 10 characters." : "Enter a valid email address.");
  const org = createOrganization({ name: str(b.organization) || `${r.user.name}'s organization`, country: str(b.country) || "CM", ownerUserId: r.user.id });
  audit({ orgId: org.id, actor: { type: "user", id: r.user.id, label: r.user.email }, action: "developer.signed_up", ip: clientIp(req) });
  const t = issueDevToken(r.user.id);
  res.status(201).json({ user: r.user, organization: org, ...t });
});
developers.post("/login", rateLimitDurableMiddleware("dev_login", 20, 900_000), (req, res) => {
  const b = req.body ?? {};
  const u = verifyPassword(str(b.email), str(b.password));
  if (!u) return bad(res, 401, "invalid_credentials", "Email or password is incorrect.");
  const t = issueDevToken(u.id);
  res.json({ user: u, ...t });
});
developers.use((req: Request, res: Response, next: NextFunction) => {
  const s = verifyDevToken(tokenOf(req));
  const u = s && getUser(s.uid);
  if (!s || !u || u.disabledAt) return bad(res, 401, "unauthorized", "Sign in to the developer dashboard.");
  (req as DevReq).dev = { uid: u.id };
  next();
});
developers.get("/me", (req, res) => {
  const uid = (req as DevReq).dev.uid;
  res.json({ user: getUser(uid), organizations: membershipsOf(uid).map((m) => ({ ...getOrganization(m.orgId)!, role: m.role })), environment: liveMoney() ? "live" : "test", api_base: `${config.publicUrl}/v1`, sandbox_base: process.env.SANDBOX_API_URL ?? null });
});
developers.post("/orgs", (req, res) => {
  const uid = (req as DevReq).dev.uid;
  const name = str((req.body ?? {}).name); if (!name) return bad(res, 400, "bad_request", "Organization name is required.");
  const org = createOrganization({ name, country: str((req.body ?? {}).country) || "CM", ownerUserId: uid });
  audit({ orgId: org.id, actor: { type: "user", id: uid }, action: "organization.created", ip: clientIp(req) });
  res.status(201).json(org);
});
developers.get("/orgs", (req, res) => { const uid = (req as DevReq).dev.uid; res.json({ organizations: membershipsOf(uid).map((m) => ({ ...getOrganization(m.orgId)!, role: m.role })) }); });

/* ---------- per-organization, permission-gated ---------- */
const guard = (perm: Permission) => (req: Request, res: Response, next: NextFunction) => {
  const uid = (req as DevReq).dev.uid; const org = getOrganization(req.params.org);
  if (!org) return bad(res, 404, "not_found", "No such organization.");
  if (!can(uid, org.id, perm)) return bad(res, 403, "forbidden", `Your role in this organization cannot ${perm.replace(".", " ")}.`);
  next();
};
const actor = (req: Request) => ({ type: "user" as const, id: (req as DevReq).dev.uid, label: getUser((req as DevReq).dev.uid)?.email });

developers.get("/orgs/:org", guard("org.read"), (req, res) => {
  const org = getOrganization(req.params.org)!;
  res.json({ ...org, role: membershipsOf((req as DevReq).dev.uid).find((m) => m.orgId === org.id)?.role, plan: planOfOrg(org.id), balance: orgBalance(org.id), applications: applicationsOf(org.id), credentials: listCredentials(org.id).length });
});
developers.patch("/orgs/:org", guard("org.update"), (req, res) => {
  const b = req.body ?? {};
  const o = updateOrganization(req.params.org, { name: str(b.name) || undefined, country: str(b.country) || undefined });
  audit({ orgId: req.params.org, actor: actor(req), action: "organization.updated", ip: clientIp(req) });
  res.json(o);
});
developers.get("/orgs/:org/members", guard("members.read"), (req, res) => res.json({ members: membersOf(req.params.org).map((m) => ({ user: m.user, role: m.role, since: m.createdAt })), roles: ROLES }));
developers.post("/orgs/:org/members", guard("members.manage"), (req, res) => {
  const b = req.body ?? {}; const role = str(b.role) as OrgRole;
  if (!ROLES.includes(role)) return bad(res, 400, "bad_request", `Role must be one of ${ROLES.join(", ")}.`);
  let u = userByEmail(str(b.email));
  if (!u) { const r = createUser({ email: str(b.email), name: str(b.name) || str(b.email) }); if (!r.ok) return bad(res, 400, r.error, "Enter a valid email address."); u = r.user; }
  const m = addMember(req.params.org, u.id, role);
  audit({ orgId: req.params.org, actor: actor(req), action: "member.added", target: { type: "user", id: u.id }, details: { role }, ip: clientIp(req) });
  res.status(201).json({ member: m, user: u, note: u.lastLoginAt ? undefined : "The invited person sets a password through 'forgot password' (or an operator sets one)." });
});
developers.delete("/orgs/:org/members/:uid", guard("members.manage"), (req, res) => {
  if (!removeMember(req.params.org, req.params.uid)) return bad(res, 409, "cannot_remove", "The last owner cannot be removed.");
  audit({ orgId: req.params.org, actor: actor(req), action: "member.removed", target: { type: "user", id: req.params.uid }, ip: clientIp(req) });
  res.json({ ok: true });
});
developers.get("/orgs/:org/apps", guard("apps.read"), (req, res) => res.json({ applications: applicationsOf(req.params.org) }));
developers.post("/orgs/:org/apps", guard("apps.manage"), (req, res) => {
  const a = createApplication(req.params.org, str((req.body ?? {}).name), str((req.body ?? {}).description) || undefined);
  if (!a) return bad(res, 404, "not_found", "No such organization.");
  audit({ orgId: req.params.org, actor: actor(req), action: "application.created", target: { type: "application", id: a.id }, ip: clientIp(req) });
  res.status(201).json(a);
});
developers.delete("/orgs/:org/apps/:app", guard("apps.manage"), (req, res) => {
  if (!archiveApplication(req.params.app)) return bad(res, 404, "not_found", "No such application.");
  for (const c of listCredentials(req.params.org, req.params.app)) revokeCredential(c.id);
  audit({ orgId: req.params.org, actor: actor(req), action: "application.archived", target: { type: "application", id: req.params.app }, ip: clientIp(req) });
  res.json({ ok: true });
});

/* ---------- credentials ---------- */
developers.get("/orgs/:org/credentials", guard("credentials.read"), (req, res) => res.json({ credentials: listCredentials(req.params.org), scopes: ALL_SCOPES }));
developers.post("/orgs/:org/credentials", guard("credentials.read"), (req, res) => {
  const uid = (req as DevReq).dev.uid; const b = req.body ?? {};
  const env = (str(b.environment) || "test") as Environment;
  if (env !== "live" && env !== "test") return bad(res, 400, "bad_request", "environment must be live or test.");
  if (!can(uid, req.params.org, env === "live" ? "credentials.manage_live" : "credentials.manage_test")) return bad(res, 403, "forbidden", `Your role cannot create ${env} credentials.`);
  const apps = applicationsOf(req.params.org);
  const appId = str(b.application_id) || apps[0]?.id;
  const scopes = Array.isArray(b.scopes) ? (b.scopes as unknown[]).map(str).filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s)) : undefined;
  const r = createCredential({ orgId: req.params.org, appId, env, label: str(b.label), scopes, createdBy: uid, ipAllowlist: Array.isArray(b.ip_allowlist) ? (b.ip_allowlist as unknown[]).map(str).filter(Boolean) : undefined });
  if (!r.ok) return bad(res, r.error === "live_not_enabled" ? 403 : 400, r.error, r.error === "live_not_enabled" ? "Live credentials are enabled once your organization is verified. Request activation from the dashboard." : "Could not create the credential.");
  audit({ orgId: req.params.org, actor: actor(req), action: "credential.created", target: { type: "credential", id: r.credential.id }, details: { env, scopes: r.credential.scopes }, ip: clientIp(req) });
  res.status(201).json({ credential: r.credential, secret: r.secret, note: "Copy the secret now — it is shown once." });
});
developers.post("/orgs/:org/credentials/:id/rotate", guard("credentials.read"), (req, res) => {
  const uid = (req as DevReq).dev.uid; const c = getCredential(req.params.id);
  if (!c || c.orgId !== req.params.org) return bad(res, 404, "not_found", "No such credential.");
  if (!can(uid, req.params.org, c.env === "live" ? "credentials.manage_live" : "credentials.manage_test")) return bad(res, 403, "forbidden", "Your role cannot rotate this credential.");
  const grace = Math.min(24 * 3_600_000, Math.max(0, Number((req.body ?? {}).grace_seconds ?? 0) * 1000));
  const r = rotateCredential(c.id, uid, grace);
  if (!r.ok) return bad(res, 400, r.error, "Could not rotate.");
  audit({ orgId: req.params.org, actor: actor(req), action: "credential.rotated", target: { type: "credential", id: c.id }, details: { replacement: r.credential.id, graceMs: grace }, ip: clientIp(req) });
  res.status(201).json({ credential: r.credential, secret: r.secret, previous: c.id, previous_revoked_in_seconds: grace / 1000 });
});
developers.post("/orgs/:org/credentials/:id/revoke", guard("credentials.read"), (req, res) => {
  const uid = (req as DevReq).dev.uid; const c = getCredential(req.params.id);
  if (!c || c.orgId !== req.params.org) return bad(res, 404, "not_found", "No such credential.");
  if (!can(uid, req.params.org, c.env === "live" ? "credentials.manage_live" : "credentials.manage_test")) return bad(res, 403, "forbidden", "Your role cannot revoke this credential.");
  revokeCredential(c.id);
  audit({ orgId: req.params.org, actor: actor(req), action: "credential.revoked", target: { type: "credential", id: c.id }, ip: clientIp(req) });
  res.json(getCredential(c.id));
});
developers.patch("/orgs/:org/credentials/:id", guard("credentials.read"), (req, res) => {
  const uid = (req as DevReq).dev.uid; const c = getCredential(req.params.id); const b = req.body ?? {};
  if (!c || c.orgId !== req.params.org) return bad(res, 404, "not_found", "No such credential.");
  if (!can(uid, req.params.org, c.env === "live" ? "credentials.manage_live" : "credentials.manage_test")) return bad(res, 403, "forbidden", "Your role cannot change this credential.");
  const out = updateCredential(c.id, { label: str(b.label) || undefined, scopes: Array.isArray(b.scopes) ? (b.scopes as unknown[]).map(str).filter((s): s is Scope => (ALL_SCOPES as string[]).includes(s)) : undefined, ipAllowlist: b.ip_allowlist === null ? null : Array.isArray(b.ip_allowlist) ? (b.ip_allowlist as unknown[]).map(str).filter(Boolean) : undefined });
  audit({ orgId: req.params.org, actor: actor(req), action: "credential.updated", target: { type: "credential", id: c.id }, ip: clientIp(req) });
  res.json(out);
});

/* ---------- read models ---------- */
const envOf = () => (liveMoney() ? "live" : "test") as "live" | "test";
developers.get("/orgs/:org/webhooks", guard("webhooks.read"), (req, res) => res.json({ endpoints: listSubscriptions(`org:${req.params.org}`).map((s) => ({ ...s, deliveries: eventsOf(`org:${req.params.org}`, s.id, 20) })) }));
developers.post("/orgs/:org/webhooks/:id/replay", guard("webhooks.manage"), (req, res) => {
  const ok = replayEvent(`org:${req.params.org}`, str((req.body ?? {}).event_id));
  if (ok) audit({ orgId: req.params.org, actor: actor(req), action: "webhook.replayed", target: { type: "webhook_endpoint", id: req.params.id }, ip: clientIp(req) });
  res.status(ok ? 200 : 404).json({ ok });
});
developers.get("/orgs/:org/payments", guard("payments.read"), async (req, res) => {
  const env = (str(req.query.environment) || envOf()) as "live" | "test";
  const q = str(req.query.q).toLowerCase(); const status = str(req.query.status).toUpperCase();
  const out = [];
  for (const m of metasOf(req.params.org, env).sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const p = await store().getPayment(m.paymentId); if (!p) continue;
    const pp = publicPayment(p);
    if (status && pp.status !== status) continue;
    if (q && !`${p.id} ${p.ref} ${m.reference ?? ""} ${p.recipient.phone} ${p.recipient.name}`.toLowerCase().includes(q)) continue;
    out.push({ ...pp, ref: p.ref }); if (out.length >= 200) break;
  }
  res.json({ payments: out, environment: env });
});
developers.get("/orgs/:org/payments/:id", guard("payments.read"), async (req, res) => {
  const m = metaOf(req.params.id); if (!m || m.orgId !== req.params.org) return bad(res, 404, "not_found", "No such payment.");
  const p = await store().getPayment(m.paymentId); if (!p) return bad(res, 404, "not_found", "No such payment.");
  res.json({ ...publicPayment(p), ref: p.ref, meta: m, engine_events: p.events });
});
developers.get("/orgs/:org/settlements", guard("settlements.read"), (req, res) => res.json({ settlements: settlementsOf(req.params.org, (str(req.query.environment) || envOf())).map(publicSettlement), balance: orgBalance(req.params.org) }));
developers.get("/orgs/:org/usage", guard("usage.read"), (req, res) => {
  const to = str(req.query.to) || new Date().toISOString().slice(0, 10);
  const from = str(req.query.from) || new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10);
  res.json({ live: usageSummary(req.params.org, "live", from, to), test: usageSummary(req.params.org, "test", from, to) });
});
developers.get("/orgs/:org/invoices", guard("billing.read"), (req, res) => res.json({ invoices: invoicesOf(req.params.org), plan: planOfOrg(req.params.org), plans: listPlans() }));
developers.get("/orgs/:org/audit", guard("org.read"), (req, res) => res.json({ events: auditOf(req.params.org, 200) }));
