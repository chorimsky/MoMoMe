/* ============================================================
   Capital requirements + recommendations — the persisted DECISION records.
   The engine derives amounts and gaps from live data on every scan; what a
   person decided (status, review, approval, dismissal) is kept here and
   survives the next scan. Nothing in this file executes anything.
   ============================================================ */
import { register, touch as snapshotTouch } from "../persist.js";
import { registerRows, touchRows } from "./rows.js";
import { id } from "../ids.js";
import type { CapitalRequirement, Recommendation, RecommendationStatus, RequirementStatus, AuditEvent, ConcentrationDim } from "../../../../shared/capital.js";
import { RECOMMENDATION_FLOW } from "../../../../shared/capital.js";
import { notifyCapital } from "./investors.js";
import type { Result } from "./investors.js";

const now = () => new Date().toISOString();
const ev = (actor: string, action: string, note?: string): AuditEvent => ({ at: now(), actor, action, ...(note ? { note } : {}) });
const fail = (error: string, message: string, status = 400): Result<never> => ({ ok: false, error, message, status });
const okv = <T>(value: T): Result<T> => ({ ok: true, value });

const requirements = new Map<string, CapitalRequirement>();
const recommendations = new Map<string, Recommendation>();
/** Concentration thresholds (% share) — configurable by management. */
export const config: { thresholds: Record<ConcentrationDim, number> } = { thresholds: { investor: 40, country: 80, currency: 70, rail: 70, provider: 70, capitalType: 75 } };

registerRows("capital_requirements", () => [...requirements.values()], (rows: CapitalRequirement[]) => { requirements.clear(); for (const r of rows ?? []) requirements.set(r.id, r); });
registerRows("capital_recommendations", () => [...recommendations.values()], (rows: Recommendation[]) => { recommendations.clear(); for (const r of rows ?? []) recommendations.set(r.id, r); });
// config is a single document: the snapshot seam is the right shape for it.
const touch = (key: string) => (key === "capital_config" ? snapshotTouch(key) : touchRows(key));
register("capital_config", () => config, (c: typeof config) => { if (c?.thresholds) config.thresholds = { ...config.thresholds, ...c.thresholds }; });

/* ---------- requirements ---------- */
const OPEN: RequirementStatus[] = ["IDENTIFIED", "ANALYZING", "APPROVED", "FUNDRAISING_REQUIRED", "FUNDING_IN_PROGRESS"];
export function listRequirements(): CapitalRequirement[] { return [...requirements.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function getRequirement(rid: string): CapitalRequirement | undefined { return requirements.get(rid); }
/** Engine upsert: one OPEN derived requirement per (capitalType, purpose). Amounts refresh; the human status stays. */
export function upsertDerivedRequirement(r: Omit<CapitalRequirement, "id" | "createdAt" | "updatedAt" | "history" | "status" | "derived">): CapitalRequirement {
  // One live record per derived (type, purpose) — matched whatever its status short of CLOSED,
  // so a gap that closes and re-opens moves the SAME requirement rather than minting a twin.
  const existing = [...requirements.values()].find((x) => x.derived && x.capitalType === r.capitalType && x.purpose === r.purpose && x.status !== "CLOSED");
  if (existing) {
    const changed = existing.amount !== r.amount || existing.fundingGap !== r.fundingGap || existing.urgency !== r.urgency;
    Object.assign(existing, r, { updatedAt: changed ? now() : existing.updatedAt });
    if (changed) existing.history.push(ev("engine", "Re-derived from live data", `amount ${r.amount} · gap ${r.fundingGap} · ${r.urgency}`));
    if (r.fundingGap <= 0 && OPEN.includes(existing.status)) { existing.status = "FUNDED"; existing.history.push(ev("engine", "Gap closed by available capital")); }
    else if (r.fundingGap > 0 && existing.status === "FUNDED") { existing.status = "IDENTIFIED"; existing.history.push(ev("engine", "Gap re-opened — back to IDENTIFIED")); }
    if (changed || existing.status === "FUNDED") touch("capital_requirements");
    return existing;
  }
  const created: CapitalRequirement = { ...r, id: `CR-${String(requirements.size + 1).padStart(4, "0")}`, status: r.fundingGap <= 0 ? "FUNDED" : "IDENTIFIED", derived: true, createdAt: now(), updatedAt: now(), history: [ev("engine", r.fundingGap <= 0 ? "Identified from live data — already covered" : "Identified from live data")] };
  requirements.set(created.id, created); touch("capital_requirements");
  if (created.fundingGap > 0) notifyCapital("REQUIREMENT_IDENTIFIED", `Capital requirement ${created.id}: ${created.purpose}`, `${created.amount} ${created.ccy} · gap ${created.fundingGap} · ${created.urgency}`, `/capital-intelligence/capital-requirements/${created.id}`);
  if (created.fundingGap > 0 && (created.urgency === "HIGH" || created.urgency === "CRITICAL")) notifyCapital("FUNDING_GAP", `Funding gap on ${created.id}`, `${created.fundingGap} ${created.ccy} short of the requirement.`, `/capital-intelligence/capital-requirements/${created.id}`);
  return created;
}
export function createManualRequirement(input: Omit<CapitalRequirement, "id" | "createdAt" | "updatedAt" | "history" | "status" | "derived" | "calculation" | "sources" | "confidence"> & { confidence?: CapitalRequirement["confidence"] }, actor: string): Result<CapitalRequirement> {
  if (!input.purpose || input.purpose.trim().length < 3) return fail("bad_purpose", "A purpose is required.");
  if (!(input.amount > 0)) return fail("bad_amount", "Amount must be positive.");
  const r: CapitalRequirement = {
    ...input, purpose: input.purpose.trim().slice(0, 200), id: `CR-${String(requirements.size + 1).padStart(4, "0")}`, status: "IDENTIFIED", derived: false,
    confidence: input.confidence ?? "MEDIUM",
    calculation: { id: "manual", formula: "Amount − Available = Gap (entered by management)", steps: [{ label: "Amount", value: input.amount, ccy: input.ccy }, { label: "Available", value: input.currentAvailable, ccy: input.ccy }], result: input.fundingGap, ccy: input.ccy },
    sources: [{ kind: "requirement", ref: "manual", label: `Entered by ${actor}` }],
    createdAt: now(), updatedAt: now(), history: [ev(actor, "Requirement entered")],
  };
  requirements.set(r.id, r); touch("capital_requirements");
  return okv(r);
}
const REQ_NEXT: Record<RequirementStatus, RequirementStatus[]> = {
  IDENTIFIED: ["ANALYZING", "CLOSED"], ANALYZING: ["APPROVED", "CLOSED"], APPROVED: ["FUNDRAISING_REQUIRED", "FUNDED", "CLOSED"],
  FUNDRAISING_REQUIRED: ["FUNDING_IN_PROGRESS", "CLOSED"], FUNDING_IN_PROGRESS: ["FUNDED", "CLOSED"], FUNDED: ["ALLOCATED", "CLOSED"], ALLOCATED: ["CLOSED"], CLOSED: [],
};
export function transitionRequirement(rid: string, to: RequirementStatus, note: string, actor: string): Result<CapitalRequirement> {
  const r = requirements.get(rid);
  if (!r) return fail("not_found", "Requirement not found.", 404);
  if (!REQ_NEXT[r.status].includes(to)) return fail("bad_transition", `${r.status} cannot move to ${to}.`, 409);
  r.history.push(ev(actor, `${r.status} → ${to}`, note)); r.status = to; r.updatedAt = now(); touch("capital_requirements");
  return okv(r);
}

/* ---------- recommendations ---------- */
export function listRecommendations(): Recommendation[] { return [...recommendations.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); }
export function getRecommendation(rid: string): Recommendation | undefined { return recommendations.get(rid); }
/** Engine upsert by fingerprint. A dismissed or completed recommendation is not re-created
 *  while its fingerprint holds; an open one refreshes its numbers in place. */
export function upsertRecommendation(r: Omit<Recommendation, "id" | "status" | "createdAt" | "updatedAt" | "history">): Recommendation | null {
  const existing = [...recommendations.values()].find((x) => x.fingerprint === r.fingerprint);
  if (existing) {
    if (existing.status === "DISMISSED" || existing.status === "COMPLETED") return null;
    Object.assign(existing, { inputs: r.inputs, calculation: r.calculation, output: r.output, recommendation: r.recommendation, confidence: r.confidence, confidenceNote: r.confidenceNote, expectedOutcome: r.expectedOutcome, risks: r.risks });
    touch("capital_recommendations");
    return existing;
  }
  const created: Recommendation = { ...r, id: `REC-${String(recommendations.size + 1).padStart(4, "0")}`, status: "CREATED", createdAt: now(), updatedAt: now(), history: [ev("engine", "Created")] };
  recommendations.set(created.id, created); touch("capital_recommendations");
  notifyCapital("RECOMMENDATION_CREATED", `${created.title}`, created.recommendation.slice(0, 140), `/capital-intelligence/recommendations/${created.id}`);
  return created;
}
/** Open recommendations whose condition no longer holds are closed by the engine, never silently deleted. */
export function retireStale(liveFingerprints: Set<string>): void {
  for (const r of recommendations.values()) {
    if ((r.status === "CREATED" || r.status === "REVIEWED") && !liveFingerprints.has(r.fingerprint)) {
      r.status = "DISMISSED"; r.dismissedBy = "engine"; r.dismissedAt = now(); r.dismissReason = "Condition no longer holds in live data."; r.updatedAt = now(); r.history.push(ev("engine", "Dismissed — condition cleared"));
    }
  }
  touch("capital_recommendations");
}
export function transitionRecommendation(rid: string, to: RecommendationStatus, actor: string, note?: string, responsible?: string): Result<Recommendation> {
  const r = recommendations.get(rid);
  if (!r) return fail("not_found", "Recommendation not found.", 404);
  if (to === "DISMISSED") {
    if (r.status === "COMPLETED" || r.status === "DISMISSED") return fail("bad_transition", "Already closed.", 409);
    if (!note || note.trim().length < 3) return fail("bad_note", "A reason is required to dismiss.");
    r.dismissedBy = actor; r.dismissedAt = now(); r.dismissReason = note.trim().slice(0, 300);
  } else {
    const from = RECOMMENDATION_FLOW.indexOf(r.status), t = RECOMMENDATION_FLOW.indexOf(to);
    if (from < 0 || t !== from + 1) return fail("bad_transition", `${r.status} → ${to} is not the next step.`, 409);
    if (to === "REVIEWED") { r.reviewedBy = actor; r.reviewedAt = now(); }
    if (to === "APPROVED") {
      if (r.reviewedBy === actor) return fail("four_eyes", "The reviewer cannot also approve. A second person must approve.", 409);
      if (!note || !/confirm/i.test(note)) return fail("confirmation_required", "Approval requires explicit confirmation.", 400);
      r.approvedBy = actor; r.approvedAt = now();
    }
    if (to === "COMPLETED") r.completedAt = now();
  }
  if (responsible !== undefined) r.responsible = responsible;
  r.history.push(ev(actor, `${r.status} → ${to}`, note)); r.status = to; r.updatedAt = now(); touch("capital_recommendations");
  if (to === "REVIEWED") notifyCapital("APPROVAL_REQUIRED", `Approval required: ${r.title}`, `Reviewed by ${actor} — a second person must approve.`, `/capital-intelligence/recommendations/${r.id}`);
  return okv(r);
}
export function setThresholds(t: Partial<Record<ConcentrationDim, number>>): Record<ConcentrationDim, number> {
  for (const k of Object.keys(config.thresholds) as ConcentrationDim[]) { const v = Number(t[k]); if (Number.isFinite(v) && v > 0 && v <= 100) config.thresholds[k] = Math.round(v); }
  touch("capital_config");
  return config.thresholds;
}
export function _resetWorkflow(): void { requirements.clear(); recommendations.clear(); }
export { id as _id };
