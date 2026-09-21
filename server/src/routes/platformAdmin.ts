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
import { listCredentials } from "../core/platform/credentials.js";
import { audit, auditOf, auditAll } from "../core/platform/audit.js";
import { usageSummary } from "../core/platform/usage.js";
import { listPlans, upsertPlan, getPlan, type PricingPlan, buildInvoice, issueInvoice, markInvoicePaid, invoicesOf } from "../core/platform/billing.js";
import { listLimitRules, upsertLimitRule, deleteLimitRule, type LimitRule } from "../core/platform/limits.js";
import { allSettlements, getSettlement, approveSettlement, submitSettlement, completeSettlement, failSettlement, orgBalance, creditOrganization, publicSettlement } from "../core/platform/settlements.js";
import { treasuryView, reservationsOf } from "../core/platform/liquidity.js";
import { metasOf } from "../core/platform/paymentMeta.js";
import { clientIp } from "../core/ratelimit.js";

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
  const o = updateOrganization(req.params.id, { status: (["active", "suspended", "closed"] as OrgStatus[]).includes(b.status) ? b.status : undefined, suspendedReason: str(b.suspendedReason) || undefined, kyb: (["not_started", "pending", "verified", "rejected"] as KybStatus[]).includes(b.kyb) ? b.kyb : undefined, plan: str(b.plan) && listPlans().some((p) => p.id === b.plan) ? b.plan : undefined, liveEnabled: typeof b.liveEnabled === "boolean" ? b.liveEnabled : undefined });
  if (!o) return res.status(404).json({ error: "not_found", message: "No such organization." });
  audit({ orgId: o.id, actor: who(req), action: "organization.operator_updated", details: b, ip: clientIp(req) });
  res.json(o);
});
platformAdmin.post("/organizations/:id/credit", (req, res) => {
  const o = getOrganization(req.params.id); if (!o) return res.status(404).json({ error: "not_found", message: "No such organization." });
  const xaf = Number((req.body ?? {}).xaf); const from = str((req.body ?? {}).from) === "payout_float_XAF" ? "payout_float_XAF" : "momo_collect_clearing";
  if (!Number.isFinite(xaf) || xaf <= 0) return res.status(400).json({ error: "bad_request", message: "xaf must be positive." });
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

platformAdmin.get("/plans", (_req, res) => res.json({ plans: listPlans() }));
platformAdmin.put("/plans/:id", (req, res) => {
  const b = (req.body ?? {}) as Partial<PricingPlan>;
  const cur = listPlans().find((p) => p.id === req.params.id);
  const p = upsertPlan({ id: req.params.id, name: str(b.name) || cur?.name || req.params.id, rateLimitRpm: Number(b.rateLimitRpm ?? cur?.rateLimitRpm ?? 60), paymentEndpointRpm: Number(b.paymentEndpointRpm ?? cur?.paymentEndpointRpm ?? 15), platformFeePct: Number(b.platformFeePct ?? cur?.platformFeePct ?? 1.5), minFeeXaf: Number(b.minFeeXaf ?? cur?.minFeeXaf ?? 100), tiers: Array.isArray(b.tiers) ? b.tiers : cur?.tiers ?? [], fixedMonthlyXaf: Number(b.fixedMonthlyXaf ?? cur?.fixedMonthlyXaf ?? 0), ...(b.negotiatedFeePct !== undefined ? { negotiatedFeePct: Number(b.negotiatedFeePct) } : cur?.negotiatedFeePct !== undefined ? { negotiatedFeePct: cur.negotiatedFeePct } : {}), description: str(b.description) || cur?.description, custom: b.custom ?? cur?.custom });
  audit({ actor: who(req), action: "plan.updated", target: { type: "plan", id: p.id }, ip: clientIp(req) });
  res.json(p);
});
platformAdmin.get("/limits", (_req, res) => res.json({ rules: listLimitRules() }));
platformAdmin.put("/limits", (req, res) => {
  const b = (req.body ?? {}) as Partial<LimitRule>;
  if (!str(b.name)) return res.status(400).json({ error: "bad_request", message: "name is required." });
  const r = upsertLimitRule({ id: str(b.id) || undefined, name: str(b.name), enabled: b.enabled !== false, priority: Number(b.priority ?? 50), scope: b.scope ?? {}, ceilings: b.ceilings ?? {} });
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
