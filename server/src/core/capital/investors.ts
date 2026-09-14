/* ============================================================
   Investor OS — investors, opportunities, proposals, term sheets,
   investments, funding, allocations, the four capital ledgers, documents,
   communications, campaigns and notifications.

   Every mutation is an audit event on the record it touches. Sensitive
   operations are FOUR-EYES in the core (the person who initiated cannot be
   the one who approves) — the route layer only adds the role gate.
   Capital types are never mixed: each ledger is its own collection of entries
   and its balances are derived from those entries alone.
   ============================================================ */
import { registerRows, touchRows } from "./rows.js";
import { id } from "../ids.js";
import { createHash } from "node:crypto";
import type {
  Investor, InvestorInput, InvestorStage, KycStatus, Opportunity, Proposal, TermSheet, Investment, FundingEvent, Allocation,
  CapitalLedgerEntry, CapitalLedger, CapitalDocument, Message, Campaign, CapitalNotification, CapitalNotificationKind, CapitalType, AuditEvent, Ccy,
  DocumentCategory, QualificationStatus, InvestorPreferences,
} from "../../../../shared/capital.js";
import { INVESTOR_STAGES, CAPITAL_TYPE_LABEL } from "../../../../shared/capital.js";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; message: string; status: number };
const fail = (error: string, message: string, status = 400): Result<never> => ({ ok: false, error, message, status });
const okv = <T>(value: T): Result<T> => ({ ok: true, value });
const now = () => new Date().toISOString();
const ev = (actor: string, action: string, note?: string): AuditEvent => ({ at: now(), actor, action, ...(note ? { note } : {}) });

/* ---------- collections ---------- */
const investors = new Map<string, Investor>();
const opportunities = new Map<string, Opportunity>();
const proposals = new Map<string, Proposal>();
const termSheets = new Map<string, TermSheet>();
const investments = new Map<string, Investment>();
const funding = new Map<string, FundingEvent>();
const allocations = new Map<string, Allocation>();
const ledger: CapitalLedgerEntry[] = [];
/** Ledger adjustments awaiting a second pair of eyes. */
const pendingAdjustments = new Map<string, CapitalLedgerEntry & { proposedBy: string }>();
const documents = new Map<string, CapitalDocument>();
const messages: Message[] = [];
const campaigns = new Map<string, Campaign>();
const notifications: CapitalNotification[] = [];

const mapDump = <T>(m: Map<string, T>) => () => [...m.values()];
const mapRestore = <T extends { id: string }>(m: Map<string, T>) => (rows: T[]) => { m.clear(); for (const r of rows ?? []) m.set(r.id, r); };
// Every collection is keyed by id → snapshot locally, per-row on Postgres (see rows.ts).
registerRows("capital_investors", mapDump(investors), mapRestore(investors));
registerRows("capital_opportunities", mapDump(opportunities), mapRestore(opportunities));
registerRows("capital_proposals", mapDump(proposals), mapRestore(proposals));
registerRows("capital_termsheets", mapDump(termSheets), mapRestore(termSheets));
registerRows("capital_investments", mapDump(investments), mapRestore(investments));
registerRows("capital_funding", mapDump(funding), mapRestore(funding));
registerRows("capital_allocations", mapDump(allocations), mapRestore(allocations));
registerRows("capital_ledger", () => ledger, (rows: CapitalLedgerEntry[]) => { ledger.length = 0; ledger.push(...(rows ?? [])); ledger.sort((a, b) => a.at.localeCompare(b.at)); });
registerRows("capital_pending_adjustments", mapDump(pendingAdjustments), mapRestore(pendingAdjustments));
registerRows("capital_documents", mapDump(documents), mapRestore(documents));
registerRows("capital_messages", () => messages, (rows: Message[]) => { messages.length = 0; messages.push(...(rows ?? [])); messages.sort((a, b) => b.at.localeCompare(a.at)); });
registerRows("capital_campaigns", mapDump(campaigns), mapRestore(campaigns));
registerRows("capital_notifications", () => notifications.slice(0, 500), (rows: CapitalNotification[]) => { notifications.length = 0; notifications.push(...(rows ?? [])); notifications.sort((a, b) => b.at.localeCompare(a.at)); });
const touch = touchRows;

/* ---------- notifications ---------- */
const SEVERITY: Record<CapitalNotificationKind, CapitalNotification["severity"]> = {
  NEW_INVESTOR: "info", KYC_SUBMITTED: "info", KYC_APPROVED: "info", REQUIREMENT_IDENTIFIED: "warn", FUNDING_GAP: "warn",
  LIQUIDITY_WARNING: "critical", RISK_ESCALATION: "critical", RECOMMENDATION_CREATED: "info", APPROVAL_REQUIRED: "warn",
  FUNDING_RECEIVED: "info", INVESTMENT_CLOSED: "info", DOCUMENT_ACTION: "warn",
};
export function notifyCapital(kind: CapitalNotificationKind, title: string, text: string, href: string): void {
  // De-duplicate an identical open notification (engine scans repeat).
  if (notifications.some((n) => n.kind === kind && n.title === title && !n.readAt)) return;
  notifications.unshift({ id: id("cn"), at: now(), kind, severity: SEVERITY[kind], title, text, href });
  if (notifications.length > 500) notifications.length = 500;
  touch("capital_notifications");
}
export function listNotifications(): CapitalNotification[] {
  const order = { critical: 0, warn: 1, info: 2 };
  return [...notifications].sort((a, b) => (a.readAt ? 1 : 0) - (b.readAt ? 1 : 0) || order[a.severity] - order[b.severity] || b.at.localeCompare(a.at));
}
export function markNotificationRead(nid: string): boolean {
  const n = notifications.find((x) => x.id === nid);
  if (!n) return false;
  n.readAt = now(); touch("capital_notifications"); return true;
}

/* ---------- investors ---------- */
const DEFAULT_PREFS: InvestorPreferences = { capitalTypes: ["OWN"], minTicket: 0, maxTicket: 0, ccy: "USD", horizonMonths: 36, geographies: ["CEMAC"], strategicInterests: [] };
const clean = (s: unknown, max = 120): string => String(s ?? "").replace(/[\x00-\x1f]/g, "").trim().slice(0, max);
/** Multi-line text (document bodies, message bodies): keeps newlines and tabs, drops the rest of C0. */
const cleanText = (s: unknown, max: number): string => String(s ?? "").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/\r\n?/g, "\n").trim().slice(0, max);
const num = (v: unknown, d = 0): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };

export function listInvestors(): Investor[] { return [...investors.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function getInvestor(iid: string): Investor | undefined { return investors.get(iid); }
export function investorForPortalUser(uid: string): Investor | undefined { return [...investors.values()].find((i) => i.portalUserId === uid); }

export function createInvestor(input: InvestorInput, actor: string): Result<Investor> {
  const name = clean(input.name);
  if (name.length < 2) return fail("bad_name", "An investor name is required.");
  const inv: Investor = {
    id: id("inv"), name, type: input.type ?? "INDIVIDUAL", country: clean(input.country, 40) || "CM", stage: "LEAD",
    kyc: { status: "NOT_STARTED", documents: [{ kind: "GOVERNMENT_ID", received: false }, { kind: "PROOF_OF_ADDRESS", received: false }, { kind: "SOURCE_OF_FUNDS", received: false }, { kind: "TAX_ID", received: false }], notes: [] },
    qualification: { status: "UNQUALIFIED", score: null },
    preferences: { ...DEFAULT_PREFS, ...(input.preferences ?? {}) },
    committed: 0, invested: 0, ccy: input.ccy ?? "USD",
    relationshipOwner: input.relationshipOwner ?? null, contact: { email: clean(input.contact?.email, 120) || undefined, phone: clean(input.contact?.phone, 30) || undefined },
    riskFlags: [], tags: (input.tags ?? []).map((t) => clean(t, 30)).filter(Boolean).slice(0, 10),
    createdAt: now(), updatedAt: now(), activity: [ev(actor, "Investor created")],
  };
  investors.set(inv.id, inv); touch("capital_investors");
  notifyCapital("NEW_INVESTOR", `New investor: ${inv.name}`, `${inv.type} · ${inv.country} — added by ${actor}.`, `/investors/${inv.id}`);
  return okv(inv);
}
export function updateInvestor(iid: string, patch: Partial<InvestorInput> & { stage?: InvestorStage; nextContactAt?: string; lastContactAt?: string; portalUserId?: string | null }, actor: string): Result<Investor> {
  const inv = investors.get(iid);
  if (!inv) return fail("not_found", "Investor not found.", 404);
  if (patch.name != null) { const n = clean(patch.name); if (n.length < 2) return fail("bad_name", "Name too short."); inv.name = n; }
  if (patch.type) inv.type = patch.type;
  if (patch.country) inv.country = clean(patch.country, 40);
  if (patch.contact) inv.contact = { ...inv.contact, ...patch.contact };
  if (patch.preferences) inv.preferences = { ...inv.preferences, ...patch.preferences };
  if (patch.relationshipOwner !== undefined) inv.relationshipOwner = patch.relationshipOwner;
  if (patch.tags) inv.tags = patch.tags.map((t) => clean(t, 30)).filter(Boolean).slice(0, 10);
  if (patch.nextContactAt !== undefined) inv.nextContactAt = patch.nextContactAt;
  if (patch.lastContactAt !== undefined) inv.lastContactAt = patch.lastContactAt;
  if (patch.portalUserId !== undefined) inv.portalUserId = patch.portalUserId ?? undefined;
  if (patch.stage && patch.stage !== inv.stage) {
    const r = advanceStage(inv, patch.stage, actor);
    if (!r.ok) return r;
  }
  inv.updatedAt = now(); inv.activity.push(ev(actor, "Investor updated"));
  touch("capital_investors");
  return okv(inv);
}
/** Stage moves follow the lifecycle; gated stages need their prerequisite in place. */
function advanceStage(inv: Investor, to: InvestorStage, actor: string): Result<Investor> {
  const from = INVESTOR_STAGES.indexOf(inv.stage), t = INVESTOR_STAGES.indexOf(to);
  if (t < 0) return fail("bad_stage", "Unknown stage.");
  if (to === "QUALIFIED" && inv.qualification.status !== "QUALIFIED") return fail("blocked", "Qualification must be QUALIFIED first.", 409);
  if (t >= INVESTOR_STAGES.indexOf("KYC_APPROVED") && inv.kyc.status !== "APPROVED") return fail("blocked", "KYC must be approved before this stage.", 409);
  if (to === "FUNDED" && ![...investments.values()].some((x) => x.investorId === inv.id && x.received > 0)) return fail("blocked", "No verified funding on record.", 409);
  inv.activity.push(ev(actor, `Stage ${inv.stage} → ${to}`, t < from ? "moved back" : undefined));
  inv.stage = to;
  return okv(inv);
}
export function qualifyInvestor(iid: string, status: QualificationStatus, score: number | null, note: string, actor: string): Result<Investor> {
  const inv = investors.get(iid);
  if (!inv) return fail("not_found", "Investor not found.", 404);
  inv.qualification = { status, score: score == null ? null : Math.max(0, Math.min(100, Math.round(score))), note: clean(note, 400), assessedBy: actor, assessedAt: now() };
  inv.activity.push(ev(actor, `Qualification ${status}`, note));
  if (status === "QUALIFIED" && INVESTOR_STAGES.indexOf(inv.stage) < INVESTOR_STAGES.indexOf("QUALIFIED")) inv.stage = "QUALIFIED";
  inv.updatedAt = now(); touch("capital_investors");
  return okv(inv);
}
/* KYC — submit (anyone with investor edit), then APPROVE by a compliance officer who is not
   the submitter. Rejection is also an officer action. */
export function submitKyc(iid: string, docs: Array<{ kind: string; received: boolean }>, note: string, actor: string): Result<Investor> {
  const inv = investors.get(iid);
  if (!inv) return fail("not_found", "Investor not found.", 404);
  for (const d of docs) { const slot = inv.kyc.documents.find((x) => x.kind === d.kind); if (slot) slot.received = !!d.received; }
  inv.kyc.status = "SUBMITTED"; inv.kyc.submittedAt = now(); inv.kyc.initiatedBy = actor;
  if (note) inv.kyc.notes.push(`${actor}: ${clean(note, 300)}`);
  inv.activity.push(ev(actor, "KYC submitted"));
  inv.updatedAt = now(); touch("capital_investors");
  notifyCapital("KYC_SUBMITTED", `KYC submitted: ${inv.name}`, "Awaiting a compliance officer's review.", `/investors/${inv.id}`);
  return okv(inv);
}
export function reviewKyc(iid: string, decision: Extract<KycStatus, "APPROVED" | "REJECTED" | "IN_REVIEW">, note: string, actor: string): Result<Investor> {
  const inv = investors.get(iid);
  if (!inv) return fail("not_found", "Investor not found.", 404);
  if (inv.kyc.status === "NOT_STARTED") return fail("blocked", "Nothing submitted yet.", 409);
  if (decision === "APPROVED") {
    if (inv.kyc.initiatedBy && inv.kyc.initiatedBy === actor) return fail("four_eyes", "The person who submitted the KYC file cannot approve it.", 409);
    if (!inv.kyc.documents.every((d) => d.received)) return fail("blocked", "Every required document must be received before approval.", 409);
    inv.kyc.approvedBy = actor;
    if (INVESTOR_STAGES.indexOf(inv.stage) < INVESTOR_STAGES.indexOf("KYC_APPROVED")) inv.stage = "KYC_APPROVED";
    notifyCapital("KYC_APPROVED", `KYC approved: ${inv.name}`, `Approved by ${actor}.`, `/investors/${inv.id}`);
  }
  inv.kyc.status = decision; inv.kyc.reviewedAt = now(); inv.kyc.reviewedBy = actor;
  if (note) inv.kyc.notes.push(`${actor}: ${clean(note, 300)}`);
  inv.activity.push(ev(actor, `KYC ${decision}`, note));
  inv.updatedAt = now(); touch("capital_investors");
  return okv(inv);
}
export function logMessage(iid: string, m: { channel: Message["channel"]; subject: string; body: string; direction?: Message["direction"] }, actor: string): Result<Message> {
  const inv = investors.get(iid);
  if (!inv) return fail("not_found", "Investor not found.", 404);
  const msg: Message = { id: id("msg"), investorId: iid, at: now(), from: actor, direction: m.direction ?? "OUT", channel: m.channel, subject: clean(m.subject, 140), body: cleanText(m.body, 4000) };
  if (!msg.subject) return fail("bad_subject", "A subject is required.");
  messages.unshift(msg); touch("capital_messages");
  inv.lastContactAt = msg.at; inv.activity.push(ev(actor, `${m.channel} · ${msg.subject}`)); inv.updatedAt = now(); touch("capital_investors");
  return okv(msg);
}
export function messagesFor(iid: string): Message[] { return messages.filter((m) => m.investorId === iid); }
export function listMessages(): Array<Message & { investorName: string }> { return messages.slice(0, 500).map((m) => ({ ...m, investorName: investors.get(m.investorId)?.name ?? m.investorId })); }

/* ---------- opportunities ---------- */
export function listOpportunities(): Opportunity[] { return [...opportunities.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function getOpportunity(oid: string): Opportunity | undefined { return opportunities.get(oid); }
export function createOpportunity(input: Partial<Opportunity>, actor: string): Result<Opportunity> {
  const name = clean(input.name);
  if (name.length < 2) return fail("bad_name", "An opportunity name is required.");
  if (!input.capitalType || !(input.capitalType in CAPITAL_TYPE_LABEL)) return fail("bad_type", "A capital type is required.");
  const o: Opportunity = {
    id: id("opp"), name, capitalType: input.capitalType, target: num(input.target), raised: 0, committed: 0, ccy: input.ccy ?? "USD",
    minTicket: num(input.minTicket), termMonths: num(input.termMonths, 12), status: "DRAFT", requirementId: input.requirementId,
    description: clean(input.description, 1000), economics: input.economics ?? {}, createdAt: now(), updatedAt: now(), history: [ev(actor, "Opportunity created")],
  };
  opportunities.set(o.id, o); touch("capital_opportunities");
  return okv(o);
}
export function setOpportunityStatus(oid: string, status: Opportunity["status"], actor: string): Result<Opportunity> {
  const o = opportunities.get(oid);
  if (!o) return fail("not_found", "Opportunity not found.", 404);
  o.history.push(ev(actor, `Status ${o.status} → ${status}`)); o.status = status; o.updatedAt = now(); touch("capital_opportunities");
  return okv(o);
}
function recomputeOpportunity(oid: string): void {
  const o = opportunities.get(oid); if (!o) return;
  const inv = [...investments.values()].filter((x) => x.opportunityId === oid);
  o.committed = inv.reduce((s, x) => s + x.committed, 0);
  o.raised = inv.reduce((s, x) => s + x.received, 0);
  if (o.target > 0 && o.raised >= o.target && o.status !== "CLOSED") o.status = "TARGET_REACHED";
  o.updatedAt = now(); touch("capital_opportunities");
}

/* ---------- proposals → term sheets → investments ---------- */
export function listProposals(): Proposal[] { return [...proposals.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function createProposal(input: { investorId: string; opportunityId: string; amount: number; terms?: Record<string, string | number> }, actor: string): Result<Proposal> {
  const inv = investors.get(input.investorId), o = opportunities.get(input.opportunityId);
  if (!inv) return fail("not_found", "Investor not found.", 404);
  if (!o) return fail("not_found", "Opportunity not found.", 404);
  if (inv.kyc.status !== "APPROVED") return fail("blocked", "A proposal needs an approved KYC file.", 409);
  const amount = num(input.amount);
  if (amount <= 0) return fail("bad_amount", "Amount must be positive.");
  if (o.minTicket > 0 && amount < o.minTicket) return fail("bad_amount", `Minimum ticket is ${o.minTicket} ${o.ccy}.`);
  const p: Proposal = { id: id("prop"), investorId: inv.id, opportunityId: o.id, amount, ccy: o.ccy, capitalType: o.capitalType, terms: { ...o.economics, ...(input.terms ?? {}) }, status: "DRAFT", createdAt: now(), updatedAt: now(), history: [ev(actor, "Proposal drafted")] };
  proposals.set(p.id, p); touch("capital_proposals");
  if (INVESTOR_STAGES.indexOf(inv.stage) < INVESTOR_STAGES.indexOf("PROPOSAL")) { inv.stage = "PROPOSAL"; inv.activity.push(ev(actor, "Stage → PROPOSAL", p.id)); inv.updatedAt = now(); touch("capital_investors"); }
  return okv(p);
}
export function setProposalStatus(pid: string, status: Proposal["status"], actor: string): Result<Proposal> {
  const p = proposals.get(pid);
  if (!p) return fail("not_found", "Proposal not found.", 404);
  p.history.push(ev(actor, `Status ${p.status} → ${status}`)); p.status = status; p.updatedAt = now(); touch("capital_proposals");
  return okv(p);
}
export function listTermSheets(): TermSheet[] { return [...termSheets.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function issueTermSheet(pid: string, terms: Record<string, string | number>, actor: string): Result<TermSheet> {
  const p = proposals.get(pid);
  if (!p) return fail("not_found", "Proposal not found.", 404);
  if (p.status !== "ACCEPTED") return fail("blocked", "Only an accepted proposal becomes a term sheet.", 409);
  const t: TermSheet = { id: id("ts"), proposalId: p.id, investorId: p.investorId, amount: p.amount, ccy: p.ccy, capitalType: p.capitalType, terms: { ...p.terms, ...terms }, status: "ISSUED", createdAt: now(), updatedAt: now(), history: [ev(actor, "Term sheet issued")] };
  termSheets.set(t.id, t); touch("capital_termsheets");
  const doc = createDocument({ title: `${CAPITAL_TYPE_LABEL[t.capitalType]} Term Sheet — ${investors.get(t.investorId)?.name ?? t.investorId}`, category: ledgerCategory(t.capitalType), type: "TERM_SHEET", investorId: t.investorId, termSheetId: t.id, access: ["MANAGEMENT", "INVESTOR", "LEGAL"], body: renderTermSheet(t) }, actor);
  if (doc.ok) { t.documentId = doc.value.id; touch("capital_termsheets"); }
  const inv = investors.get(t.investorId);
  if (inv && INVESTOR_STAGES.indexOf(inv.stage) < INVESTOR_STAGES.indexOf("TERM_SHEET")) { inv.stage = "TERM_SHEET"; inv.activity.push(ev(actor, "Stage → TERM_SHEET", t.id)); inv.updatedAt = now(); touch("capital_investors"); }
  return okv(t);
}
export function setTermSheetStatus(tid: string, status: TermSheet["status"], actor: string, legal = false): Result<TermSheet> {
  const t = termSheets.get(tid);
  if (!t) return fail("not_found", "Term sheet not found.", 404);
  if (status === "LEGAL_REVIEW" || status === "EXECUTED") {
    if (!legal) return fail("forbidden", "Legal review and execution are a Legal function.", 403);
    t.legalReviewer = actor;
  }
  if (status === "EXECUTED" && t.status !== "LEGAL_REVIEW" && t.status !== "SIGNED") return fail("blocked", "A term sheet is executed after legal review.", 409);
  t.history.push(ev(actor, `Status ${t.status} → ${status}`)); t.status = status; t.updatedAt = now(); touch("capital_termsheets");
  const inv = investors.get(t.investorId);
  if (inv) {
    if (status === "LEGAL_REVIEW" && INVESTOR_STAGES.indexOf(inv.stage) < INVESTOR_STAGES.indexOf("LEGAL_REVIEW")) inv.stage = "LEGAL_REVIEW";
    if (status === "EXECUTED") {
      // An executed term sheet is a COMMITMENT on the investor's capital ledger and opens the investment.
      const investment: Investment = { id: id("ivt"), investorId: t.investorId, opportunityId: proposals.get(t.proposalId)?.opportunityId ?? "", termSheetId: t.id, capitalType: t.capitalType, committed: t.amount, received: 0, deployed: 0, returned: 0, ccy: t.ccy, status: "PENDING_FUNDING", economics: t.terms, createdAt: now(), updatedAt: now(), history: [ev(actor, "Investment opened from executed term sheet", t.id)] };
      investments.set(investment.id, investment); touch("capital_investments");
      post({ capitalType: t.capitalType, kind: "COMMITMENT", amount: t.amount, ccy: t.ccy, investorId: t.investorId, investmentId: investment.id, ref: t.id, memo: `Commitment — term sheet ${t.id}`, actor });
      inv.committed += t.amount; inv.stage = "FUNDING_PENDING"; inv.activity.push(ev(actor, "Stage → FUNDING_PENDING", investment.id));
      recomputeOpportunity(investment.opportunityId);
      const camp = [...campaigns.values()].find((c) => c.opportunityId === investment.opportunityId);
      if (camp) recomputeCampaign(camp.id);
    }
    inv.updatedAt = now(); touch("capital_investors");
  }
  return okv(t);
}
/** Close (exit) an investment — Finance. Equity: exit event; liquidity/growth: facility ended. */
export function closeInvestment(iid: string, note: string, actor: string): Result<Investment> {
  const ivt = investments.get(iid);
  if (!ivt) return fail("not_found", "Investment not found.", 404);
  if (ivt.status === "EXITED") return fail("blocked", "Already closed.", 409);
  if (ivt.status === "PENDING_FUNDING") return fail("blocked", "Nothing was funded — void the term sheet instead.", 409);
  ivt.status = "EXITED"; ivt.history.push(ev(actor, "Investment closed", note)); ivt.updatedAt = now(); touch("capital_investments");
  const inv = investors.get(ivt.investorId);
  if (inv && !investmentsFor(inv.id).some((x) => x.status !== "EXITED")) { inv.stage = "CLOSED"; inv.activity.push(ev(actor, "Stage → CLOSED", iid)); inv.updatedAt = now(); touch("capital_investors"); }
  notifyCapital("INVESTMENT_CLOSED", `Investment closed: ${inv?.name ?? ivt.investorId}`, `${CAPITAL_TYPE_LABEL[ivt.capitalType]} · received ${ivt.received} ${ivt.ccy} · returned ${ivt.returned} ${ivt.ccy}${note ? ` — ${note}` : ""}`, "/investments");
  return okv(ivt);
}
/** The investor's own answer to a proposal, from the private room. */
export function respondToProposal(pid: string, investorId: string, decision: "ACCEPTED" | "DECLINED", actor: string): Result<Proposal> {
  const p = proposals.get(pid);
  if (!p || p.investorId !== investorId) return fail("not_found", "Proposal not found.", 404);
  if (p.status !== "SENT" && p.status !== "VIEWED") return fail("blocked", "This proposal is no longer open for a response.", 409);
  p.history.push(ev(actor, `Investor ${decision.toLowerCase()} the proposal`)); p.status = decision; p.updatedAt = now(); touch("capital_proposals");
  const inv = investors.get(investorId);
  if (inv) { inv.activity.push(ev(actor, `Proposal ${p.id} ${decision.toLowerCase()}`)); inv.lastContactAt = now(); inv.updatedAt = now(); touch("capital_investors"); }
  notifyCapital("APPROVAL_REQUIRED", `Proposal ${decision.toLowerCase()} by ${inv?.name ?? investorId}`, decision === "ACCEPTED" ? "Issue the term sheet from Proposals." : "Consider a revised proposal.", "/investments/proposals");
  return okv(p);
}
export function counterProposal(pid: string, investorId: string, counter: { amount: number; terms?: Record<string, string | number>; note: string }, actor: string): Result<Proposal> {
  const p = proposals.get(pid);
  if (!p || p.investorId !== investorId) return fail("not_found", "Proposal not found.", 404);
  if (p.status !== "SENT" && p.status !== "VIEWED") return fail("blocked", "This proposal is no longer open for a response.", 409);
  const amount = num(counter.amount);
  if (amount <= 0) return fail("bad_amount", "A counter amount is required.");
  p.counter = { amount, terms: { ...p.terms, ...(counter.terms ?? {}) }, note: cleanText(counter.note, 600), at: now(), by: actor };
  p.status = "COUNTERED"; p.history.push(ev(actor, `Investor countered at ${amount} ${p.ccy}`, p.counter.note)); p.updatedAt = now(); touch("capital_proposals");
  const inv = investors.get(investorId);
  if (inv) { inv.activity.push(ev(actor, `Countered proposal ${p.id}`)); inv.lastContactAt = now(); inv.updatedAt = now(); touch("capital_investors"); }
  notifyCapital("APPROVAL_REQUIRED", `Counter-offer from ${inv?.name ?? investorId}`, `${amount} ${p.ccy} on ${p.id} — accept it (new proposal) or decline it.`, "/investments/proposals");
  return okv(p);
}
/** Management's answer to a counter: accept → a superseding proposal at the countered terms, already ACCEPTED; decline → back to SENT. */
export function resolveCounter(pid: string, accept: boolean, actor: string): Result<Proposal> {
  const p = proposals.get(pid);
  if (!p) return fail("not_found", "Proposal not found.", 404);
  if (p.status !== "COUNTERED" || !p.counter) return fail("blocked", "No open counter-offer on this proposal.", 409);
  if (!accept) { p.status = "SENT"; p.history.push(ev(actor, "Counter-offer declined — original terms stand")); p.updatedAt = now(); touch("capital_proposals"); return okv(p); }
  const o = opportunities.get(p.opportunityId);
  if (o && o.minTicket > 0 && p.counter.amount < o.minTicket) return fail("bad_amount", `The counter is below the minimum ticket of ${o.minTicket} ${o.ccy}.`, 409);
  const np: Proposal = { id: id("prop"), investorId: p.investorId, opportunityId: p.opportunityId, amount: p.counter.amount, ccy: p.ccy, capitalType: p.capitalType, terms: p.counter.terms, status: "ACCEPTED", supersedes: p.id, createdAt: now(), updatedAt: now(), history: [ev(actor, `Created from the investor's counter on ${p.id}`, p.counter.note), ev(actor, "Status → ACCEPTED (counter accepted by management)")] };
  proposals.set(np.id, np);
  p.status = "SUPERSEDED"; p.history.push(ev(actor, `Counter accepted — superseded by ${np.id}`)); p.updatedAt = now(); touch("capital_proposals");
  return okv(np);
}
export function markProposalViewed(pid: string): void { const p = proposals.get(pid); if (p && p.status === "SENT") { p.status = "VIEWED"; p.history.push(ev("investor", "Viewed in the portal")); p.updatedAt = now(); touch("capital_proposals"); } }
export function listInvestments(): Investment[] { return [...investments.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function getInvestment(iid: string): Investment | undefined { return investments.get(iid); }

/* ---------- funding (record → verify, four eyes) ---------- */
export function listFunding(): FundingEvent[] { return [...funding.values()].sort((a, b) => (b.receivedAt ?? b.expectedAt ?? "").localeCompare(a.receivedAt ?? a.expectedAt ?? "")); }
export function recordFunding(input: { investmentId: string; amount: number; reference?: string; receivedAt?: string; expected?: boolean }, actor: string): Result<FundingEvent> {
  const ivt = investments.get(input.investmentId);
  if (!ivt) return fail("not_found", "Investment not found.", 404);
  const amount = num(input.amount);
  if (amount <= 0) return fail("bad_amount", "Amount must be positive.");
  const f: FundingEvent = { id: id("fund"), investmentId: ivt.id, investorId: ivt.investorId, capitalType: ivt.capitalType, amount, ccy: ivt.ccy, status: input.expected ? "EXPECTED" : "RECEIVED", reference: clean(input.reference, 80) || undefined, expectedAt: input.expected ? (input.receivedAt ?? now()) : undefined, receivedAt: input.expected ? undefined : (input.receivedAt ?? now()), recordedBy: actor, history: [ev(actor, input.expected ? "Funding expected" : "Funding recorded")] };
  funding.set(f.id, f); touch("capital_funding");
  ivt.history.push(ev(actor, `Funding ${f.status.toLowerCase()} ${amount} ${f.ccy}`, f.id)); ivt.updatedAt = now(); touch("capital_investments");
  if (f.status === "RECEIVED") notifyCapital("APPROVAL_REQUIRED", `Funding to verify: ${amount} ${f.ccy}`, `Recorded by ${actor} — needs verification by a second person.`, `/investments/funding`);
  return okv(f);
}
export function verifyFunding(fid: string, decision: "VERIFIED" | "REJECTED", note: string, actor: string): Result<FundingEvent> {
  const f = funding.get(fid);
  if (!f) return fail("not_found", "Funding event not found.", 404);
  if (f.status !== "RECEIVED") return fail("blocked", "Only received funding can be verified.", 409);
  if (f.recordedBy === actor) return fail("four_eyes", "The person who recorded the funding cannot verify it.", 409);
  f.status = decision; f.verifiedBy = actor; f.verifiedAt = now(); f.history.push(ev(actor, `Funding ${decision}`, note));
  touch("capital_funding");
  const ivt = investments.get(f.investmentId), inv = investors.get(f.investorId);
  if (decision === "VERIFIED" && ivt) {
    post({ capitalType: f.capitalType, kind: "RECEIPT", amount: f.amount, ccy: f.ccy, investorId: f.investorId, investmentId: ivt.id, ref: f.reference ?? f.id, memo: `Funding received — verified by ${actor}`, actor, approvedBy: actor });
    ivt.received += f.amount; ivt.status = ivt.received >= ivt.committed ? "FUNDED" : "PARTIALLY_FUNDED"; ivt.history.push(ev(actor, `Funding verified ${f.amount} ${f.ccy}`, f.id)); ivt.updatedAt = now(); touch("capital_investments");
    if (inv) { inv.invested += f.amount; if (ivt.status === "FUNDED") { inv.stage = "FUNDED"; inv.activity.push(ev(actor, "Stage → FUNDED", ivt.id)); } inv.updatedAt = now(); touch("capital_investors"); }
    recomputeOpportunity(ivt.opportunityId);
    for (const c of campaigns.values()) if (c.opportunityId === ivt.opportunityId) recomputeCampaign(c.id);
    notifyCapital("FUNDING_RECEIVED", `Funding verified: ${f.amount} ${f.ccy}`, `${inv?.name ?? f.investorId} — ${CAPITAL_TYPE_LABEL[f.capitalType]} capital.`, `/capital/${ledgerPath(f.capitalType)}`);
  }
  return okv(f);
}

/* ---------- allocations (propose → approve by someone else → execute) ---------- */
export function listAllocations(): Allocation[] { return [...allocations.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function proposeAllocation(input: { capitalType: CapitalType; investmentId?: string; amount: number; purpose: string; target: string }, actor: string): Result<Allocation> {
  const amount = num(input.amount);
  if (amount <= 0) return fail("bad_amount", "Amount must be positive.");
  if (!(input.capitalType in CAPITAL_TYPE_LABEL)) return fail("bad_type", "Unknown capital type.");
  const bal = ledgerFor(input.capitalType).balances;
  if (amount > bal.available) return fail("insufficient", `Only ${bal.available} ${ledgerCcy(input.capitalType)} of ${CAPITAL_TYPE_LABEL[input.capitalType]} capital is available.`, 409);
  const a: Allocation = { id: id("alloc"), capitalType: input.capitalType, investmentId: input.investmentId, amount, ccy: ledgerCcy(input.capitalType), purpose: clean(input.purpose, 200), target: clean(input.target, 80), status: "PROPOSED", initiatedBy: actor, createdAt: now(), history: [ev(actor, "Allocation proposed")] };
  if (!a.purpose) return fail("bad_purpose", "A purpose is required.");
  allocations.set(a.id, a); touch("capital_allocations");
  notifyCapital("APPROVAL_REQUIRED", `Allocation to approve: ${amount} ${a.ccy}`, `${a.purpose} — proposed by ${actor}.`, "/capital/allocations");
  return okv(a);
}
export function decideAllocation(aid: string, decision: "APPROVED" | "REJECTED", note: string, actor: string): Result<Allocation> {
  const a = allocations.get(aid);
  if (!a) return fail("not_found", "Allocation not found.", 404);
  if (a.status !== "PROPOSED") return fail("blocked", "Already decided.", 409);
  if (a.initiatedBy === actor) return fail("four_eyes", "The person who proposed the allocation cannot approve it.", 409);
  a.status = decision; a.approvedBy = actor; a.approvedAt = now(); a.history.push(ev(actor, `Allocation ${decision}`, note)); touch("capital_allocations");
  return okv(a);
}
export function executeAllocation(aid: string, actor: string): Result<Allocation> {
  const a = allocations.get(aid);
  if (!a) return fail("not_found", "Allocation not found.", 404);
  if (a.status !== "APPROVED") return fail("blocked", "Only an approved allocation can be executed.", 409);
  const bal = ledgerFor(a.capitalType).balances;
  if (a.amount > bal.available) return fail("insufficient", "Available capital has changed since approval.", 409);
  post({ capitalType: a.capitalType, kind: "DEPLOYMENT", amount: a.amount, ccy: a.ccy, investmentId: a.investmentId, ref: a.id, memo: `${a.purpose} → ${a.target}`, actor, approvedBy: a.approvedBy });
  a.status = "EXECUTED"; a.executedAt = now(); a.history.push(ev(actor, "Allocation executed")); touch("capital_allocations");
  if (a.investmentId) { const ivt = investments.get(a.investmentId); if (ivt) { ivt.deployed += a.amount; ivt.status = "ALLOCATED"; ivt.history.push(ev(actor, `Deployed ${a.amount} ${a.ccy}`, a.id)); ivt.updatedAt = now(); touch("capital_investments"); const inv = investors.get(ivt.investorId); if (inv && inv.stage === "FUNDED") { inv.stage = "ALLOCATED"; inv.updatedAt = now(); touch("capital_investors"); } } }
  return okv(a);
}

/* ---------- ledgers ---------- */
function ledgerCcy(t: CapitalType): Ccy { return ledger.find((e) => e.capitalType === t)?.ccy ?? "USD"; }
export function ledgerPath(t: CapitalType): string { return ({ OWN: "equity", POWER: "liquidity", SCALE: "growth", STRATEGIC: "strategic" } as const)[t]; }
function ledgerCategory(t: CapitalType): DocumentCategory { return ({ OWN: "equity", POWER: "liquidity", SCALE: "growth", STRATEGIC: "strategic" } as const)[t]; }
function post(e: Omit<CapitalLedgerEntry, "id" | "at">): CapitalLedgerEntry {
  const entry: CapitalLedgerEntry = { id: id("cl"), at: now(), ...e };
  ledger.push(entry); touch("capital_ledger");
  return entry;
}
export function ledgerEntries(t: CapitalType): CapitalLedgerEntry[] { return ledger.filter((e) => e.capitalType === t).sort((a, b) => b.at.localeCompare(a.at)); }
export function ledgerFor(t: CapitalType): CapitalLedger {
  const es = ledgerEntries(t);
  const sum = (k: CapitalLedgerEntry["kind"]) => es.filter((e) => e.kind === k).reduce((s, e) => s + e.amount, 0);
  const committed = sum("COMMITMENT"), received = sum("RECEIPT") + sum("ADJUSTMENT"), deployed = sum("DEPLOYMENT"), returned = sum("RETURN") + sum("REPAYMENT") + sum("REVENUE_SHARE");
  const balances = { committed, received, deployed, returned, available: Math.max(0, received - deployed + (t === "POWER" ? returned : 0)), outstanding: Math.max(0, deployed - returned) };
  const ivts = [...investments.values()].filter((x) => x.capitalType === t);
  const nameOf = (iid: string) => investors.get(iid)?.name ?? iid;
  let detail: CapitalLedger["detail"] = {};
  if (t === "OWN") {
    const rows = ivts.map((x) => ({ investor: nameOf(x.investorId), invested: x.received, committed: x.committed, ownershipPct: Number(x.economics.ownershipPct ?? 0), round: String(x.economics.round ?? "—"), status: x.status }));
    const ownership = rows.reduce((s, r) => s + r.ownershipPct, 0);
    detail = { capTable: rows, shareholders: rows.length, investorOwnershipPct: Math.round(ownership * 100) / 100, foundersOwnershipPct: Math.round((100 - ownership) * 100) / 100, valuation: Number(ivts[0]?.economics.valuation ?? 0) };
  } else if (t === "POWER") {
    detail = { providers: ivts.map((x) => ({ investor: nameOf(x.investorId), committed: x.committed, deployed: x.deployed, available: Math.max(0, x.received - x.deployed), returnPct: Number(x.economics.returnPct ?? 0), status: x.status })), utilizationPct: received > 0 ? Math.round((deployed / received) * 1000) / 10 : 0, returns: returned };
  } else if (t === "SCALE") {
    detail = { participants: ivts.map((x) => ({ investor: nameOf(x.investorId), provided: x.received, participationPct: Number(x.economics.revenueSharePct ?? 0), cap: Number(x.economics.cap ?? 0), repaid: x.returned, outstanding: Math.max(0, Number(x.economics.cap ?? 0) - x.returned), status: x.status })), repayment: returned, outstandingToCap: ivts.reduce((s, x) => s + Math.max(0, Number(x.economics.cap ?? 0) - x.returned), 0) };
  } else {
    detail = { partners: ivts.map((x) => ({ investor: nameOf(x.investorId), capital: x.received, commercialRights: String(x.economics.commercialRights ?? "—"), partnership: String(x.economics.partnership ?? "—"), marketExpansion: String(x.economics.marketExpansion ?? "—"), integrations: String(x.economics.integrations ?? "—"), status: x.status })) };
  }
  return { capitalType: t, ccy: ledgerCcy(t), balances, detail, entries: es };
}
/** Returns, repayments and revenue share are booked by finance; posted directly (they reduce outstanding, never inflate available except POWER). */
export function bookReturn(input: { capitalType: CapitalType; investmentId: string; kind: "RETURN" | "REPAYMENT" | "REVENUE_SHARE"; amount: number; memo: string }, actor: string): Result<CapitalLedgerEntry> {
  const ivt = investments.get(input.investmentId);
  if (!ivt || ivt.capitalType !== input.capitalType) return fail("not_found", "Investment not found on this ledger.", 404);
  const amount = num(input.amount);
  if (amount <= 0) return fail("bad_amount", "Amount must be positive.");
  const e = post({ capitalType: input.capitalType, kind: input.kind, amount, ccy: ivt.ccy, investorId: ivt.investorId, investmentId: ivt.id, ref: ivt.id, memo: clean(input.memo, 200), actor });
  ivt.returned += amount; ivt.status = "RETURNING"; ivt.history.push(ev(actor, `${input.kind} ${amount} ${ivt.ccy}`)); ivt.updatedAt = now(); touch("capital_investments");
  return okv(e);
}
export function proposeAdjustment(input: { capitalType: CapitalType; amount: number; memo: string; investorId?: string }, actor: string): Result<CapitalLedgerEntry> {
  if (!(input.capitalType in CAPITAL_TYPE_LABEL)) return fail("bad_type", "Unknown capital type.");
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount === 0) return fail("bad_amount", "A non-zero amount is required.");
  const memo = clean(input.memo, 200);
  if (memo.length < 5) return fail("bad_memo", "Explain the adjustment (≥5 characters).");
  const e: CapitalLedgerEntry & { proposedBy: string } = { id: id("adj"), at: now(), capitalType: input.capitalType, kind: "ADJUSTMENT", amount, ccy: ledgerCcy(input.capitalType), investorId: input.investorId, ref: "adjustment", memo, actor, proposedBy: actor };
  pendingAdjustments.set(e.id, e); touch("capital_pending_adjustments");
  notifyCapital("APPROVAL_REQUIRED", `Ledger adjustment to approve (${CAPITAL_TYPE_LABEL[e.capitalType]})`, `${amount} ${e.ccy} — ${memo}`, `/capital/${ledgerPath(e.capitalType)}`);
  return okv(e);
}
export function pendingAdjustmentsFor(t?: CapitalType): Array<CapitalLedgerEntry & { proposedBy: string }> { return [...pendingAdjustments.values()].filter((e) => !t || e.capitalType === t); }
export function decideAdjustment(aid: string, approve: boolean, actor: string): Result<CapitalLedgerEntry | null> {
  const e = pendingAdjustments.get(aid);
  if (!e) return fail("not_found", "Adjustment not found.", 404);
  if (e.proposedBy === actor) return fail("four_eyes", "The person who proposed the adjustment cannot approve it.", 409);
  pendingAdjustments.delete(aid); touch("capital_pending_adjustments");
  if (!approve) return okv(null);
  const { proposedBy, ...rest } = e;
  const posted = post({ ...rest, memo: `${rest.memo} (proposed by ${proposedBy}, approved by ${actor})`, approvedBy: actor });
  return okv(posted);
}

/* ---------- documents ---------- */
export function listDocuments(): CapitalDocument[] { return [...documents.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function getDocument(did: string): CapitalDocument | undefined { return documents.get(did); }
export function createDocument(input: { title: string; category: DocumentCategory; type: string; investorId?: string; investmentId?: string; termSheetId?: string; access?: CapitalDocument["access"]; body?: string; expiresAt?: string }, actor: string): Result<CapitalDocument> {
  const title = clean(input.title, 160);
  if (title.length < 3) return fail("bad_title", "A title is required.");
  const prior = [...documents.values()].filter((d) => d.investorId === input.investorId && d.type === input.type && d.title === title);
  for (const d of prior) if (d.status === "DRAFT" || d.status === "ISSUED") { d.status = "VOID"; d.history.push(ev(actor, "Superseded by a new version")); }
  const doc: CapitalDocument = { id: id("doc"), title, category: input.category, type: clean(input.type, 40) || "GENERIC", status: "DRAFT", version: prior.length + 1, investorId: input.investorId, investmentId: input.investmentId, termSheetId: input.termSheetId, createdAt: now(), expiresAt: input.expiresAt, access: input.access ?? ["MANAGEMENT"], body: cleanText(input.body ?? "", 20000), history: [ev(actor, `Document created (v${prior.length + 1})`)] };
  documents.set(doc.id, doc); touch("capital_documents");
  return okv(doc);
}
/** Investor signature from the room: typed name + hash of the exact body. */
export function signDocument(did: string, name: string, user: string): Result<CapitalDocument> {
  const d = documents.get(did);
  if (!d) return fail("not_found", "Document not found.", 404);
  if (d.status !== "AWAITING_SIGNATURE") return fail("not_signable", "This document is not awaiting your signature.", 409);
  const signer = clean(name, 80);
  if (signer.length < 3) return fail("bad_name", "Type your full name to sign.");
  d.signature = { name: signer, user, at: now(), bodyHash: createHash("sha256").update(d.body, "utf8").digest("hex") };
  d.status = "SIGNED"; d.signedAt = d.signature.at; d.history.push(ev(user, `Signed by ${signer}`, `sha256 ${d.signature.bodyHash.slice(0, 16)}…`)); touch("capital_documents");
  return okv(d);
}
export function setDocumentStatus(did: string, status: CapitalDocument["status"], actor: string): Result<CapitalDocument> {
  const d = documents.get(did);
  if (!d) return fail("not_found", "Document not found.", 404);
  d.history.push(ev(actor, `Status ${d.status} → ${status}`)); d.status = status;
  if (status === "SIGNED") d.signedAt = now();
  if (status === "AWAITING_SIGNATURE") notifyCapital("DOCUMENT_ACTION", `Signature required: ${d.title}`, `Sent by ${actor}.`, `/investors/${d.investorId ?? ""}/documents`);
  touch("capital_documents");
  return okv(d);
}
function renderTermSheet(t: TermSheet): string {
  const inv = investors.get(t.investorId);
  const lines = [`${CAPITAL_TYPE_LABEL[t.capitalType].toUpperCase()} TERM SHEET`, `Investor: ${inv?.name ?? t.investorId}`, `Amount: ${t.amount} ${t.ccy}`, `Capital type: ${t.capitalType} (${CAPITAL_TYPE_LABEL[t.capitalType]})`, ""];
  for (const [k, v] of Object.entries(t.terms)) lines.push(`${k}: ${v}`);
  lines.push("", "This term sheet is non-binding until executed after legal review.", `Generated ${now()} — ${t.id}`);
  return lines.join("\n");
}

/* ---------- campaigns ---------- */
export function listCampaigns(): Campaign[] { return [...campaigns.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function createCampaign(input: { name: string; capitalType: CapitalType; target: number; ccy?: Ccy; targetDate: string; requirementId?: string; opportunityId?: string }, actor: string): Result<Campaign> {
  const name = clean(input.name);
  if (name.length < 2) return fail("bad_name", "A campaign name is required.");
  if (!(input.capitalType in CAPITAL_TYPE_LABEL)) return fail("bad_type", "Unknown capital type.");
  const c: Campaign = { id: id("camp"), name, capitalType: input.capitalType, requirementId: input.requirementId, opportunityId: input.opportunityId, target: num(input.target), ccy: input.ccy ?? "USD", committed: 0, received: 0, expected: 0, targetDate: clean(input.targetDate, 20), status: "DRAFT", createdAt: now(), updatedAt: now(), history: [ev(actor, "Campaign created")] };
  campaigns.set(c.id, c); touch("capital_campaigns");
  recomputeCampaign(c.id);
  return okv(c);
}
export function setCampaignStatus(cid: string, status: Campaign["status"], actor: string): Result<Campaign> {
  const c = campaigns.get(cid);
  if (!c) return fail("not_found", "Campaign not found.", 404);
  c.history.push(ev(actor, `Status ${c.status} → ${status}`)); c.status = status; c.updatedAt = now(); touch("capital_campaigns");
  return okv(c);
}
function recomputeCampaign(cid: string): void {
  const c = campaigns.get(cid); if (!c) return;
  const ivts = [...investments.values()].filter((x) => c.opportunityId && x.opportunityId === c.opportunityId);
  c.committed = ivts.reduce((s, x) => s + x.committed, 0);
  c.received = ivts.reduce((s, x) => s + x.received, 0);
  const props = [...proposals.values()].filter((p) => c.opportunityId && p.opportunityId === c.opportunityId && (p.status === "SENT" || p.status === "VIEWED"));
  c.expected = c.committed + props.reduce((s, p) => s + p.amount * 0.5, 0);
  if (c.target > 0 && c.received >= c.target && c.status === "FUNDING") c.status = "TARGET_REACHED";
  c.updatedAt = now(); touch("capital_campaigns");
}

/* ---------- helpers for the engine / portal ---------- */
export function proposalsFor(iid: string): Proposal[] { return [...proposals.values()].filter((p) => p.investorId === iid); }
export function termSheetsFor(iid: string): TermSheet[] { return [...termSheets.values()].filter((t) => t.investorId === iid); }
export function investmentsFor(iid: string): Investment[] { return [...investments.values()].filter((x) => x.investorId === iid); }
export function documentsFor(iid: string): CapitalDocument[] { return [...documents.values()].filter((d) => d.investorId === iid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function ledgerEntriesFor(iid: string): CapitalLedgerEntry[] { return ledger.filter((e) => e.investorId === iid).sort((a, b) => b.at.localeCompare(a.at)); }
export function fundingFor(iid: string): FundingEvent[] { return [...funding.values()].filter((f) => f.investorId === iid); }
/** The complete audit trail of who did what, when and why — across every capital record. */
export function auditTrail(limit = 300): Array<AuditEvent & { record: string; recordId: string }> {
  const out: Array<AuditEvent & { record: string; recordId: string }> = [];
  for (const i of investors.values()) for (const e of i.activity) out.push({ ...e, record: "Investor", recordId: i.id });
  for (const o of opportunities.values()) for (const e of o.history) out.push({ ...e, record: "Opportunity", recordId: o.id });
  for (const p of proposals.values()) for (const e of p.history) out.push({ ...e, record: "Proposal", recordId: p.id });
  for (const t of termSheets.values()) for (const e of t.history) out.push({ ...e, record: "Term sheet", recordId: t.id });
  for (const x of investments.values()) for (const e of x.history) out.push({ ...e, record: "Investment", recordId: x.id });
  for (const f of funding.values()) for (const e of f.history) out.push({ ...e, record: "Funding", recordId: f.id });
  for (const a of allocations.values()) for (const e of a.history) out.push({ ...e, record: "Allocation", recordId: a.id });
  for (const d of documents.values()) for (const e of d.history) out.push({ ...e, record: "Document", recordId: d.id });
  for (const c of campaigns.values()) for (const e of c.history) out.push({ ...e, record: "Campaign", recordId: c.id });
  for (const e of ledger) out.push({ at: e.at, actor: e.actor, action: `${e.capitalType} ledger ${e.kind} ${e.amount} ${e.ccy}`, note: e.memo, record: "Ledger", recordId: e.id });
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
/** Test/reset hook — never exposed over HTTP. */
export function _resetInvestorOs(): void {
  for (const m of [investors, opportunities, proposals, termSheets, investments, funding, allocations, pendingAdjustments, documents, campaigns]) m.clear();
  ledger.length = 0; messages.length = 0; notifications.length = 0;
}
