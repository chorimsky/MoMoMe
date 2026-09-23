/* ============================================================
   /api/admin/platform — operator side of API v1 (mounted inside the admin gate in api.ts,
   so the session/role/step-up checks there apply; section "platform").

     GET    /organizations                  list + usage + credentials count
     GET    /organizations/:id              detail: members, apps, credentials, usage, audit, balance
     PATCH  /organizations/:id              { status, suspendedReason, kyb, plan, liveEnabled }
     POST   /organizations/:id/credit       { xaf, from, reference }  — credit an org balance (Super-Admin, elevated)
     GET    /plans · PUT /plans/:id
     GET    /limits · PUT /limits · DELETE /limits/:id
     GET    /settlements · POST /settlements/:id/{approve,submit,complete,fail}
     GET    /treasury                       reserved / pending / available XAF
     GET    /usage                          platform-wide usage by org (period)
     GET    /audit
     POST   /users/:id/password             set a developer's password (support)
   ============================================================ */
import { Router, type Request } from "express";
import { listOrganizations, getOrganization, updateOrganization, membersOf, applicationsOf, getUser, setPassword, type OrgStatus, type KybStatus } from "../core/platform/orgs.js";
import { listCredentials, getCredential, revokeCredential } from "../core/platform/credentials.js";
import { audit, auditOf, auditAll } from "../core/platform/audit.js";
import { usageSummary } from "../core/platform/usage.js";
import { listPlans, upsertPlan, getPlan, type PricingPlan, buildInvoice, issueInvoice, markInvoicePaid, invoicesOf } from "../core/platform/billing.js";
import { listLimitRules, upsertLimitRule, deleteLimitRule, type LimitRule } from "../core/platform/limits.js";
import { allSettlements, getSettlement, approveSettlement, submitSettlement, completeSettlement, failSettlement, orgBalance, creditOrganization, publicSettlement } from "../core/platform/settlements.js";
import { treasuryView, reservationsOf } from "../core/platform/liquidity.js";
import { metasOf } from "../core/platform/paymentMeta.js";
import { clientIp } from "../core/ratelimit.js";
import { openRequests, allRequests, getRequest, decideRequest } from "../core/platform/accounts.js";
import { emailOutbox, sendEmail, emailConfigured } from "../core/platform/email.js";

export const platformAdmin = Router();
type AdminReq = Request & { session?: { uid: string; role: string } };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const who = (req: Request) => ({ type: "operator" as const, id: (req as AdminReq).session?.uid ?? "console" });
const month = () => new Date().toISOString().slice(0, 7);

platformAdmin.get("/organizations", (_req, res) => {
  const from = `${month()}-01`, to = `${month()}-31`;
  res.json({ organizations: listOrganizations().map((o) => ({ ...o, members: membersOf(o.id).length, credentials: listCredentials(o.id).filter((c) => c.status === "active").length, live: usageSummary(o.id, "live", from, to).summary, test: usageSummary(o.id, "test", from, to).summary, balance: orgBalance(o.id) })) });
});
platformAdmin.get("/organizations/:id", (req, res) => {
  const o = getOrganization(req.params.id); if (!o) return res.status(404).json({ error: "not_found", message: "No such organization." });
  const from = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10), to = new Date().toISOString().slice(0, 10);
  res.json({ organization: o, plan: getPlan(o.plan), members: membersOf(o.id), applications: applicationsOf(o.id), credentials: listCredentials(o.id), usage: { live: usageSummary(o.id, "live", from, to), test: usageSummary(o.id, "test", from, to) }, balance: orgBalance(o.id), payments: { live: metasOf(o.id, "live").length, test: metasOf(o.id, "test").length }, reservations: reservationsOf(o.id).filter((r) => r.state === "RESERVED"), invoices: invoicesOf(o.id), audit: auditOf(o.id, 100) });
});
platformAdmin.patch("/organizations/:id", (req, res) => {
  const b = req.body ?? {};
  const before = getOrganization(req.params.id);
  if (!before) return res.status(404).json({ error: "not_found", message: "No such organization." });
  // "Live is enabled here once KYB is verified" is what this screen tells the operator, but
  // nothing enforced it: live could be switched on for an organization whose KYB had never
  // been started, which is the one thing compliance asks us not to do. Enabling live now
  // requires a verified KYB — either already recorded, or set in this same request. Turning
  // live OFF is always allowed, and existing grants are untouched.
  if (b.liveEnabled === true && !before.liveEnabled) {
    const kybAfter = (["not_started", "pending", "verified", "rejected"] as KybStatus[]).includes(b.kyb) ? (b.kyb as KybStatus) : before.kyb;
    if (kybAfter !== "verified") {
      return res.status(409).json({ error: "kyb_required", message: "Live credentials need a verified KYB. Set KYB to verified first, or record the verification in the same change." });
    }
  }
  const o = updateOrganization(req.params.id, { status: (["active", "suspended", "closed"] as OrgStatus[]).includes(b.status) ? b.status : undefined, suspendedReason: str(b.suspendedReason) || undefined, kyb: (["not_started", "pending", "verified", "rejected"] as KybStatus[]).includes(b.kyb) ? b.kyb : undefined, plan: str(b.plan) && listPlans().some((p) => p.id === b.plan) ? b.plan : undefined, liveEnabled: typeof b.liveEnabled === "boolean" ? b.liveEnabled : undefined });
  if (!o) return res.status(404).json({ error: "not_found", message: "No such organization." });
  audit({ orgId: o.id, actor: who(req), action: "organization.operator_updated", details: b, ip: clientIp(req) });
  res.json(o);
});
platformAdmin.post("/organizations/:id/credit", (req, res) => {
  const o = getOrganization(req.params.id); if (!o) return res.status(404).json({ error: "not_found", message: "No such organization." });
  const xaf = Number((req.body ?? {}).xaf); const from = str((req.body ?? {}).from) === "payout_float_XAF" ? "payout_float_XAF" : "momo_collect_clearing";
  if (!Number.isFinite(xaf) || xaf <= 0) return res.status(400).json({ error: "bad_request", message: "xaf must be positive." });
  // A credit is a liability we then owe. There is no legitimate manual credit of this size,
  // and a mistyped figure is indistinguishable from a real one once it is booked.
  if (xaf > 100_000_000) return res.status(400).json({ error: "amount_too_large", message: "A single manual credit is capped at 100 000 000 XAF. Split it, or correct the amount." });
  creditOrganization(o.id, Math.round(xaf), from, str((req.body ?? {}).reference) || `manual:${Date.now()}`);
  audit({ orgId: o.id, actor: who(req), action: "organization.credited", details: { xaf, from }, ip: clientIp(req) });
  res.json({ ok: true, balance: orgBalance(o.id) });
});
platformAdmin.post("/users/:id/password", (req, res) => {
  const u = getUser(req.params.id); if (!u) return res.status(404).json({ error: "not_found", message: "No such user." });
  if (!setPassword(u.id, str((req.body ?? {}).password))) return res.status(400).json({ error: "bad_request", message: "Use at least 10 characters." });
  audit({ actor: who(req), action: "developer.password_set", target: { type: "user", id: u.id }, ip: clientIp(req) });
  res.json({ ok: true });
});

/* A leaked live key had no answer here: an operator could suspend the whole organization —
   stopping every integration the customer runs — or wait for them to notice. Revoking the
   one credential is the proportionate act, and the one a customer will ask for at 2am. */
platformAdmin.post("/credentials/:id/revoke", (req, res) => {
  const c = getCredential(req.params.id);
  if (!c) return res.status(404).json({ error: "not_found", message: "No such credential." });
  if (c.status !== "active") return res.status(409).json({ error: "bad_state", message: `This credential is already ${c.status}.` });
  if (!revokeCredential(c.id)) return res.status(409).json({ error: "bad_state", message: "Could not revoke it." });
  audit({ orgId: c.orgId, actor: who(req), action: "credential.revoked_by_operator", target: { type: "credential", id: c.id }, details: { env: c.env, label: c.label, reason: str((req.body ?? {}).reason) || undefined }, ip: clientIp(req) });
  res.json({ ok: true, credential: getCredential(c.id) });
});

platformAdmin.get("/plans", (_req, res) => res.json({ plans: listPlans() }));
platformAdmin.put("/plans/:id", (req, res) => {
  const b = (req.body ?? {}) as Partial<PricingPlan>;
  const cur = listPlans().find((p) => p.id === req.params.id);
  // Every number here prices or throttles EVERY customer on this plan. `Number("abc")` is
  // NaN, and a NaN fee propagates silently into quotes and invoices — so the shape is
  // checked before anything is written, not after someone notices a strange bill.
  const num = (v: unknown, lo: number, hi: number): number | null => { if (v === undefined) return null; const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : NaN; };
  const checks: Array<[string, number | null]> = [
    ["rateLimitRpm", num(b.rateLimitRpm, 1, 100_000)],
    ["paymentEndpointRpm", num(b.paymentEndpointRpm, 1, 100_000)],
    ["platformFeePct", num(b.platformFeePct, 0, 100)],
    ["minFeeXaf", num(b.minFeeXaf, 0, 1_000_000)],
    ["fixedMonthlyXaf", num(b.fixedMonthlyXaf, 0, 100_000_000)],
    ["negotiatedFeePct", num(b.negotiatedFeePct, 0, 100)],
  ];
  const bad = checks.find(([, v]) => Number.isNaN(v));
  if (bad) return res.status(400).json({ error: "bad_request", message: `${bad[0]} is out of range or not a number.` });
  if (b.tiers !== undefined && (!Array.isArray(b.tiers) || b.tiers.some((t) => !t || typeof t !== "object" || !Number.isFinite(Number((t as { upToXaf?: unknown }).upToXaf)) || !Number.isFinite(Number((t as { pct?: unknown }).pct))))) {
    return res.status(400).json({ error: "bad_request", message: "Each tier needs a numeric upToXaf and pct." });
  }
  const p = upsertPlan({ id: req.params.id, name: str(b.name) || cur?.name || req.params.id, rateLimitRpm: Number(b.rateLimitRpm ?? cur?.rateLimitRpm ?? 60), paymentEndpointRpm: Number(b.paymentEndpointRpm ?? cur?.paymentEndpointRpm ?? 15), platformFeePct: Number(b.platformFeePct ?? cur?.platformFeePct ?? 1.5), minFeeXaf: Number(b.minFeeXaf ?? cur?.minFeeXaf ?? 100), tiers: Array.isArray(b.tiers) ? b.tiers : cur?.tiers ?? [], fixedMonthlyXaf: Number(b.fixedMonthlyXaf ?? cur?.fixedMonthlyXaf ?? 0), ...(b.negotiatedFeePct !== undefined ? { negotiatedFeePct: Number(b.negotiatedFeePct) } : cur?.negotiatedFeePct !== undefined ? { negotiatedFeePct: cur.negotiatedFeePct } : {}), description: str(b.description) || cur?.description, custom: b.custom ?? cur?.custom });
  audit({ actor: who(req), action: "plan.updated", target: { type: "plan", id: p.id }, ip: clientIp(req) });
  res.json(p);
});
platformAdmin.get("/limits", (_req, res) => res.json({ rules: listLimitRules() }));
platformAdmin.put("/limits", (req, res) => {
  const b = (req.body ?? {}) as Partial<LimitRule>;
  if (!str(b.name)) return res.status(400).json({ error: "bad_request", message: "name is required." });
  // A ceiling that is not a number silently stops limiting anything. Both objects are
  // shape-checked here, where a bad rule can still be refused.
  const okObj = (v: unknown) => v === undefined || (typeof v === "object" && v !== null && !Array.isArray(v));
  if (!okObj(b.scope) || !okObj(b.ceilings)) return res.status(400).json({ error: "bad_request", message: "scope and ceilings must be objects." });
  if (b.ceilings && Object.values(b.ceilings as Record<string, unknown>).some((v) => v !== undefined && !(Number.isFinite(Number(v)) && Number(v) >= 0))) {
    return res.status(400).json({ error: "bad_request", message: "Every ceiling must be a non-negative number." });
  }
  const prio = Number(b.priority ?? 50);
  if (!Number.isFinite(prio) || prio < 0 || prio > 1000) return res.status(400).json({ error: "bad_request", message: "priority must be between 0 and 1000." });
  const r = upsertLimitRule({ id: str(b.id) || undefined, name: str(b.name), enabled: b.enabled !== false, priority: prio, scope: b.scope ?? {}, ceilings: b.ceilings ?? {} });
  audit({ actor: who(req), action: "limit.updated", target: { type: "limit_rule", id: r.id }, ip: clientIp(req) });
  res.json(r);
});
platformAdmin.delete("/limits/:id", (req, res) => { const ok = deleteLimitRule(req.params.id); if (ok) audit({ actor: who(req), action: "limit.deleted", target: { type: "limit_rule", id: req.params.id }, ip: clientIp(req) }); res.status(ok ? 200 : 400).json({ ok }); });

platformAdmin.get("/settlements", (_req, res) => res.json({ settlements: allSettlements().map((s) => ({ ...publicSettlement(s), org_id: s.orgId, organization: getOrganization(s.orgId)?.name ?? s.orgId, approved_by: s.approvedBy ?? null })) }));
for (const action of ["approve", "submit", "complete", "fail"] as const) {
  platformAdmin.post(`/settlements/:id/${action}`, (req, res) => {
    const s = getSettlement(req.params.id); if (!s) return res.status(404).json({ error: "not_found", message: "No such settlement." });
    const by = (req as AdminReq).session?.uid ?? "console";
    const ok = action === "approve" ? approveSettlement(s, by) : action === "submit" ? submitSettlement(s, str((req.body ?? {}).providerRef) || "manual") : action === "complete" ? completeSettlement(s) : failSettlement(s, str((req.body ?? {}).reason) || "failed by operator");
    if (!ok) return res.status(409).json({ error: "bad_transition", message: `Cannot ${action} a settlement in ${s.status}.` });
    audit({ orgId: s.orgId, actor: who(req), action: `settlement.${action}d`, target: { type: "settlement", id: s.id }, ip: clientIp(req) });
    res.json(publicSettlement(s));
  });
}
platformAdmin.get("/treasury", async (_req, res) => res.json(await treasuryView()));
platformAdmin.get("/usage", (req, res) => {
  const period = str(req.query.period) || month();
  res.json({ period, organizations: listOrganizations().map((o) => ({ id: o.id, name: o.name, plan: o.plan, live: usageSummary(o.id, "live", `${period}-01`, `${period}-31`).summary, test: usageSummary(o.id, "test", `${period}-01`, `${period}-31`).summary })) });
});
platformAdmin.post("/organizations/:id/invoices/:period", (req, res) => {
  const o = getOrganization(req.params.id); if (!o) return res.status(404).json({ error: "not_found", message: "No such organization." });
  if (!/^\d{4}-\d{2}$/.test(req.params.period)) return res.status(400).json({ error: "bad_request", message: "period must be YYYY-MM." });
  const inv = buildInvoice(o.id, req.params.period);
  const act = str((req.body ?? {}).action);
  const out = act === "issue" ? issueInvoice(inv.id) : act === "paid" ? markInvoicePaid(inv.id) : inv;
  audit({ orgId: o.id, actor: who(req), action: `invoice.${act || "built"}`, target: { type: "invoice", id: inv.id }, ip: clientIp(req) });
  res.json(out);
});
platformAdmin.get("/audit", (_req, res) => res.json({ events: auditAll(300) }));

/* ---------- activation queue: KYB, plan changes, live access ---------- */
/* Each row carries the state an operator needs to DECIDE it. Without this the queue said
   "Bitbank · Live access" and nothing else: whether that organization's KYB had been
   verified, what plan it was on, whether it had ever completed a sandbox payment — all of it
   lived one tab away, so the decision was either made blind or made after a detour. */
platformAdmin.get("/requests", (req, res) => res.json({
  requests: (str(req.query.all) === "1" ? allRequests() : openRequests()).map((r) => {
    const o = getOrganization(r.orgId);
    return {
      ...r,
      organization: o?.name ?? r.orgId,
      requester: getUser(r.byUserId)?.email ?? r.byUserId,
      context: o ? { kyb: o.kyb, plan: o.plan, liveEnabled: o.liveEnabled, status: o.status, country: o.country, credentials: listCredentials(o.id).filter((c) => c.status === "active").length } : null,
      /* live access cannot be granted until KYB is verified — the console disables Approve
         and says so, rather than letting the click fail at the server. */
      blocked: r.kind === "live_access" && o?.kyb !== "verified" ? "kyb_not_verified" : null,
    };
  }),
  email_configured: emailConfigured(),
}));
platformAdmin.post("/requests/:id/:decision", async (req, res) => {
  const d = req.params.decision; if (d !== "approve" && d !== "reject") return res.status(400).json({ error: "bad_request", message: "approve or reject." });
  const r0 = getRequest(req.params.id); if (!r0) return res.status(404).json({ error: "not_found", message: "No such request." });
  const out = decideRequest(r0.id, d === "approve" ? "approved" : "rejected", (req as AdminReq).session?.uid ?? "console", str((req.body ?? {}).note) || undefined);
  if (!out.ok) {
    if (out.error === "kyb_required") return res.status(409).json({ error: "kyb_required", message: "Live access needs a verified KYB. Decide the company-verification request first — approving live access does not verify a company." });
    return res.status(409).json({ error: "already_decided", message: "This request was already decided." });
  }
  const r = out.request;
  audit({ orgId: r.orgId, actor: who(req), action: `request.${r.kind}.${r.status}`, target: { type: "request", id: r.id }, details: { note: r.decisionNote }, ip: clientIp(req) });
  const requester = getUser(r.byUserId); const org = getOrganization(r.orgId);
  if (requester) {
    const what = r.kind === "kyb" ? "company verification (KYB)" : r.kind === "plan_change" ? `plan change to ${String(r.payload.plan)}` : "live access";
    await sendEmail(`request_${r.status}`, requester.email, `MoMo›Me: your ${what} was ${r.status}`, `Hello ${requester.name},\n\nYour ${what} request for ${org?.name ?? r.orgId} was ${r.status}.${r.decisionNote ? `\n\nNote from MoMo›Me: ${r.decisionNote}` : ""}\n\n${r.status === "approved" && r.kind === "live_access" ? "You can now create mm_live_ credentials from the dashboard." : ""}\n— MoMo›Me Developers`);
  }
  res.json(r);
});
platformAdmin.get("/emails", (_req, res) => res.json({ configured: emailConfigured(), outbox: emailOutbox(100) }));

/* ---------- MoMo›Me Connect: treasury over identity balances, settlement queue (bank), network metrics ---------- */
import { networkMetrics, connectTreasury } from "../core/connect/metrics.js";
import { allSettlementIntents, getSettlementIntent, operatorSubmit, operatorSettle, operatorFail, operatorExecuteNow, retrySettlement, publicSettlementIntent } from "../core/connect/settlements.js";
import { getMpi } from "../core/connect/identities.js";
platformAdmin.get("/connect/metrics", (req, res) => res.json(networkMetrics(Math.max(1, Number(req.query.days ?? 30)) * 86_400_000)));
platformAdmin.get("/connect/treasury", async (_req, res) => res.json(await connectTreasury()));
platformAdmin.get("/connect/settlements", (req, res) => { const all = str(req.query.all) === "1"; res.json({ settlements: allSettlementIntents(500).filter((s) => all || ["pending", "processing", "submitted"].includes(s.status)).map((s) => ({ ...publicSettlementIntent(s), payee_name: getMpi(s.payee)?.displayName ?? s.payee, org_id: s.orgId, organization: getOrganization(s.orgId)?.name ?? s.orgId, operator: s.operator ?? null, events: s.events })) }); });
platformAdmin.post("/connect/settlements/:id/:action", async (req, res) => {
  const s = getSettlementIntent(req.params.id); if (!s) return res.status(404).json({ error: "not_found", message: "No such settlement intent." });
  const by = (req as AdminReq).session?.uid ?? "console"; const a = req.params.action; const b = req.body ?? {};
  let ok = false;
  if (a === "submit") { if (!str(b.reference)) return res.status(400).json({ error: "bad_request", message: "The bank transfer reference is required." }); ok = operatorSubmit(s, by, str(b.reference)); }
  else if (a === "settle") ok = operatorSettle(s, by);
  else if (a === "fail") ok = operatorFail(s, by, str(b.reason) || "failed by operator");
  else if (a === "execute") ok = await operatorExecuteNow(s);
  else if (a === "retry") ok = retrySettlement(s);
  else return res.status(400).json({ error: "bad_request", message: "action must be submit, settle, fail, execute or retry." });
  if (!ok) return res.status(409).json({ error: "bad_transition", message: `Cannot ${a} a ${s.method} settlement in ${s.status}.` });
  audit({ orgId: s.orgId, actor: who(req), action: `settlement_intent.${a}`, target: { type: "settlement_intent", id: s.id }, details: { reference: str(b.reference) || undefined }, ip: clientIp(req) });
  res.json(publicSettlementIntent(s));
});
