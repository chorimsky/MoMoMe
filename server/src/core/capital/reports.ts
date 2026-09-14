/* ============================================================
   Reports (generated from the engine + records, kept for the audit) and the
   investor PORTAL projection — the strictly limited view an investor gets of
   their own records. No internal intelligence ever crosses into the portal.
   ============================================================ */
import { registerRows as register, touchRows as touch } from "./rows.js";
import { id } from "../ids.js";
import type { Report, ReportKind, Period, PortalDashboard, Investor, Source } from "../../../../shared/capital.js";
import { REPORT_KINDS, CAPITAL_TYPE_LABEL } from "../../../../shared/capital.js";
import * as engine from "./engine.js";
import * as inv from "./investors.js";
import { listRecommendations, listRequirements } from "./workflow.js";
import { auditLog } from "./copilot.js";

const reports = new Map<string, Report>();
register("capital_reports", () => [...reports.values()].slice(-200), (rows: Report[]) => { reports.clear(); for (const r of rows ?? []) reports.set(r.id, r); });
export function listReports(): Report[] { return [...reports.values()].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt)); }
export function getReport(rid: string): Report | undefined { return reports.get(rid); }

const n = (v: number) => Math.round(v).toLocaleString("en-US").replace(/,/g, " ");
const money = (v: number, ccy: string) => `${n(v)} ${ccy}`;
type Rows = Array<[string, string]>;

export async function generate(kind: ReportKind, period: Period, by: string, opts: { investorId?: string } = {}): Promise<Report> {
  const meta = REPORT_KINDS.find((k) => k.kind === kind);
  if (!meta) throw new Error("unknown_report");
  const f = { period };
  const sections: Report["sections"] = []; let sources: Source[] = [];
  if (kind === "EXECUTIVE_CAPITAL") {
    const ov = await engine.overview(f); sources = ov.sources;
    sections.push({ title: "Transaction volume", rows: [["Current period", money(ov.volume.current, "XAF")], ["Previous period", money(ov.volume.previous, "XAF")], ["Growth", ov.volume.growthPct == null ? "n/a" : `${ov.volume.growthPct}%`], ["Payments", String(ov.volume.count)]] });
    sections.push({ title: "Revenue", rows: [["Gross", money(ov.revenue.gross, "XAF")], ["Costs", money(ov.revenue.costs, "XAF")], ["Net", money(ov.revenue.net, "XAF")], ["Margin", ov.revenue.marginPct == null ? "n/a" : `${ov.revenue.marginPct}%`]] });
    sections.push({ title: "Liquidity", rows: [["Available", money(ov.liquidity.available, "XAF")], ["Required (30d)", money(ov.liquidity.required, "XAF")], ["Gap", money(ov.liquidity.gap, "XAF")], ["Coverage", String(ov.liquidity.coverageRatio ?? "n/a")]], note: ov.liquidity.basis });
    sections.push({ title: "Capital (USD)", rows: [["Committed", money(ov.capital.committed, "USD")], ["Received", money(ov.capital.received, "USD")], ["Deployed", money(ov.capital.deployed, "USD")], ["Available", money(ov.capital.available, "USD")]] });
    sections.push({ title: "Capital requirement", rows: [["Current requirement", money(ov.requirement.current, "XAF")], ["Available capital", money(ov.requirement.availableCapital, "XAF")], ["Funding gap", money(ov.requirement.fundingGap, "XAF")], ["Urgency", ov.requirement.urgency]] });
  } else if (kind === "LIQUIDITY") {
    const l = await engine.liquidity(f); sources = l.sources;
    sections.push({ title: "Position", rows: [["Total capacity", money(l.total, "XAF")], ["Available", money(l.available, "XAF")], ["Reserve", money(l.reserved, "XAF")], ["Idle", money(l.idle, "XAF")], ["Utilisation", `${l.utilizationPct ?? "n/a"}%`], ["Turnover", String(l.turnover ?? "n/a")], ["Gap", money(l.gap, "XAF")]], note: l.basis });
    sections.push({ title: "Stress coverage", rows: (Object.keys(l.stress) as Array<keyof typeof l.stress>).map((k) => [k, `coverage ${l.stress[k].coverageRatio ?? "n/a"} · gap ${money(l.stress[k].gap, "XAF")} · ${l.stress[k].riskLevel}`]) });
    sections.push({ title: "By rail", rows: l.byRail.map((r) => [r.label, `${money(r.required, "XAF")} required`]) });
  } else if (kind === "INVESTOR") {
    const list = inv.listInvestors().filter((i) => !opts.investorId || i.id === opts.investorId); sources = [{ kind: "investors", ref: "investors", label: "Investor records" }];
    const byStage = new Map<string, number>(); for (const i of list) byStage.set(i.stage, (byStage.get(i.stage) ?? 0) + 1);
    sections.push({ title: "Pipeline", rows: [...byStage.entries()].map(([s, c]) => [s, String(c)]) as Rows });
    sections.push({ title: "KYC", rows: [["Approved", String(list.filter((i) => i.kyc.status === "APPROVED").length)], ["Submitted / in review", String(list.filter((i) => i.kyc.status === "SUBMITTED" || i.kyc.status === "IN_REVIEW").length)], ["Not started", String(list.filter((i) => i.kyc.status === "NOT_STARTED").length)]] });
    sections.push({ title: "Capital", rows: [["Committed", money(list.reduce((s, i) => s + i.committed, 0), "USD")], ["Invested", money(list.reduce((s, i) => s + i.invested, 0), "USD")]] });
    sections.push({ title: "Investors", rows: list.map((i) => [i.name, `${i.type} · ${i.stage} · KYC ${i.kyc.status} · committed ${money(i.committed, i.ccy)}`]) });
  } else if (kind === "CAPITAL_REQUIREMENT") {
    const reqs = await engine.requirements(f); sources = reqs.flatMap((r) => r.sources).slice(0, 6);
    for (const r of reqs) sections.push({ title: `${r.id} — ${r.purpose}`, rows: [["Type", CAPITAL_TYPE_LABEL[r.capitalType]], ["Amount", money(r.amount, r.ccy)], ["Available", money(r.currentAvailable, r.ccy)], ["Gap", money(r.fundingGap, r.ccy)], ["Urgency", r.urgency], ["Status", r.status], ["Target", r.targetDate], ...r.calculation.steps.map((s) => [`  ${s.label}`, money(s.value, s.ccy ?? r.ccy)] as [string, string])], note: r.calculation.formula });
  } else if (kind === "FUNDRAISING") {
    const fr = await engine.fundraising(); sources = fr.sources;
    sections.push({ title: "Campaigns", rows: fr.campaigns.map((c) => [c.name, `${c.status} · target ${money(c.target, c.ccy)} · committed ${money(c.committed, c.ccy)} · received ${money(c.received, c.ccy)}`]) });
    sections.push({ title: "Funnel", rows: fr.funnel.stages.map((s) => [s.label, `${s.investors} investors · ${money(s.capital, fr.funnel.ccy)}`]), note: `Pipeline coverage ${fr.pipelineCoveragePct ?? "n/a"}%` });
  } else if (kind === "CAPITAL_EFFICIENCY") {
    const e = await engine.efficiency(f); sources = e.sources;
    sections.push({ title: "By capital type", rows: e.byCapitalType.map((r) => [r.label, `turnover ${r.turnover ?? "n/a"} · utilisation ${r.utilizationPct ?? "n/a"}% · idle ${money(r.idle, "XAF")}`]) });
    sections.push({ title: "By rail", rows: e.byRail.map((r) => [r.label, `turnover ${r.turnover ?? "n/a"} · revenue/capital ${r.revenuePerCapital ?? "n/a"}`]) });
    sections.push({ title: "Findings", rows: [["Most efficient", e.findings.mostEfficient ?? "—"], ["Least efficient", e.findings.leastEfficient ?? "—"], ["Underutilised", e.findings.underutilized.join(", ") || "—"], ["Bottlenecks", e.findings.bottlenecks.join(", ") || "—"]] });
  } else if (kind === "RISK") {
    const r = await engine.risk(f); sources = r.sources;
    sections.push({ title: `Overall: ${r.overall}`, rows: r.items.map((i) => [i.category.replace(/_/g, " "), `${i.level} · ${i.score}/100 · ${i.trend} — ${i.drivers.join("; ")}`]) });
  } else if (kind === "AI_INTELLIGENCE") {
    const recs = listRecommendations(); const log = auditLog(); sources = [{ kind: "recommendation", ref: "recommendations", label: "Recommendations" }];
    sections.push({ title: "Recommendations", rows: recs.map((x) => [x.id, `${x.type} · ${x.status} · ${x.title}`]) });
    sections.push({ title: "Copilot audit", rows: log.slice(0, 50).map((a) => [a.at.slice(0, 16).replace("T", " "), `${a.user}: ${a.question} → ${a.intent} (${a.confidence})`]) });
  } else if (kind === "AUDIT") {
    const trail = inv.auditTrail(500); sources = [{ kind: "investors", ref: "audit", label: "Capital audit trail" }];
    sections.push({ title: "Who did what, when", rows: trail.map((e) => [e.at.slice(0, 16).replace("T", " "), `${e.actor} · ${e.record} ${e.recordId} · ${e.action}${e.note ? ` — ${e.note}` : ""}`]) });
    sections.push({ title: "Requirements", rows: listRequirements().flatMap((r) => r.history.map((h) => [h.at.slice(0, 16).replace("T", " "), `${h.actor} · ${r.id} · ${h.action}`] as [string, string])) });
  }
  const rep: Report = { id: id("rep"), kind, title: meta.title, period, generatedAt: new Date().toISOString(), generatedBy: by, sections, sources };
  reports.set(rep.id, rep); touch("capital_reports");
  return rep;
}
export function csv(rep: Report): string {
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  const lines = [["section", "label", "value"].map(esc).join(",")];
  for (const s of rep.sections) for (const [k, v] of s.rows) lines.push([s.title, k, v].map(esc).join(","));
  return lines.join("\n");
}

/* ---------- investor portal projection ---------- */
export function portalFor(investor: Investor): PortalDashboard {
  const ivts = inv.investmentsFor(investor.id);
  const opps = new Map(inv.listOpportunities().map((o) => [o.id, o]));
  const docs = inv.documentsFor(investor.id).filter((d) => d.access.includes("INVESTOR") && d.status !== "VOID" && d.status !== "DRAFT");
  const perf = (x: (typeof ivts)[number]): Record<string, string | number> => {
    if (x.capitalType === "OWN") return { ownershipPct: Number(x.economics.ownershipPct ?? 0), round: String(x.economics.round ?? "—") };
    if (x.capitalType === "POWER") return { deployed: x.deployed, returned: x.returned, returnPct: Number(x.economics.returnPct ?? 0) };
    if (x.capitalType === "SCALE") return { participationPct: Number(x.economics.revenueSharePct ?? 0), cap: Number(x.economics.cap ?? 0), repaid: x.returned, outstandingToCap: Math.max(0, Number(x.economics.cap ?? 0) - x.returned) };
    return { partnership: String(x.economics.partnership ?? "—") };
  };
  return {
    investor: { id: investor.id, name: investor.name, type: investor.type, country: investor.country, stage: investor.stage, ccy: investor.ccy, createdAt: investor.createdAt },
    kycStatus: investor.kyc.status,
    totals: { invested: ivts.reduce((s, x) => s + x.received, 0), active: ivts.filter((x) => ["FUNDED", "ALLOCATED", "ACTIVE", "RETURNING", "PARTIALLY_FUNDED"].includes(x.status)).length, returned: ivts.reduce((s, x) => s + x.returned, 0), outstanding: ivts.reduce((s, x) => s + Math.max(0, x.received - x.returned), 0), ccy: investor.ccy },
    investments: ivts.map((x) => ({ id: x.id, capitalType: x.capitalType, committed: x.committed, received: x.received, deployed: x.deployed, returned: x.returned, status: x.status, ccy: x.ccy, createdAt: x.createdAt, opportunityName: opps.get(x.opportunityId)?.name ?? "—", performance: perf(x) })),
    documents: docs.map((d) => ({ id: d.id, title: d.title, type: d.type, status: d.status, version: d.version, createdAt: d.createdAt, signedAt: d.signedAt, expiresAt: d.expiresAt, signature: d.signature })),
    documentsRequiringAction: docs.filter((d) => d.status === "AWAITING_SIGNATURE").length,
    transactions: inv.ledgerEntriesFor(investor.id).map((e) => ({ id: e.id, at: e.at, kind: e.kind, amount: e.amount, ccy: e.ccy, ref: e.ref, memo: e.memo })),
    reports: listReports().filter((r) => r.kind === "INVESTOR" && r.sections.some((s) => s.title === "Investors" && s.rows.some((row) => row[0] === investor.name))).map((r) => ({ id: r.id, kind: r.kind, title: r.title, period: r.period, generatedAt: r.generatedAt })),
    messages: inv.messagesFor(investor.id).filter((m) => m.channel !== "NOTE"),
    proposals: inv.proposalsFor(investor.id).filter((p) => p.status !== "SUPERSEDED" && p.status !== "DRAFT").map((p) => { inv.markProposalViewed(p.id); return { id: p.id, amount: p.amount, ccy: p.ccy, capitalType: p.capitalType, terms: p.terms, status: p.status === "SENT" ? "VIEWED" as const : p.status, counter: p.counter, createdAt: p.createdAt, updatedAt: p.updatedAt, opportunityName: opps.get(p.opportunityId)?.name ?? "—" }; }),
    opportunities: inv.listOpportunities().filter((o) => o.status === "OPEN" || o.status === "FUNDING").map((o) => ({ id: o.id, name: o.name, capitalType: o.capitalType, target: o.target, raised: o.raised, ccy: o.ccy, minTicket: o.minTicket, termMonths: o.termMonths, status: o.status, description: o.description })),
  };
}
