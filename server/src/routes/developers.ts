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
import { createUser, verifyPassword, getUser, userByEmail, setPassword, createOrganization, getOrganization, updateOrganization, membershipsOf, membersOf, addMember, removeMember, can, createApplication, applicationsOf, archiveApplication, ROLES, type OrgRole, type Permission } from "../core/platform/orgs.js";
import { createCredential, listCredentials, getCredential, revokeCredential, rotateCredential, updateCredential, ALL_SCOPES, type Scope, type Environment } from "../core/platform/credentials.js";
import { issueDevToken, verifyDevToken } from "../core/platform/devAuth.js";
import { audit, auditOf } from "../core/platform/audit.js";
import { listSubscriptions, eventsOf, replayEvent, subscribe, updateSubscription, removeSubscription, enqueueEvent, getSubscription } from "../core/interop/outbound.js";
import { EVENT_TYPES } from "../core/platform/mapping.js";
import { metasOf, metaOf } from "../core/platform/paymentMeta.js";
import { publicPayment } from "../core/platform/mapping.js";
import { settlementsOf, publicSettlement, orgBalance } from "../core/platform/settlements.js";
import { usageSummary } from "../core/platform/usage.js";
import { invoicesOf, planOfOrg } from "../core/platform/billing.js";
import { store } from "../db/store.js";
import { liveMoney, config } from "../config.js";
import { isOwnOrigin } from "../app.js";
import { issueActionToken, consumeActionToken, peekActionToken, bumpSessionVersion, isEmailVerified, markEmailVerified, submitRequest, requestsOf, KYB_FIELDS, type RequestKind } from "../core/platform/accounts.js";
import { sendEmail, emailConfigured, devLinksAllowed } from "../core/platform/email.js";
import { listPlans } from "../core/platform/billing.js";

export const developers = Router();
type DevReq = Request & { dev: { uid: string } };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const bad = (res: Response, status: number, error: string, message: string) => res.status(status).json({ error, message });
const tokenOf = (req: Request) => { const a = req.headers.authorization; const s = Array.isArray(a) ? a[0] : a; return s?.startsWith("Bearer ") ? s.slice(7).trim() : undefined; };

/* ---------- accounts ---------- */
developers.post("/signup", rateLimitDurableMiddleware("dev_signup", 10, 3_600_000), async (req, res) => {
  if (process.env.DEVELOPER_SIGNUP === "off") return bad(res, 403, "signup_closed", "Developer sign-up is by invitation right now. Write to developers@momome.xyz.");
  const b = req.body ?? {};
  const r = createUser({ email: str(b.email), name: str(b.name), password: str(b.password) });
  if (!r.ok) return bad(res, 400, r.error, r.error === "email_taken" ? "An account with this email already exists." : r.error === "password_too_short" ? "Use at least 10 characters." : "Enter a valid email address.");
  const org = createOrganization({ name: str(b.organization) || `${r.user.name}'s organization`, country: str(b.country) || "CM", ownerUserId: r.user.id });
  // The plan the developer wants. Everyone STARTS on developer (sandbox-ready at once); business
  // and enterprise are recorded as an open request the operator sees in the activation queue.
  const wanted = str(b.plan); let planRequest: unknown = null;
  if (wanted === "business" || wanted === "enterprise") { const q = submitRequest(org.id, r.user.id, "plan_change", { plan: wanted, note: str(b.note).slice(0, 500), expected_monthly_volume_xaf: str(b.expected_monthly_volume_xaf) }); planRequest = q.ok ? q.request : null; }
  audit({ orgId: org.id, actor: { type: "user", id: r.user.id, label: r.user.email }, action: "developer.signed_up", details: { plan: wanted || "developer" }, ip: clientIp(req) });
  const verify = await sendVerification(r.user.id, r.user.email, req);
  const t = issueDevToken(r.user.id);
  res.status(201).json({ user: r.user, organization: org, plan_request: planRequest, email_verification: verify, ...t });
});
/** Where action links point. DASHBOARD_URL wins; else the requesting page's own origin — only
 *  when it is one of OUR app origins (a spoofed Origin must never steer an emailed link). */
const dashboardUrl = (req?: Request) => {
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL.replace(/\/$/, "");
  const origin = req ? str(req.headers.origin) : "";
  return isOwnOrigin(origin) ? `${origin}/developers/dashboard` : "https://momome.xyz/developers/dashboard";
};
async function sendVerification(userId: string, email: string, req?: Request) {
  const token = issueActionToken("verify_email", userId);
  const link = `${dashboardUrl(req)}?verify=${token}`;
  const rec = await sendEmail("verify_email", email, "Verify your MoMo›Me developer email", `Welcome to MoMo›Me Developers.\n\nConfirm your email address by opening this link (valid 24 hours):\n${link}\n\nIf you did not sign up, ignore this message.`);
  return { sent: rec.status === "sent", ...(devLinksAllowed() && !emailConfigured() ? { dev_link: link } : {}) };
}
/* ---------- email verification, password reset, invitations (no session needed) ---------- */
developers.post("/verify-email", rateLimitDurableMiddleware("dev_verify", 30, 3_600_000), (req, res) => {
  const t = consumeActionToken("verify_email", str((req.body ?? {}).token));
  if (!t) return bad(res, 400, "token_invalid", "This verification link is invalid or has expired. Request a new one from the dashboard.");
  markEmailVerified(t.userId);
  audit({ actor: { type: "user", id: t.userId }, action: "developer.email_verified", ip: clientIp(req) });
  res.json({ ok: true });
});
developers.post("/forgot-password", rateLimitDurableMiddleware("dev_forgot", 10, 3_600_000), async (req, res) => {
  const u = userByEmail(str((req.body ?? {}).email));
  // Always 200 — the response never says whether the address exists.
  let dev_link: string | undefined;
  if (u) {
    const token = issueActionToken("reset_password", u.id);
    const link = `${dashboardUrl(req)}?reset=${token}`;
    const rec = await sendEmail("reset_password", u.email, "Reset your MoMo›Me developer password", `Someone asked to reset the password for ${u.email}.\n\nOpen this link within 1 hour to choose a new one:\n${link}\n\nIf that was not you, ignore this message — nothing changes.`);
    if (devLinksAllowed() && !emailConfigured()) dev_link = link;
    audit({ actor: { type: "user", id: u.id, label: u.email }, action: "developer.password_reset_requested", ip: clientIp(req), details: { emailed: rec.status } });
  }
  res.json({ ok: true, message: "If that address has an account, a reset link is on its way.", ...(dev_link ? { dev_link } : {}) });
});
developers.post("/reset-password", rateLimitDurableMiddleware("dev_reset", 20, 3_600_000), (req, res) => {
  const b = req.body ?? {};
  const t = consumeActionToken("reset_password", str(b.token));
  if (!t) return bad(res, 400, "token_invalid", "This reset link is invalid or has expired. Request a new one.");
  if (!setPassword(t.userId, str(b.password))) return bad(res, 400, "password_too_short", "Use at least 10 characters.");
  bumpSessionVersion(t.userId); // every existing session ends
  markEmailVerified(t.userId);  // a reset link proves control of the mailbox
  audit({ actor: { type: "user", id: t.userId }, action: "developer.password_reset", ip: clientIp(req) });
  const tk = issueDevToken(t.userId);
  res.json({ ok: true, ...tk });
});
developers.get("/invitation/:token", (req, res) => {
  const t = peekActionToken("invitation", req.params.token);
  if (!t) return bad(res, 404, "token_invalid", "This invitation is invalid or has expired.");
  const u = getUser(t.userId); const org = t.orgId ? getOrganization(t.orgId) : undefined;
  res.json({ email: u?.email, name: u?.name, organization: org?.name, needs_password: !u?.lastLoginAt });
});
developers.post("/invitation/:token/accept", rateLimitDurableMiddleware("dev_invite_accept", 20, 3_600_000), (req, res) => {
  const t = consumeActionToken("invitation", req.params.token);
  if (!t) return bad(res, 400, "token_invalid", "This invitation is invalid or has expired.");
  const pw = str((req.body ?? {}).password);
  if (pw && !setPassword(t.userId, pw)) return bad(res, 400, "password_too_short", "Use at least 10 characters.");
  markEmailVerified(t.userId);
  audit({ orgId: t.orgId, actor: { type: "user", id: t.userId }, action: "member.invitation_accepted", ip: clientIp(req) });
  res.json({ ok: true, ...issueDevToken(t.userId) });
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
  res.json({ user: { ...getUser(uid)!, emailVerified: isEmailVerified(uid) }, organizations: membershipsOf(uid).map((m) => ({ ...getOrganization(m.orgId)!, role: m.role })), environment: liveMoney() ? "live" : "test", api_base: `${config.publicUrl}/v1`, sandbox_base: process.env.SANDBOX_API_URL ?? null, plans: listPlans().map((p) => ({ id: p.id, name: p.name, description: p.description, platformFeePct: p.platformFeePct, rateLimitRpm: p.rateLimitRpm, tiers: p.tiers })) });
});
developers.post("/logout", (req, res) => { const uid = (req as DevReq).dev.uid; if ((req.body ?? {}).everywhere) bumpSessionVersion(uid); res.json({ ok: true }); });
developers.post("/password", (req, res) => {
  const uid = (req as DevReq).dev.uid; const b = req.body ?? {}; const u = getUser(uid)!;
  if (!verifyPassword(u.email, str(b.current))) return bad(res, 401, "invalid_credentials", "Current password is incorrect.");
  if (!setPassword(uid, str(b.password))) return bad(res, 400, "password_too_short", "Use at least 10 characters.");
  bumpSessionVersion(uid);
  audit({ actor: { type: "user", id: uid, label: u.email }, action: "developer.password_changed", ip: clientIp(req) });
  res.json({ ok: true, ...issueDevToken(uid) });
});
developers.post("/resend-verification", rateLimitDurableMiddleware("dev_resend", 5, 3_600_000), async (req, res) => {
  const uid = (req as DevReq).dev.uid; const u = getUser(uid)!;
  if (isEmailVerified(uid)) return res.json({ ok: true, already: true });
  res.json({ ok: true, ...(await sendVerification(uid, u.email, req)) });
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
developers.post("/orgs/:org/members", guard("members.manage"), async (req, res) => {
  const b = req.body ?? {}; const role = str(b.role) as OrgRole;
  if (!ROLES.includes(role)) return bad(res, 400, "bad_request", `Role must be one of ${ROLES.join(", ")}.`);
  let u = userByEmail(str(b.email));
  if (!u) { const r = createUser({ email: str(b.email), name: str(b.name) || str(b.email) }); if (!r.ok) return bad(res, 400, r.error, "Enter a valid email address."); u = r.user; }
  const m = addMember(req.params.org, u.id, role);
  audit({ orgId: req.params.org, actor: actor(req), action: "member.added", target: { type: "user", id: u.id }, details: { role }, ip: clientIp(req) });
  const org = getOrganization(req.params.org)!; const inviter = getUser((req as DevReq).dev.uid);
  const token = issueActionToken("invitation", u.id, { orgId: org.id, role });
  const link = `${dashboardUrl(req)}?invite=${token}`;
  const rec = await sendEmail("invitation", u.email, `${inviter?.name ?? "A teammate"} invited you to ${org.name} on MoMo›Me`, `${inviter?.name ?? "A teammate"} (${inviter?.email ?? ""}) added you to ${org.name} as ${role}.\n\nOpen this link within 7 days to set your password and sign in:\n${link}`);
  res.status(201).json({ member: m, user: u, invitation: { sent: rec.status === "sent", ...(devLinksAllowed() && !emailConfigured() ? { dev_link: link } : {}) } });
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
/* Endpoint management from the dashboard (§29: create, edit, test, replay, inspect). */
developers.post("/orgs/:org/webhooks", guard("webhooks.manage"), (req, res) => {
  const b = req.body ?? {}; const url = str(b.url);
  const events = Array.isArray(b.events) && b.events.length ? (b.events as unknown[]).map(str).filter((e) => e === "*" || (EVENT_TYPES as readonly string[]).includes(e)) : ["*"];
  if (!url) return bad(res, 400, "bad_request", "url is required.");
  if (!events.length) return bad(res, 400, "bad_request", "Pick at least one known event type.");
  const r = subscribe(`org:${req.params.org}`, url, events, !liveMoney());
  if (!r.ok) return bad(res, 400, "webhook_url_invalid", r.reason);
  if (str(b.description)) updateSubscription(`org:${req.params.org}`, r.sub.id, { description: str(b.description) });
  audit({ orgId: req.params.org, actor: actor(req), action: "webhook.created", target: { type: "webhook_endpoint", id: r.sub.id }, details: { url }, ip: clientIp(req) });
  res.status(201).json({ endpoint: getSubscription(`org:${req.params.org}`, r.sub.id), secret: r.secret, events: EVENT_TYPES });
});
developers.patch("/orgs/:org/webhooks/:id", guard("webhooks.manage"), (req, res) => {
  const b = req.body ?? {};
  const r = updateSubscription(`org:${req.params.org}`, req.params.id, { url: str(b.url) || undefined, events: Array.isArray(b.events) && b.events.length ? (b.events as unknown[]).map(str) : undefined, enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, description: typeof b.description === "string" ? b.description : undefined }, !liveMoney());
  if (!r.ok) return bad(res, r.reason === "not found" ? 404 : 400, "bad_request", r.reason);
  audit({ orgId: req.params.org, actor: actor(req), action: "webhook.updated", target: { type: "webhook_endpoint", id: req.params.id }, ip: clientIp(req) });
  res.json(r.sub);
});
developers.delete("/orgs/:org/webhooks/:id", guard("webhooks.manage"), (req, res) => {
  if (!removeSubscription(`org:${req.params.org}`, req.params.id)) return bad(res, 404, "not_found", "No such endpoint.");
  audit({ orgId: req.params.org, actor: actor(req), action: "webhook.deleted", target: { type: "webhook_endpoint", id: req.params.id }, ip: clientIp(req) });
  res.json({ ok: true });
});
developers.post("/orgs/:org/webhooks/:id/test", guard("webhooks.manage"), (req, res) => {
  const owner = `org:${req.params.org}`; const s = getSubscription(owner, req.params.id);
  if (!s) return bad(res, 404, "not_found", "No such endpoint.");
  const data = { message: "MoMo›Me webhook test", endpoint_id: s.id, at: new Date().toISOString() };
  let ids = enqueueEvent(owner, "ping", data, { onlySub: s.id });
  if (!ids.length) { updateSubscription(owner, s.id, { events: [...new Set([...s.events, "ping"])] }); ids = enqueueEvent(owner, "ping", data, { onlySub: s.id }); updateSubscription(owner, s.id, { events: s.events }); }
  res.json({ ok: true, event_ids: ids });
});
developers.get("/orgs/:org/webhooks/events", guard("webhooks.read"), (_req, res) => res.json({ events: EVENT_TYPES }));
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

/* ---------- requests to the operator: KYB, plan change, live access ---------- */
developers.get("/orgs/:org/requests", guard("org.read"), (req, res) => res.json({ requests: requestsOf(req.params.org), kyb_fields: KYB_FIELDS }));
developers.post("/orgs/:org/requests", guard("org.update"), (req, res) => {
  const b = req.body ?? {}; const kind = str(b.kind) as RequestKind;
  if (!["kyb", "plan_change", "live_access"].includes(kind)) return bad(res, 400, "bad_request", "kind must be kyb, plan_change or live_access.");
  const payload: Record<string, unknown> = {};
  if (kind === "kyb") for (const k of KYB_FIELDS) if (b[k] !== undefined) payload[k] = str(b[k]).slice(0, 300);
  if (kind === "plan_change") { payload.plan = str(b.plan); payload.note = str(b.note).slice(0, 500); payload.expected_monthly_volume_xaf = str(b.expected_monthly_volume_xaf); }
  if (kind === "live_access") { payload.note = str(b.note).slice(0, 500); payload.go_live_date = str(b.go_live_date); }
  const r = submitRequest(req.params.org, (req as DevReq).dev.uid, kind, payload);
  if (!r.ok) return bad(res, r.error === "kyb_required" ? 409 : 400, r.error.split(":")[0], r.error === "kyb_required" ? "Submit your company details (KYB) first — live access follows verification." : r.error.startsWith("missing:") ? `Missing: ${r.error.slice(8).replace(/,/g, ", ")}.` : "Invalid request.");
  audit({ orgId: req.params.org, actor: actor(req), action: `request.${kind}.submitted`, target: { type: "request", id: r.request.id }, ip: clientIp(req) });
  res.status(201).json(r.request);
});

/* ---------- MoMo›Me Connect from the dashboard (docs/connect): identity, invoices, payouts, counterparties ---------- */
import { mpiForOrganization, getMpi, addAlias, updateProfiles, ownerMpi, normalizeAlias, type AliasType, type SettlementProfile, type PaymentMethodId } from "../core/connect/identities.js";
import { balanceOf, creditBalance } from "../core/connect/ledger.js";
import { invoicesOf as connectInvoicesOf, createInvoice, getInvoice, cancelInvoice, publicInvoice } from "../core/connect/invoices.js";
import { intentsOf, getIntent, cancelIntent, publicIntent } from "../core/connect/intents.js";
import { payoutsOf, createPayout, publicPayout, PayoutError } from "../core/connect/payouts.js";
import { counterpartiesOf, createCounterparty, publicCounterparty } from "../core/connect/counterparties.js";
import { fundingAvailable } from "../core/connect/routing.js";
const cenv = () => (liveMoney() ? "live" : "test") as "live" | "test";
developers.get("/orgs/:org/connect", guard("org.read"), (req, res) => {
  const m = mpiForOrganization(req.params.org); if (!m) return bad(res, 404, "not_found", "No identity.");
  res.json({ identity: ownerMpi(m), balance: { available: balanceOf(m.id), currency: "XAF" }, funding: fundingAvailable(), environment: cenv(), invoices: connectInvoicesOf(req.params.org, cenv(), 100).map(publicInvoice), intents: intentsOf(req.params.org, cenv(), 100).map(publicIntent), payouts: payoutsOf(req.params.org, cenv(), 100).map(publicPayout), counterparties: counterpartiesOf(req.params.org).map(publicCounterparty) });
});
developers.patch("/orgs/:org/connect/identity", guard("org.update"), (req, res) => {
  const m = mpiForOrganization(req.params.org); if (!m) return bad(res, 404, "not_found", "No identity.");
  const b = req.body ?? {}; const s = (b.settlement ?? {}) as Record<string, unknown>;
  const dest: NonNullable<SettlementProfile["destination"]> = {};
  if (s.destination && typeof s.destination === "object") { const d = s.destination as Record<string, unknown>; if (str(d.phone)) { const n = normalizeAlias("phone", str(d.phone), m.country); if (!n) return bad(res, 400, "bad_request", "That is not a valid Mobile Money number."); dest.phone = n; dest.country = m.country; } if (str(d.bank)) dest.bank = str(d.bank); if (str(d.account)) dest.account = str(d.account); if (str(d.lightning_address)) dest.lightning_address = str(d.lightning_address).toLowerCase(); }
  const preferred = str(s.preferred) as SettlementProfile["preferred"] | "";
  if (preferred === "stablecoin") return bad(res, 400, "bad_request", "Stablecoin settlement is not offered (pass-through model).");
  const out = updateProfiles(m.id, { displayName: str(b.display_name) || undefined, settlement: { ...(preferred ? { preferred } : {}), ...(Object.keys(dest).length ? { destination: dest } : {}), ...(typeof s.allowLightning === "boolean" ? { allowLightning: s.allowLightning } : {}) }, payment: Array.isArray(b.methods) ? { methods: (b.methods as unknown[]).map(str).filter((x): x is PaymentMethodId => ["momo_me", "mobile_money", "lightning", "stablecoin", "bank_transfer"].includes(x)) } : undefined });
  audit({ orgId: req.params.org, actor: actor(req), action: "identity.updated", target: { type: "identity", id: m.id }, ip: clientIp(req) });
  res.json(ownerMpi(out!));
});
developers.post("/orgs/:org/connect/identity/aliases", guard("org.update"), (req, res) => {
  const m = mpiForOrganization(req.params.org); if (!m) return bad(res, 404, "not_found", "No identity.");
  const type = str((req.body ?? {}).type) as AliasType;
  if (!["phone", "email", "merchant_code", "external_id"].includes(type)) return bad(res, 400, "bad_request", "type must be phone, email, merchant_code or external_id.");
  const r = addAlias(m.id, type, str((req.body ?? {}).value), false);
  if (!r.ok) return bad(res, r.error === "alias_taken" ? 409 : 400, r.error, r.error === "alias_taken" ? "That alias already belongs to another identity." : "Invalid alias.");
  audit({ orgId: req.params.org, actor: actor(req), action: "identity.alias_added", target: { type: "identity", id: m.id }, details: { type }, ip: clientIp(req) });
  res.json(ownerMpi(r.mpi));
});
developers.post("/orgs/:org/connect/invoices", guard("apps.manage"), (req, res) => {
  const m = mpiForOrganization(req.params.org); if (!m) return bad(res, 404, "not_found", "No identity.");
  const b = req.body ?? {}; const kind = (["invoice", "payment_link", "qr", "request_to_pay"].includes(str(b.kind)) ? str(b.kind) : "invoice") as "invoice" | "payment_link" | "qr" | "request_to_pay";
  const amount = Number(b.amount); if (!Number.isFinite(amount) || amount <= 0) return bad(res, 400, "bad_request", "Amount must be a positive number of XAF.");
  const payer = str(b.payer_phone) || str(b.payer_name) || str(b.payer_email) ? { phone: str(b.payer_phone) || undefined, name: str(b.payer_name) || undefined, email: str(b.payer_email) || undefined, counterparty: str(b.counterparty) || undefined } : undefined;
  if (kind === "request_to_pay" && !payer) return bad(res, 400, "bad_request", "A request-to-pay needs the payer's phone or a counterparty.");
  try {
    const inv = createInvoice({ orgId: req.params.org, env: cenv(), kind, payee: m, amountXaf: amount, description: str(b.description) || undefined, reference: str(b.reference) || undefined, dueDate: /^\d{4}-\d{2}-\d{2}$/.test(str(b.due_date)) ? str(b.due_date) : undefined, payer, acceptedMethods: Array.isArray(b.accepted_methods) ? (b.accepted_methods as unknown[]).map(str).filter((x): x is PaymentMethodId => ["lightning", "stablecoin", "mobile_money", "momo_me"].includes(x)) : undefined });
    audit({ orgId: req.params.org, actor: actor(req), action: "invoice.created", target: { type: "invoice", id: inv.id }, details: { kind, amount }, ip: clientIp(req) });
    res.status(201).json(publicInvoice(inv));
  } catch (e) { bad(res, 400, "bad_request", e instanceof Error ? e.message : "Could not create."); }
});
developers.post("/orgs/:org/connect/invoices/:id/cancel", guard("apps.manage"), (req, res) => {
  const inv = getInvoice(req.params.id); if (!inv || inv.orgId !== req.params.org) return bad(res, 404, "not_found", "No such invoice.");
  if (!cancelInvoice(inv)) return bad(res, 409, "bad_transition", `An invoice in ${inv.status} cannot be cancelled.`);
  const i = getIntent(inv.intentId); if (i) cancelIntent(i, "invoice cancelled from the dashboard");
  audit({ orgId: req.params.org, actor: actor(req), action: "invoice.cancelled", target: { type: "invoice", id: inv.id }, ip: clientIp(req) });
  res.json(publicInvoice(inv));
});
developers.post("/orgs/:org/connect/payouts", guard("settlements.write"), async (req, res) => {
  const m = mpiForOrganization(req.params.org); if (!m) return bad(res, 404, "not_found", "No identity.");
  const b = req.body ?? {};
  try {
    const p = await createPayout({ orgId: req.params.org, env: cenv(), payer: m, amountXaf: Number(b.amount), destination: { phone: str(b.phone) || undefined, lightning_address: str(b.lightning_address) || undefined, name: str(b.name) || undefined }, reference: str(b.reference) || undefined });
    audit({ orgId: req.params.org, actor: actor(req), action: "payout.created", target: { type: "payout", id: p.id }, details: { xaf: p.amount.value, status: p.status }, ip: clientIp(req) });
    res.status(201).json(publicPayout(p));
  } catch (e) { if (e instanceof PayoutError) return bad(res, e.status, e.code.toLowerCase(), e.message); bad(res, 500, "error", "Payout failed."); }
});
developers.post("/orgs/:org/connect/counterparties", guard("apps.manage"), (req, res) => {
  const b = req.body ?? {};
  const contacts = [["phone", str(b.phone)], ["email", str(b.email)], ["lightning_address", str(b.lightning_address)]].filter(([, v]) => v).map(([type, value]) => ({ type: type as AliasType, value }));
  const r = createCounterparty(req.params.org, { name: str(b.name), contacts });
  if (!r.ok) return bad(res, 400, "bad_request", r.error === "name_required" ? "Name is required." : `Invalid contact: ${r.error}.`);
  audit({ orgId: req.params.org, actor: actor(req), action: "counterparty.created", target: { type: "counterparty", id: r.counterparty.id }, ip: clientIp(req) });
  res.status(201).json(publicCounterparty(r.counterparty));
});
developers.get("/orgs/:org/connect/intents/:id", guard("payments.read"), (req, res) => { const i = getIntent(req.params.id); if (!i || i.orgId !== req.params.org) return bad(res, 404, "not_found", "No such intent."); res.json({ ...publicIntent(i), events: i.events, route_explanation: i.route?.explanation ?? [] }); });
developers.post("/orgs/:org/connect/sandbox-credit", guard("apps.manage"), (req, res) => {
  if (liveMoney()) return bad(res, 404, "not_found", "Sandbox only.");
  const m = mpiForOrganization(req.params.org); if (!m) return bad(res, 404, "not_found", "No identity.");
  const xaf = Math.min(10_000_000, Math.max(1, Math.round(Number((req.body ?? {}).amount) || 100_000)));
  creditBalance(`sandbox:${Date.now()}`, m.id, xaf);
  res.json({ available: balanceOf(m.id) });
});
