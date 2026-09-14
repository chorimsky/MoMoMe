/* ============================================================
   AI Capital Copilot — the natural-language front on the STRUCTURED engine.

     Question → intent → engine call(s) → verified numbers → explanation

   The model (when one is configured) only phrases what the engine computed;
   it is handed the numbers and forbidden to add any. With no model the
   explanation is templated from the same facts. Either way the answer
   carries metrics, assumptions, sources, calculation refs, confidence and
   data freshness — and every exchange is written to the AI audit log.
   The copilot cannot execute anything: at most it points at an existing
   recommendation, which still needs a person to review and another to approve.
   ============================================================ */
import { registerRows as register, touchRows as touch } from "./rows.js";
import { id } from "../ids.js";
import { structured, metaAiConfigured } from "../../adapters/metaAi.js";
import type { CopilotAnswer, CopilotAuditEntry, Calculation, Source, Confidence, IntelFilters } from "../../../../shared/capital.js";
import { CAPITAL_TYPE_LABEL } from "../../../../shared/capital.js";
import * as engine from "./engine.js";
import { listRecommendations } from "./workflow.js";

const audit: CopilotAuditEntry[] = [];
register("capital_ai_audit", () => audit.slice(0, 1000), (rows: CopilotAuditEntry[]) => { audit.length = 0; audit.push(...(rows ?? [])); audit.sort((a, b) => b.at.localeCompare(a.at)); });
export function auditLog(): CopilotAuditEntry[] { return audit; }
export function recordAction(answerId: string, phase: "requested" | "approved" | "executed", action: string): void {
  const e = audit.find((a) => a.id === answerId); if (!e) return;
  (phase === "requested" ? e.requestedActions : phase === "approved" ? e.approvedActions : e.executedActions).push(action);
  touch("capital_ai_audit");
}

type Intent = "liquidity_need" | "biggest_risk" | "contact_investors" | "volume_scenario" | "efficient_route" | "underutilized_capital" | "prioritize_requirement" | "revenue" | "forecast" | "capital_position" | "unknown";
const INTENTS: Array<[Intent, RegExp]> = [
  ["contact_investors", /\b(which|what|who)\b.*\binvestors?\b|\bcontact\b|\breach out\b|\bfollow.?up\b/i],
  ["volume_scenario", /\b(what if|happens if|if .*grows?|increase[sd]? by|\d+\s?%)/i],
  ["efficient_route", /\broute\b|\brail\b.*\befficien|\befficien.*\b(route|rail)\b/i],
  ["underutilized_capital", /\bunderutili[sz]ed\b|\bidle\b|\bunused\b/i],
  ["prioritize_requirement", /\bpriorit|\bwhich (capital )?requirement\b|\bfirst\b.*\brequirement/i],
  ["biggest_risk", /\brisk/i],
  ["liquidity_need", /\bliquidity\b|\bfloat\b|\bhow much (capital|money|cash)\b|\bneed\b/i],
  ["revenue", /\brevenue\b|\bmargin\b|\bprofit/i],
  ["forecast", /\bforecast\b|\bpredict|\bexpect(ed)?\b|\bnext (30|90|180|365) days\b/i],
  ["capital_position", /\bcapital\b|\bposition\b|\bcommitted\b|\bdeployed\b/i],
];
export function classify(q: string): Intent { for (const [i, re] of INTENTS) if (re.test(q)) return i; return "unknown"; }
const horizonOf = (q: string): 30 | 90 | 180 | 365 => { const m = q.match(/\b(30|90|180|365)\b/); return m ? (Number(m[1]) as 30 | 90 | 180 | 365) : 90; };
const pctOf = (q: string): number => { const m = q.match(/(\d{1,3})\s?%/); return m ? Number(m[1]) : 50; };
const n = (v: number) => Math.round(v).toLocaleString("en-US").replace(/,/g, " ");

interface Facts { intent: Intent; answer: string; metrics: CopilotAnswer["metrics"]; assumptions: string[]; sources: Source[]; calculations: Calculation[]; confidence: Confidence; dataUpdatedAt: string; suggestedActions: CopilotAnswer["suggestedActions"]; engineResult: Record<string, unknown> }

async function gather(q: string, f: IntelFilters): Promise<Facts> {
  const intent = classify(q);
  const recs = listRecommendations().filter((r) => r.status === "CREATED" || r.status === "REVIEWED");
  const suggest = (type: string) => recs.filter((r) => r.type === type).slice(0, 3).map((r) => ({ recommendationId: r.id, label: r.title }));
  switch (intent) {
    case "liquidity_need": {
      const h = horizonOf(q);
      const fc = await engine.forecasts(f); const liq = await engine.liquidity(f);
      const lr = fc.forecasts.find((x) => x.metric === "liquidityRequirement")!; const pt = lr.horizons[h];
      return { intent, answer: `Over the next ${h} days the engine projects a liquidity requirement of ${n(pt.expected)} XAF (80% band ${n(pt.lower)}–${n(pt.upper)}). The float available today is ${n(liq.available)} XAF, so the gap on the 30-day basis is ${n(liq.gap)} XAF${liq.gap > 0 ? " — coverage is short" : " — covered"}.`, metrics: [{ label: `Required (${h}d, expected)`, value: pt.expected, ccy: "XAF" }, { label: "Lower bound", value: pt.lower, ccy: "XAF" }, { label: "Upper bound", value: pt.upper, ccy: "XAF" }, { label: "Available now", value: liq.available, ccy: "XAF" }, { label: "Gap (30d)", value: liq.gap, ccy: "XAF" }], assumptions: [lr.method, `Basis: ${lr.basis.observations} active days of ${lr.basis.days}`, `Float basis: ${liq.basis}`], sources: [...liq.sources, ...fc.sources.slice(0, 1)], calculations: [liq.stress.NORMAL.calculation], confidence: pt.confidence, dataUpdatedAt: liq.freshness.dataAsOf, suggestedActions: [...suggest("REVIEW_LIQUIDITY"), ...suggest("RAISE_CAPITAL")], engineResult: { horizon: h, point: pt, available: liq.available, gap: liq.gap } };
    }
    case "biggest_risk": {
      const rk = await engine.risk(f); const top = [...rk.items].sort((a, b) => b.score - a.score)[0];
      return { intent, answer: `The biggest capital risk right now is ${top.category.replace(/_/g, " ")} (${top.level}, score ${top.score}/100) affecting ${top.affectedArea}. Drivers: ${top.drivers.join("; ")}. Suggested action: ${top.recommendedAction}`, metrics: rk.items.map((i) => ({ label: i.category.replace(/_/g, " "), value: `${i.level} · ${i.score}` })), assumptions: ["Scores are rule-based on measured ratios; see each risk's drivers."], sources: rk.sources, calculations: [], confidence: rk.freshness.sampleSize >= 10 ? "MEDIUM" : "LOW", dataUpdatedAt: rk.freshness.dataAsOf, suggestedActions: recs.slice(0, 3).map((r) => ({ recommendationId: r.id, label: r.title })), engineResult: { overall: rk.overall, top } };
    }
    case "contact_investors": {
      const reqs = (await engine.requirements(f)).filter((r) => r.fundingGap > 0 && !["FUNDED", "ALLOCATED", "CLOSED"].includes(r.status)).sort((a, b) => b.fundingGap - a.fundingGap);
      if (!reqs[0]) return { intent, answer: "There is no open capital requirement with a funding gap, so no investor outreach is indicated by the engine. Overdue follow-ups, if any, appear under Recommendations.", metrics: [], assumptions: [], sources: [{ kind: "requirement", ref: "none", label: "Capital requirements" }], calculations: [], confidence: "HIGH", dataUpdatedAt: new Date().toISOString(), suggestedActions: suggest("FOLLOW_UP_INVESTOR"), engineResult: {} };
      const m = await engine.matching(reqs[0].id);
      const top = (m?.matches ?? []).slice(0, 5);
      return { intent, answer: top.length ? `For ${reqs[0].id} (${CAPITAL_TYPE_LABEL[reqs[0].capitalType]}, gap ${n(reqs[0].fundingGap)} ${reqs[0].ccy}) the best-fit investors are: ${top.map((t) => `${t.name} (fit ${t.fitScore}/100, close probability ${t.closeProbabilityPct}%, expected ${n(t.expectedCapital)} USD)`).join("; ")}. Fit and close probability are separate measures — a high fit with a low close probability means the profile matches but the relationship is early.` : `No investor records match ${reqs[0].id} yet — add investors with their capital-type preferences to get a ranked list.`, metrics: top.map((t) => ({ label: t.name, value: `fit ${t.fitScore} · close ${t.closeProbabilityPct}%` })), assumptions: ["Close probability uses the stage base rate and contact recency; it is not a commitment."], sources: m?.sources ?? [], calculations: top.map((t) => t.calculation), confidence: top.length >= 3 ? "MEDIUM" : "LOW", dataUpdatedAt: m?.freshness.dataAsOf ?? new Date().toISOString(), suggestedActions: [...suggest("FOLLOW_UP_INVESTOR"), ...suggest("RAISE_CAPITAL")], engineResult: { requirementId: reqs[0].id, top } };
    }
    case "volume_scenario": {
      const p = pctOf(q); const sc = await engine.scenarios(f, { volumeMultiplier: 1 + p / 100 }); const c = sc.scenarios.find((x) => x.name === "CUSTOM")!, b = sc.scenarios.find((x) => x.name === "BASE")!;
      return { intent, answer: `If transaction volume grows ${p}% over 90 days: liquidity requirement ${n(c.d90.liquidityRequirement)} XAF (+${n(c.d90.liquidityRequirement - b.d90.liquidityRequirement)} vs base), capital requirement ${n(c.d90.capitalRequirement)} XAF (+${n(c.d90.capitalRequirement - b.d90.capitalRequirement)}), projected funding gap ${n(c.d90.fundingGap)} XAF. Net revenue would be about ${n(c.d90.revenue)} XAF over the 90 days.`, metrics: [{ label: "Liquidity requirement", value: c.d90.liquidityRequirement, ccy: "XAF" }, { label: "Capital requirement", value: c.d90.capitalRequirement, ccy: "XAF" }, { label: "Funding gap", value: c.d90.fundingGap, ccy: "XAF" }, { label: "Net revenue (90d)", value: c.d90.revenue, ccy: "XAF" }], assumptions: [`Volume × ${1 + p / 100}; margin, settlement and failure rate as in the BASE scenario.`], sources: sc.sources, calculations: [c.calculation], confidence: "MEDIUM", dataUpdatedAt: sc.freshness.dataAsOf, suggestedActions: suggest("RAISE_CAPITAL"), engineResult: { pct: p, custom: c.d90, base: b.d90 } };
    }
    case "efficient_route": {
      const rt = await engine.routes(f); const ranked = rt.routes.filter((r) => r.capitalEfficiency != null).sort((a, b) => (b.capitalEfficiency ?? 0) - (a.capitalEfficiency ?? 0));
      return { intent, answer: ranked.length ? `The most capital-efficient route is ${ranked[0].name}: ${ranked[0].capitalEfficiency}× volume per XAF of liquidity it ties up, ${ranked[0].marginPct ?? 0}% margin, ${ranked[0].successRatePct ?? 0}% success on ${ranked[0].count} payments.${ranked.length > 1 ? ` Least efficient: ${ranked[ranked.length - 1].name} (${ranked[ranked.length - 1].capitalEfficiency}×).` : ""}` : "No completed payments in the period, so no route can be ranked yet.", metrics: ranked.slice(0, 5).map((r) => ({ label: r.name, value: `${r.capitalEfficiency}× · ${r.marginPct ?? 0}%` })), assumptions: ["Liquidity requirement is apportioned to routes by their share of volume."], sources: rt.sources, calculations: [], confidence: ranked.length ? "MEDIUM" : "LOW", dataUpdatedAt: rt.freshness.dataAsOf, suggestedActions: suggest("REVIEW_ROUTE"), engineResult: { ranked: ranked.slice(0, 5) } };
    }
    case "underutilized_capital": {
      const eff = await engine.efficiency(f);
      return { intent, answer: eff.findings.underutilized.length ? `Underutilised capital: ${eff.findings.underutilized.join(", ")}. ${eff.byCapitalType.filter((r) => r.idle > 0).map((r) => `${r.label}: ${n(r.idle)} XAF equiv. idle`).join("; ")}.` : "No capital pool is below 30% utilisation in this period.", metrics: eff.byCapitalType.map((r) => ({ label: r.label, value: `${r.utilizationPct ?? 0}% · idle ${n(r.idle)}` })), assumptions: ["Utilisation = min(volume supported, capital) ÷ capital; capital converted at today's USD/XAF."], sources: eff.sources, calculations: [], confidence: "MEDIUM", dataUpdatedAt: eff.freshness.dataAsOf, suggestedActions: suggest("REDUCE_IDLE_CAPITAL"), engineResult: eff.findings };
    }
    case "prioritize_requirement": {
      const reqs = (await engine.requirements(f)).filter((r) => !["FUNDED", "ALLOCATED", "CLOSED"].includes(r.status)); const order = ["LOW", "MEDIUM", "HIGH", "CRITICAL"]; const top = [...reqs].sort((a, b) => order.indexOf(b.urgency) - order.indexOf(a.urgency) || b.fundingGap - a.fundingGap)[0];
      return { intent, answer: top ? `Prioritise ${top.id} — ${top.purpose} (${CAPITAL_TYPE_LABEL[top.capitalType]}): ${top.urgency} urgency, gap ${n(top.fundingGap)} ${top.ccy}, target ${top.targetDate}, status ${top.status}.` : "There are no open capital requirements.", metrics: reqs.map((r) => ({ label: r.id, value: `${r.urgency} · gap ${n(r.fundingGap)} ${r.ccy}` })), assumptions: ["Ranked by urgency, then by gap."], sources: top ? top.sources : [], calculations: top ? [top.calculation] : [], confidence: top?.confidence ?? "HIGH", dataUpdatedAt: new Date().toISOString(), suggestedActions: suggest("RAISE_CAPITAL"), engineResult: { top } };
    }
    case "revenue": {
      const rv = await engine.revenue(f); const t = rv.totals;
      return { intent, answer: `Gross revenue ${n(t.gross)} XAF on ${n(t.volume)} XAF volume; provider costs ${n(t.providerCosts)}, settlement costs ${n(t.settlementCosts)}; net ${n(t.net)} XAF (${t.marginPct ?? 0}% margin). Top route by gross: ${rv.byRoute[0]?.label ?? "—"}.`, metrics: [{ label: "Gross", value: t.gross, ccy: "XAF" }, { label: "Net", value: t.net, ccy: "XAF" }, { label: "Margin %", value: t.marginPct ?? 0 }], assumptions: ["Costs use the configured payout/rail/fixed assumptions (Settings → Pricing)."], sources: rv.sources, calculations: [], confidence: rv.freshness.sampleSize >= 10 ? "HIGH" : "LOW", dataUpdatedAt: rv.freshness.dataAsOf, suggestedActions: suggest("REVIEW_ROUTE"), engineResult: { ...t } };
    }
    case "forecast": {
      const h = horizonOf(q); const fc = await engine.forecasts(f); const v = fc.forecasts.find((x) => x.metric === "volume")!, r = fc.forecasts.find((x) => x.metric === "revenue")!;
      return { intent, answer: `Next ${h} days: volume expected ${n(v.horizons[h].expected)} XAF (${n(v.horizons[h].lower)}–${n(v.horizons[h].upper)}), revenue expected ${n(r.horizons[h].expected)} XAF (${n(r.horizons[h].lower)}–${n(r.horizons[h].upper)}). Confidence ${v.horizons[h].confidence.toLowerCase()} on ${v.basis.observations} active days.`, metrics: [{ label: "Volume", value: v.horizons[h].expected, ccy: "XAF" }, { label: "Revenue", value: r.horizons[h].expected, ccy: "XAF" }], assumptions: [v.method], sources: fc.sources, calculations: [], confidence: v.horizons[h].confidence, dataUpdatedAt: fc.freshness.dataAsOf, suggestedActions: suggest("REVIEW_FORECAST"), engineResult: { h, volume: v.horizons[h], revenue: r.horizons[h] } };
    }
    case "capital_position": {
      const hl = await engine.health(f);
      return { intent, answer: `Capital position (USD): committed ${n(hl.total.committed)}, received ${n(hl.total.received)}, deployed ${n(hl.total.deployed)}, available ${n(hl.total.available)}. By type — ${(Object.keys(hl.byType) as Array<keyof typeof hl.byType>).map((t) => `${CAPITAL_TYPE_LABEL[t]}: received ${n(hl.byType[t].received)}, deployed ${n(hl.byType[t].deployed)}`).join("; ")}.`, metrics: [{ label: "Committed", value: hl.total.committed, ccy: "USD" }, { label: "Received", value: hl.total.received, ccy: "USD" }, { label: "Deployed", value: hl.total.deployed, ccy: "USD" }, { label: "Available", value: hl.total.available, ccy: "USD" }], assumptions: ["Balances derived from the four capital ledgers; types are never netted against each other."], sources: hl.sources, calculations: [], confidence: "HIGH", dataUpdatedAt: hl.freshness.dataAsOf, suggestedActions: suggest("REDUCE_IDLE_CAPITAL"), engineResult: hl.total };
    }
    default:
      return { intent, answer: "I can answer questions the intelligence engine can compute: liquidity needs over a horizon, the biggest capital risk, which investors to contact, volume scenarios (\"what if volume grows 50%\"), route efficiency, underutilised capital, requirement priority, revenue, forecasts and the capital position. Try one of those.", metrics: [], assumptions: [], sources: [], calculations: [], confidence: "HIGH", dataUpdatedAt: new Date().toISOString(), suggestedActions: [], engineResult: {} };
  }
}

/** Optional: let the configured model rephrase the engine's facts. It receives the numbers
 *  and may not add, change or infer any — the templated answer is the fallback. */
async function explain(question: string, facts: Facts): Promise<string | null> {
  if (!metaAiConfigured() || facts.intent === "unknown") return null;
  const system = "You are the explanation layer of a capital-intelligence engine for a Mobile Money settlement company. You are given VERIFIED facts. Rewrite them as a clear 2–4 sentence executive answer. Rules: use ONLY the numbers given, verbatim; never compute, estimate, round differently or add figures; never state a recommendation as a decision; keep currencies next to amounts.";
  const user = JSON.stringify({ question, facts: { answer: facts.answer, metrics: facts.metrics, assumptions: facts.assumptions, confidence: facts.confidence } });
  const r = await structured<{ explanation: string }>(system, user, "explanation", { type: "object", additionalProperties: false, required: ["explanation"], properties: { explanation: { type: "string" } } });
  const text = r?.explanation?.trim();
  if (!text) return null;
  // Grounding check: every number in the model's text must appear in the facts.
  const allowed = new Set(JSON.stringify(facts).match(/\d[\d\s,.]*\d|\d/g)?.map((x) => x.replace(/[\s,]/g, "")) ?? []);
  const nums = text.match(/\d[\d\s,.]*\d|\d/g) ?? [];
  if (nums.some((x) => !allowed.has(x.replace(/[\s,]/g, "")))) return null;
  return text;
}

export async function ask(question: string, user: string, f: IntelFilters = {}): Promise<CopilotAnswer> {
  const q = String(question ?? "").replace(/[\x00-\x1f]/g, " ").trim().slice(0, 500);
  const facts = await gather(q, f);
  const llm = await explain(q, facts);
  const a: CopilotAnswer = { id: id("ai"), question: q, answer: llm ?? facts.answer, askedBy: user, at: new Date().toISOString(), metrics: facts.metrics, assumptions: facts.assumptions, sources: facts.sources, calculations: facts.calculations, confidence: facts.confidence, dataUpdatedAt: facts.dataUpdatedAt, intent: facts.intent, explainedBy: llm ? "engine+llm" : "engine", suggestedActions: facts.suggestedActions };
  audit.unshift({ id: a.id, at: a.at, user, question: q, intent: facts.intent, sources: facts.sources, engineResult: facts.engineResult, answer: a.answer, confidence: a.confidence, requestedActions: facts.suggestedActions.map((s) => s.recommendationId ?? s.label), approvedActions: [], executedActions: [] });
  if (audit.length > 1000) audit.length = 1000;
  touch("capital_ai_audit");
  return a;
}
export const EXAMPLE_QUESTIONS = [
  "How much liquidity do we need over the next 90 days?", "What is our biggest capital risk?", "Which investors should we contact?", "What happens if transaction volume grows 50%?",
  "Which payment route is most capital efficient?", "Where is our capital currently underutilized?", "What capital requirement should we prioritize?",
];
