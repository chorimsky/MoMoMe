/* ============================================================
   Capital Intelligence + Investor OS — its OWN API namespace, /api/capital/*,
   separate from the operator console's /api/admin/*. The only thing shared is
   the session token (the API link between the two surfaces): `capitalGuard`
   verifies it, maps each prefix to a capital SECTION (shared/roles.ts, the same
   module the console enforces with), applies read-only and step-up, and fails
   closed on anything unmapped. Route handlers then add the action-level role
   gates the UI uses to show/hide the same actions.
   Nothing here moves customer money: it reads the settlement books and writes
   the capital/investor records.
   ============================================================ */
import { Router, type Request, type Response, type NextFunction } from "express";
import { verifyToken, tokenFromHeaders, isElevated, type Session } from "../core/adminAuth.js";
import { getUser } from "../core/adminUsers.js";
import { canAccess, isReadOnly, canApproveKyc, canVerifyFunding, canAllocateCapital, canAdjustLedger, canApproveRecommendation, canEditInvestors, canLegalReview, isInvestor, isSuperAdmin, type AdminRole, type Section } from "../../../shared/roles.js";
import type { IntelFilters, Period, CapitalType, ReportKind, ScenarioName } from "../../../shared/capital.js";
import { PERIODS, CAPITAL_TYPES, REPORT_KINDS } from "../../../shared/capital.js";
import * as engine from "../core/capital/engine.js";
import * as inv from "../core/capital/investors.js";
import * as wf from "../core/capital/workflow.js";
import * as copilot from "../core/capital/copilot.js";
import * as reports from "../core/capital/reports.js";
import { store } from "../db/store.js";
import type { SearchHit, SearchKind } from "../../../shared/capital.js";

export const capital = Router();

/** prefix → capital section. Unmapped → denied (fail closed). */
const SECTION_OF: Record<string, Section> = { intelligence: "intelligence", investors: "investors", investments: "investors", documents: "investors", capital: "capital", copilot: "copilot", portal: "portal" };
/** Money-shaped mutations that need a fresh password (same step-up as the console). */
const ELEVATED_ONLY: RegExp[] = [/^\/capital\/(allocations\/[^/]+\/execute|adjustments\/[^/]+\/decide)$/];
export function capitalGuard(req: Request, res: Response, next: NextFunction): void {
  const session = verifyToken(tokenFromHeaders(req.headers));
  const user = session ? getUser(session.uid) : undefined;
  if (!session || !user) { res.status(401).json({ error: "unauthorized", message: "Sign in to the capital platform." }); return; }
  const role = user.role;
  (req as unknown as { session: Session }).session = { uid: user.id, role };
  const sub = req.path; // the "/capital" mount prefix is already stripped
  const prefix = sub.replace(/^\//, "").split("/")[0] ?? "";
  // Notifications are cross-cutting: any role with at least one capital section reads its own bell.
  const anyCapital = (["intelligence", "investors", "capital", "copilot"] as Section[]).some((x) => canAccess(role, x));
  const crossCutting = prefix === "notifications" || prefix === "search";
  const section = crossCutting ? (anyCapital ? ("investors" as Section) : undefined) : SECTION_OF[prefix];
  if (!section || (!crossCutting && !canAccess(role, section))) { res.status(403).json({ error: "forbidden", message: "Your role can't access this section." }); return; }
  if (isReadOnly(role) && req.method !== "GET") { res.status(403).json({ error: "forbidden", message: "Read-only access." }); return; }
  if (req.method !== "GET" && ELEVATED_ONLY.some((re) => re.test(sub)) && !isElevated({ uid: user.id, role, elevatedUntil: session.elevatedUntil })) { res.status(403).json({ error: "elevation_required", message: "Re-enter your password to confirm this action." }); return; }
  next();
}

const sessionOf = (req: Request): Session => (req as unknown as { session: Session }).session;
const who = (req: Request): { name: string; role: AdminRole; uid: string } => { const s = sessionOf(req); const u = getUser(s.uid); return { name: u?.username ?? "operator", role: u?.role ?? s.role, uid: s.uid }; };
const deny = (res: Response, message: string) => res.status(403).json({ error: "forbidden", message });
const send = <T>(res: Response, r: inv.Result<T>, status = 200) => (r.ok ? res.status(status).json(r.value) : res.status(r.status).json({ error: r.error, message: r.message }));
const body = (req: Request): Record<string, unknown> => (req.body && typeof req.body === "object" ? (req.body as Record<string, unknown>) : {});
const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");
function filters(req: Request): IntelFilters {
  const q = req.query as Record<string, string | undefined>;
  return { period: PERIODS.includes(q.period as Period) ? (q.period as Period) : "30d", country: (q.country as IntelFilters["country"]) || "ALL", rail: (q.rail as IntelFilters["rail"]) || "ALL", provider: (q.provider as IntelFilters["provider"]) || "ALL", scenario: (q.scenario as ScenarioName) || "BASE" };
}
const capType = (v: unknown): CapitalType | null => (CAPITAL_TYPES.includes(v as CapitalType) ? (v as CapitalType) : null);
/** Express 4 drops async rejections — wrap so an engine error is a 500 JSON, never a hang. */
const wrap = (fn: (req: Request, res: Response) => Promise<unknown>) => (req: Request, res: Response) => { fn(req, res).catch((e) => { console.error("[capital]", e); if (!res.headersSent) res.status(500).json({ error: "engine_error", message: e instanceof Error ? e.message : "Engine error." }); }); };

/* ---------- intelligence (read) ---------- */
capital.get("/intelligence/overview", wrap(async (req, res) => res.json(await engine.overview(filters(req)))));
capital.get("/intelligence/health", wrap(async (req, res) => res.json(await engine.health(filters(req)))));
capital.get("/intelligence/liquidity", wrap(async (req, res) => res.json(await engine.liquidity(filters(req)))));
capital.post("/intelligence/liquidity/stress", wrap(async (req, res) => { const b = body(req); res.json(await engine.stress((b.inputs as Record<string, number>) ?? {}, (["NORMAL", "ELEVATED", "STRESS", "SEVERE"].includes(String(b.preset)) ? String(b.preset) : "CUSTOM") as never, filters(req))); }));
capital.get("/intelligence/transactions", wrap(async (req, res) => res.json(await engine.transactions(filters(req)))));
capital.get("/intelligence/routes", wrap(async (req, res) => res.json(await engine.routes(filters(req)))));
capital.get("/intelligence/revenue", wrap(async (req, res) => res.json(await engine.revenue(filters(req)))));
capital.get("/intelligence/forecasts", wrap(async (req, res) => res.json(await engine.forecasts(filters(req)))));
capital.get("/intelligence/scenarios", wrap(async (req, res) => { const q = req.query as Record<string, string>; const custom = q.volumeMultiplier || q.marginBps || q.settlementDelayHours || q.failureRatePct ? { volumeMultiplier: Number(q.volumeMultiplier), marginBps: Number(q.marginBps), settlementDelayHours: Number(q.settlementDelayHours), failureRatePct: Number(q.failureRatePct) } : undefined; res.json(await engine.scenarios(filters(req), custom)); }));
capital.get("/intelligence/efficiency", wrap(async (req, res) => res.json(await engine.efficiency(filters(req)))));
capital.get("/intelligence/concentration", wrap(async (req, res) => res.json(await engine.concentration(filters(req)))));
capital.put("/intelligence/concentration/thresholds", wrap(async (req, res) => { const { role } = who(req); if (!canApproveRecommendation(role)) return deny(res, "Thresholds are set by finance or investment management."); res.json({ thresholds: wf.setThresholds(body(req) as never) }); }));
capital.get("/intelligence/risk", wrap(async (req, res) => res.json(await engine.risk(filters(req)))));
capital.get("/intelligence/insights", wrap(async (req, res) => res.json({ insights: await engine.insights(filters(req)) })));
capital.get("/intelligence/fundraising", wrap(async (_req, res) => res.json(await engine.fundraising())));
capital.get("/intelligence/matching/:requirementId", wrap(async (req, res) => { const m = await engine.matching(req.params.requirementId); if (!m) return res.status(404).json({ error: "not_found", message: "Requirement not found." }); res.json(m); }));

/* ---------- capital requirements ---------- */
capital.get("/intelligence/capital-requirements", wrap(async (req, res) => res.json({ requirements: await engine.requirements(filters(req)) })));
capital.get("/intelligence/capital-requirements/:id", wrap(async (req, res) => { await engine.requirements(); const r = wf.getRequirement(req.params.id); if (!r) return res.status(404).json({ error: "not_found", message: "Requirement not found." }); res.json(r); }));
capital.post("/intelligence/capital-requirements", wrap(async (req, res) => {
  const { name, role } = who(req); if (!canApproveRecommendation(role)) return deny(res, "Only finance or investment management can enter a requirement.");
  const b = body(req); const t = capType(b.capitalType); if (!t) return res.status(400).json({ error: "bad_type", message: "A capital type is required." });
  const amount = Number(b.amount), avail = Number(b.currentAvailable) || 0;
  send(res, wf.createManualRequirement({ capitalType: t, amount, ccy: (b.ccy as never) ?? "USD", purpose: str(b.purpose), geography: (str(b.geography, 10) as never) || "CEMAC", rail: (str(b.rail, 12) as never) || "ALL", currentAvailable: avail, fundingGap: Math.max(0, amount - avail), targetDate: str(b.targetDate, 20), urgency: (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(String(b.urgency)) ? String(b.urgency) : "MEDIUM") as never, scenario: (b.scenario as never) ?? "BASE" }, name), 201);
}));
capital.post("/intelligence/capital-requirements/:id/transition", wrap(async (req, res) => { const { name, role } = who(req); if (!canApproveRecommendation(role)) return deny(res, "Only finance or investment management can move a requirement."); const b = body(req); send(res, wf.transitionRequirement(req.params.id, str(b.to, 30) as never, str(b.note, 300), name)); }));

/* ---------- recommendations + approval workflow ---------- */
capital.get("/intelligence/recommendations", wrap(async (req, res) => res.json({ recommendations: await engine.scanRecommendations(filters(req)) })));
capital.get("/intelligence/recommendations/:id", wrap(async (req, res) => { const r = wf.getRecommendation(req.params.id); if (!r) return res.status(404).json({ error: "not_found", message: "Recommendation not found." }); res.json(r); }));
capital.post("/intelligence/recommendations/:id/transition", wrap(async (req, res) => {
  const { name, role } = who(req); const b = body(req); const to = str(b.to, 20) as never;
  // Anyone with the section may REVIEW or DISMISS; APPROVE / EXECUTE / COMPLETE need an approver role.
  if (["APPROVED", "EXECUTING", "COMPLETED"].includes(to) && !canApproveRecommendation(role)) return deny(res, "Approval is reserved to finance or investment management.");
  const r = wf.transitionRecommendation(req.params.id, to, name, str(b.note, 300), b.responsible === undefined ? undefined : str(b.responsible, 60));
  if (r.ok && b.answerId) copilot.recordAction(str(b.answerId, 40), to === "APPROVED" ? "approved" : to === "COMPLETED" ? "executed" : "requested", req.params.id);
  send(res, r);
}));

/* ---------- investors ---------- */
const editGate = (req: Request, res: Response): boolean => { const { role } = who(req); if (!canEditInvestors(role)) { deny(res, "Your role can view investors but not change them."); return false; } return true; };
capital.get("/investors", wrap(async (_req, res) => res.json({ investors: inv.listInvestors() })));
capital.post("/investors", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); send(res, inv.createInvestor(body(req) as never, name), 201); }));
capital.get("/investors/:id", wrap(async (req, res) => { const i = inv.getInvestor(req.params.id); if (!i) return res.status(404).json({ error: "not_found", message: "Investor not found." }); res.json({ investor: i, proposals: inv.proposalsFor(i.id), termSheets: inv.termSheetsFor(i.id), investments: inv.investmentsFor(i.id), funding: inv.fundingFor(i.id), documents: inv.documentsFor(i.id), messages: inv.messagesFor(i.id), ledger: inv.ledgerEntriesFor(i.id) }); }));
capital.patch("/investors/:id", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); send(res, inv.updateInvestor(req.params.id, body(req) as never, name)); }));
capital.post("/investors/:id/qualify", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); const b = body(req); send(res, inv.qualifyInvestor(req.params.id, str(b.status, 20) as never, b.score == null ? null : Number(b.score), str(b.note, 400), name)); }));
capital.post("/investors/:id/kyc/submit", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); const b = body(req); send(res, inv.submitKyc(req.params.id, Array.isArray(b.documents) ? (b.documents as never) : [], str(b.note, 300), name)); }));
capital.post("/investors/:id/kyc/review", wrap(async (req, res) => { const { name, role } = who(req); if (!canApproveKyc(role)) return deny(res, "KYC decisions are a Compliance Officer function."); const b = body(req); send(res, inv.reviewKyc(req.params.id, str(b.decision, 20) as never, str(b.note, 300), name)); }));
capital.post("/investors/:id/messages", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); send(res, inv.logMessage(req.params.id, body(req) as never, name), 201); }));
capital.post("/investors/:id/portal-link", wrap(async (req, res) => { const { name, role } = who(req); if (!isSuperAdmin(role)) return deny(res, "Linking a portal login is Super Admin only."); const uid = str(body(req).userId, 60) || null; if (uid) { const u = getUser(uid); if (!u || !isInvestor(u.role)) return res.status(400).json({ error: "bad_user", message: "The user must exist and have the Investor role." }); } send(res, inv.updateInvestor(req.params.id, { portalUserId: uid }, name)); }));

/* ---------- investments: opportunities → proposals → term sheets → investments → funding ---------- */
capital.get("/investments/communications", wrap(async (_req, res) => res.json({ messages: inv.listMessages() })));
capital.get("/investments", wrap(async (_req, res) => res.json({ investments: inv.listInvestments(), opportunities: inv.listOpportunities(), proposals: inv.listProposals(), termSheets: inv.listTermSheets(), funding: inv.listFunding() })));
capital.post("/investments/opportunities", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); send(res, inv.createOpportunity(body(req) as never, name), 201); }));
capital.post("/investments/opportunities/:id/status", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); send(res, inv.setOpportunityStatus(req.params.id, str(body(req).status, 20) as never, name)); }));
capital.post("/investments/proposals", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); const b = body(req); send(res, inv.createProposal({ investorId: str(b.investorId, 40), opportunityId: str(b.opportunityId, 40), amount: Number(b.amount), terms: (b.terms as never) ?? {} }, name), 201); }));
capital.post("/investments/proposals/:id/status", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); send(res, inv.setProposalStatus(req.params.id, str(body(req).status, 20) as never, name)); }));
capital.post("/investments/proposals/:id/counter/resolve", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); send(res, inv.resolveCounter(req.params.id, !!body(req).accept, name)); }));
capital.post("/investments/term-sheets", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); const b = body(req); send(res, inv.issueTermSheet(str(b.proposalId, 40), (b.terms as never) ?? {}, name), 201); }));
capital.post("/investments/term-sheets/:id/status", wrap(async (req, res) => { const { name, role } = who(req); const status = str(body(req).status, 20) as never; const legal = canLegalReview(role); if (!legal && !canEditInvestors(role)) return deny(res, "Your role cannot change term sheets."); send(res, inv.setTermSheetStatus(req.params.id, status, name, legal)); }));
capital.post("/investments/:id/close", wrap(async (req, res) => { const { name, role } = who(req); if (!canAdjustLedger(role)) return deny(res, "Closing an investment is a Finance function."); send(res, inv.closeInvestment(req.params.id, str(body(req).note, 300), name)); }));
capital.post("/investments/funding", wrap(async (req, res) => { const { name, role } = who(req); if (!canEditInvestors(role) && !canVerifyFunding(role)) return deny(res, "Your role cannot record funding."); const b = body(req); send(res, inv.recordFunding({ investmentId: str(b.investmentId, 40), amount: Number(b.amount), reference: str(b.reference, 80), receivedAt: str(b.receivedAt, 30) || undefined, expected: !!b.expected }, name), 201); }));
capital.post("/investments/funding/:id/verify", wrap(async (req, res) => { const { name, role } = who(req); if (!canVerifyFunding(role)) return deny(res, "Funding verification is a Finance function."); const b = body(req); send(res, inv.verifyFunding(req.params.id, str(b.decision, 20) === "REJECTED" ? "REJECTED" : "VERIFIED", str(b.note, 300), name)); }));

/* ---------- capital products, ledgers, allocations, campaigns ---------- */
capital.get("/capital", wrap(async (_req, res) => res.json({ ledgers: CAPITAL_TYPES.map((t) => inv.ledgerFor(t)), pendingAdjustments: inv.pendingAdjustmentsFor(), allocations: inv.listAllocations() })));
capital.get("/capital/ledger/:type", wrap(async (req, res) => { const t = capType(req.params.type.toUpperCase()); if (!t) return res.status(404).json({ error: "not_found", message: "Unknown ledger." }); res.json({ ledger: inv.ledgerFor(t), pendingAdjustments: inv.pendingAdjustmentsFor(t) }); }));
capital.post("/capital/ledger/:type/return", wrap(async (req, res) => { const { name, role } = who(req); if (!canAdjustLedger(role)) return deny(res, "Booking returns is a Finance function."); const t = capType(req.params.type.toUpperCase()); if (!t) return res.status(404).json({ error: "not_found", message: "Unknown ledger." }); const b = body(req); send(res, inv.bookReturn({ capitalType: t, investmentId: str(b.investmentId, 40), kind: (["RETURN", "REPAYMENT", "REVENUE_SHARE"].includes(String(b.kind)) ? String(b.kind) : "RETURN") as never, amount: Number(b.amount), memo: str(b.memo, 200) }, name), 201); }));
capital.post("/capital/adjustments", wrap(async (req, res) => { const { name, role } = who(req); if (!canAdjustLedger(role)) return deny(res, "Ledger adjustments are a Finance function."); const b = body(req); const t = capType(b.capitalType); if (!t) return res.status(400).json({ error: "bad_type", message: "A capital type is required." }); send(res, inv.proposeAdjustment({ capitalType: t, amount: Number(b.amount), memo: str(b.memo, 200), investorId: str(b.investorId, 40) || undefined }, name), 201); }));
capital.post("/capital/adjustments/:id/decide", wrap(async (req, res) => { const { name, role } = who(req); if (!canAdjustLedger(role)) return deny(res, "Ledger adjustments are a Finance function."); send(res, inv.decideAdjustment(req.params.id, !!body(req).approve, name)); }));
capital.get("/capital/allocations", wrap(async (_req, res) => res.json({ allocations: inv.listAllocations() })));
capital.post("/capital/allocations", wrap(async (req, res) => { const { name, role } = who(req); if (!canAllocateCapital(role)) return deny(res, "Allocations are proposed by finance or investment management."); const b = body(req); const t = capType(b.capitalType); if (!t) return res.status(400).json({ error: "bad_type", message: "A capital type is required." }); send(res, inv.proposeAllocation({ capitalType: t, investmentId: str(b.investmentId, 40) || undefined, amount: Number(b.amount), purpose: str(b.purpose, 200), target: str(b.target, 80) }, name), 201); }));
capital.post("/capital/allocations/:id/decide", wrap(async (req, res) => { const { name, role } = who(req); if (!canAllocateCapital(role)) return deny(res, "Allocations are approved by finance or investment management."); const b = body(req); send(res, inv.decideAllocation(req.params.id, str(b.decision, 20) === "REJECTED" ? "REJECTED" : "APPROVED", str(b.note, 300), name)); }));
capital.post("/capital/allocations/:id/execute", wrap(async (req, res) => { const { name, role } = who(req); if (!canAllocateCapital(role)) return deny(res, "Allocations are executed by finance or investment management."); send(res, inv.executeAllocation(req.params.id, name)); }));
capital.get("/capital/campaigns", wrap(async (_req, res) => res.json({ campaigns: inv.listCampaigns() })));
capital.post("/capital/campaigns", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); const b = body(req); const t = capType(b.capitalType); if (!t) return res.status(400).json({ error: "bad_type", message: "A capital type is required." }); send(res, inv.createCampaign({ name: str(b.name), capitalType: t, target: Number(b.target), ccy: b.ccy as never, targetDate: str(b.targetDate, 20), requirementId: str(b.requirementId, 40) || undefined, opportunityId: str(b.opportunityId, 40) || undefined }, name), 201); }));
capital.post("/capital/campaigns/:id/status", wrap(async (req, res) => { if (!editGate(req, res)) return; const { name } = who(req); send(res, inv.setCampaignStatus(req.params.id, str(body(req).status, 20) as never, name)); }));
capital.get("/notifications", wrap(async (_req, res) => res.json({ notifications: inv.listNotifications() })));
capital.post("/notifications/:id/read", wrap(async (req, res) => res.json({ ok: inv.markNotificationRead(req.params.id) })));
/* ---------- global search — each category only for roles with its section ---------- */
capital.get("/search", wrap(async (req, res) => {
  const { role } = who(req);
  const q = str(req.query.q, 80).trim().toLowerCase();
  if (q.length < 2) return res.json({ q, hits: [] });
  const has = (s: Section) => canAccess(role, s);
  const m = (...parts: Array<string | undefined>) => parts.some((p) => (p ?? "").toLowerCase().includes(q));
  const hits: SearchHit[] = [];
  const push = (kind: SearchKind, id: string, title: string, sub: string, href: string) => { if (hits.length < 40) hits.push({ kind, id, title, sub, href }); };
  if (has("investors")) {
    for (const i of inv.listInvestors()) if (m(i.name, i.id, i.country, i.relationshipOwner ?? undefined)) push("investor", i.id, i.name, `${i.type} · ${i.stage}`, `/investors/${i.id}`);
    for (const o of inv.listOpportunities()) if (m(o.name, o.id)) push("opportunity", o.id, o.name, `${o.capitalType} · ${o.status}`, "/investments/opportunities");
    for (const x of inv.listInvestments()) if (m(x.id, x.investorId)) push("investment", x.id, x.id, `${x.capitalType} · ${x.status}`, "/investments");
    for (const d of inv.listDocuments()) if (m(d.title, d.id, d.type)) push("document", d.id, d.title, `${d.type} · ${d.status}`, `/investments/documents?doc=${d.id}`);
  }
  if (has("intelligence")) {
    for (const r of wf.listRequirements()) if (m(r.id, r.purpose)) push("requirement", r.id, `${r.id} — ${r.purpose}`, `${r.capitalType} · ${r.status}`, `/capital-intelligence/capital-requirements/${r.id}`);
    for (const r of wf.listRecommendations()) if (m(r.id, r.title, r.type)) push("recommendation", r.id, r.title, `${r.type} · ${r.status}`, `/capital-intelligence/recommendations/${r.id}`);
    for (const p of (await store().listPayments()).slice(-2000)) if (m(p.ref, p.id, p.recipient.phone)) push("transaction", p.id, p.ref, `${p.method} → ${p.recipient.provider} · ${p.xaf} XAF · ${p.displayStatus}`, `/capital-intelligence/transactions`);
  }
  if (has("intelligence") || has("capital")) for (const r of reports.listReports()) if (m(r.id, r.title, r.kind)) push("report", r.id, r.title, `${r.period} · ${r.generatedAt.slice(0, 10)}`, `/reports/${r.id}`);
  res.json({ q, hits });
}));
capital.get("/capital/audit", wrap(async (_req, res) => res.json({ trail: inv.auditTrail(400) })));

/* ---------- documents ---------- */
capital.get("/documents", wrap(async (_req, res) => res.json({ documents: inv.listDocuments() })));
capital.get("/documents/:id", wrap(async (req, res) => { const d = inv.getDocument(req.params.id); if (!d) return res.status(404).json({ error: "not_found", message: "Document not found." }); res.json(d); }));
capital.post("/documents", wrap(async (req, res) => { const { name, role } = who(req); if (!canEditInvestors(role) && !canLegalReview(role)) return deny(res, "Your role cannot create documents."); send(res, inv.createDocument(body(req) as never, name), 201); }));
capital.post("/documents/:id/status", wrap(async (req, res) => { const { name, role } = who(req); if (!canEditInvestors(role) && !canLegalReview(role)) return deny(res, "Your role cannot change documents."); send(res, inv.setDocumentStatus(req.params.id, str(body(req).status, 24) as never, name)); }));

/* ---------- reports ---------- */
capital.get("/capital/reports", wrap(async (_req, res) => res.json({ kinds: REPORT_KINDS, reports: reports.listReports().map((r) => ({ id: r.id, kind: r.kind, title: r.title, period: r.period, generatedAt: r.generatedAt, generatedBy: r.generatedBy })) })));
capital.post("/capital/reports", wrap(async (req, res) => { const { name } = who(req); const b = body(req); const kind = str(b.kind, 30) as ReportKind; if (!REPORT_KINDS.some((k) => k.kind === kind)) return res.status(400).json({ error: "bad_kind", message: "Unknown report." }); res.status(201).json(await reports.generate(kind, PERIODS.includes(b.period as Period) ? (b.period as Period) : "30d", name, { investorId: str(b.investorId, 40) || undefined })); }));
capital.get("/capital/reports/:id", wrap(async (req, res) => { const r = reports.getReport(req.params.id); if (!r) return res.status(404).json({ error: "not_found", message: "Report not found." }); if (req.query.format === "csv") { res.setHeader("Content-Type", "text/csv; charset=utf-8"); res.setHeader("Content-Disposition", `attachment; filename="${r.kind.toLowerCase()}-${r.period}.csv"`); return res.send(reports.csv(r)); } res.json(r); }));

/* ---------- AI copilot ---------- */
capital.get("/copilot/examples", wrap(async (_req, res) => res.json({ questions: copilot.EXAMPLE_QUESTIONS })));
capital.post("/copilot/ask", wrap(async (req, res) => { const { name } = who(req); const q = str(body(req).question, 500); if (q.trim().length < 3) return res.status(400).json({ error: "bad_question", message: "Ask a question." }); res.json(await copilot.ask(q, name, filters(req))); }));
capital.get("/copilot/audit", wrap(async (_req, res) => res.json({ entries: copilot.auditLog().slice(0, 200) })));

/* ---------- investor portal (role Investor; Super Admin may preview any investor) ---------- */
capital.get("/portal/dashboard", wrap(async (req, res) => {
  const { uid, role } = who(req);
  const preview = str(req.query.investorId, 40);
  const investor = isSuperAdmin(role) && preview ? inv.getInvestor(preview) : inv.investorForPortalUser(uid);
  if (!investor) return res.status(404).json({ error: "no_investor", message: "This login is not linked to an investor record yet." });
  res.json(reports.portalFor(investor));
}));
capital.get("/portal/documents/:id", wrap(async (req, res) => {
  const { uid, role } = who(req); const d = inv.getDocument(req.params.id);
  const investor = isSuperAdmin(role) ? (d ? inv.getInvestor(d.investorId ?? "") : undefined) : inv.investorForPortalUser(uid);
  if (!d || !investor || d.investorId !== investor.id || !d.access.includes("INVESTOR") || d.status === "DRAFT" || d.status === "VOID") return res.status(404).json({ error: "not_found", message: "Document not found." });
  res.json(d);
}));
capital.post("/portal/documents/:id/sign", wrap(async (req, res) => {
  const { uid, name } = who(req); const d = inv.getDocument(req.params.id); const investor = inv.investorForPortalUser(uid);
  if (!d || !investor || d.investorId !== investor.id || !d.access.includes("INVESTOR")) return res.status(404).json({ error: "not_found", message: "Document not found." });
  send(res, inv.signDocument(d.id, str(body(req).name, 80), `${name} (investor)`));
}));
capital.post("/portal/messages", wrap(async (req, res) => {
  const { uid, name } = who(req); const investor = inv.investorForPortalUser(uid);
  if (!investor) return res.status(404).json({ error: "no_investor", message: "This login is not linked to an investor record yet." });
  const b = body(req); send(res, inv.logMessage(investor.id, { channel: "PORTAL", subject: str(b.subject, 140), body: str(b.body, 4000), direction: "IN" }, `${name} (investor)`), 201);
}));
capital.post("/portal/proposals/:id/respond", wrap(async (req, res) => {
  const { uid, name } = who(req); const investor = inv.investorForPortalUser(uid);
  if (!investor) return res.status(404).json({ error: "no_investor", message: "This login is not linked to an investor record yet." });
  const d = str(body(req).decision, 20); if (d !== "ACCEPTED" && d !== "DECLINED") return res.status(400).json({ error: "bad_decision", message: "Decision must be ACCEPTED or DECLINED." });
  send(res, inv.respondToProposal(req.params.id, investor.id, d, `${name} (investor)`));
}));
capital.post("/portal/proposals/:id/counter", wrap(async (req, res) => {
  const { uid, name } = who(req); const investor = inv.investorForPortalUser(uid);
  if (!investor) return res.status(404).json({ error: "no_investor", message: "This login is not linked to an investor record yet." });
  const b = body(req); send(res, inv.counterProposal(req.params.id, investor.id, { amount: Number(b.amount), terms: (b.terms as never) ?? {}, note: str(b.note, 600) }, `${name} (investor)`));
}));
capital.get("/portal/reports/:id", wrap(async (req, res) => {
  const { uid, role } = who(req); const r = reports.getReport(req.params.id); const investor = isSuperAdmin(role) ? undefined : inv.investorForPortalUser(uid);
  if (!r || r.kind !== "INVESTOR" || (!isSuperAdmin(role) && (!investor || !r.sections.some((s) => s.rows.some((row) => row[0] === investor.name))))) return res.status(404).json({ error: "not_found", message: "Report not found." });
  // An investor sees only their own row of a multi-investor report.
  const scoped = investor ? { ...r, sections: r.sections.map((s) => (s.title === "Investors" ? { ...s, rows: s.rows.filter((row) => row[0] === investor.name) } : s)).filter((s) => s.title === "Investors") } : r;
  res.json(scoped);
}));
