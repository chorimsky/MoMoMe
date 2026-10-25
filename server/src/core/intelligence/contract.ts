/* ============================================================
   The shared discipline every intelligence capability runs under.

   A capability's job is to produce CLAIMS: statements with the numbers the engine computed
   and the evidence they came from. This module does everything else — scope enforcement,
   optional LLM phrasing, the guard on that phrasing, and the audit entry.

   THE GUARD is the part worth reading. "The model is told not to invent numbers" is not a
   control; a control is something that fails closed. So after the model phrases the claims,
   every number in its prose is checked against the numbers the engine computed. One that is
   not among them means the phrasing is DISCARDED and the template is used instead, and the
   answer says so (`explainedBy: "engine (llm phrasing rejected)"`) rather than hiding it.

   Why that direction: a plain sentence costs a reader nothing, and a confident sentence with
   a wrong figure about somebody's money costs them a decision. There is no version of this
   where the fluent-but-unverified answer is the safer default.
   ============================================================ */
import type { CapabilityDef, Claim, Evidence, IntelAuditEntry, IntelConfidence, IntelligenceAnswer } from "../../../../shared/intelligence.js";
import { structured, metaAiConfigured } from "../../adapters/metaAi.js";
import { register, touch } from "../persist.js";
import { id } from "../ids.js";
import { emit } from "../journal.js";

const audit: IntelAuditEntry[] = [];
const AUDIT_CAP = 2_000;
register("intel_audit", () => audit.slice(-AUDIT_CAP), (d: IntelAuditEntry[]) => { audit.length = 0; audit.push(...(d ?? [])); });
export const intelAuditLog = (limit = 200): IntelAuditEntry[] => audit.slice(-limit).reverse();
export const _resetIntelAudit = (): void => { audit.length = 0; };

/** Every number a set of claims is entitled to use, as strings in the forms prose takes. */
export function allowedNumbers(claims: Claim[]): Set<string> {
  const out = new Set<string>();
  for (const c of claims) {
    for (const v of c.values ?? []) {
      if (typeof v.value === "number") {
        const n = v.value;
        out.add(String(n));
        out.add(String(Math.round(n)));
        out.add(Math.round(n).toLocaleString("en"));     // 1,234
        out.add(Math.round(n).toLocaleString("fr-FR").replace(/ | /g, " ")); // 1 234
        if (Number.isFinite(n) && !Number.isInteger(n)) out.add(n.toFixed(2));
        // Rounded-to-the-minute/second forms a sentence naturally uses for a duration.
        if (n >= 1000) { out.add(String(Math.round(n / 1000))); out.add(String(Math.round(n / 60_000))); }
      } else {
        for (const tok of String(v.value).match(/\d+(?:[.,]\d+)?/g) ?? []) out.add(tok);
      }
    }
    // Numbers the ENGINE itself put in the claim text are by definition computed.
    for (const tok of c.text.match(/\d+(?:[.,   ]\d{3})*(?:\.\d+)?/g) ?? []) out.add(tok.trim());
  }
  return out;
}

/* MEASURED BEHAVIOUR, on prose shaped like a model's rather than like a test string:

     ACCEPT  "It is 50 000 XAF, and the rail has not answered for about 5 minutes."
     REJECT  "pending for 5.3 minutes"              → 5.3
     REJECT  "roughly 3% of today's volume"         → 3
     REJECT  "slower than the usual 45 s"           → 45
     REJECT  "Two of the 3 rails are reachable."    → 3
     ACCEPT  "The rail accepted this payout and has not reported back."
     ACCEPT  "It was accepted on 2026-10-24 and has not moved since."

   The second line is the honest cost: 5.3 minutes is an ACCURATE re-expression of 320 669 ms,
   and it is discarded anyway, because the engine said "5 min" and the model produced a
   figure of its own. That is the trade taken deliberately — the guard cannot tell a correct
   re-rounding from an invented one without recomputing, and the penalty for being strict is
   a plainer sentence while the penalty for being lax is a wrong number about somebody's
   money. Expect this to fire on real phrasings; `explainedBy` says when it did. */

/** Numbers in `prose` that the engine never computed. Empty ⇒ the phrasing is clean.
 *
 *  Deliberately crude in the safe direction: a YEAR or a short ordinal inside a date, a
 *  percentage sign, a reference like MMM-2026-418844 — all of these would otherwise look
 *  like invented figures. Rather than let that noise force every phrasing to be rejected
 *  (which would make the guard useless by making it always fire), tokens that are part of an
 *  ISO date or of an identifier the claims already cite are excused. Everything else must
 *  match something the engine produced. */
export function unverifiedNumbers(prose: string, claims: Claim[]): string[] {
  const allowed = allowedNumbers(claims);
  const citedIds = new Set(claims.flatMap((c) => c.evidence.map((e) => e.id.toUpperCase())));
  // Strip what is legitimately not a figure: ISO timestamps, and any identifier the claims
  // cite (a payment ref carries digits that are not a quantity).
  let text = prose.replace(/\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?/g, " ");
  for (const ref of citedIds) {
    if (ref.length >= 6) text = text.replace(new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " ");
  }
  const bad: string[] = [];
  // GROUPED FORMS FIRST. A plain space is a thousands separator in French, which this app
  // writes ("50 000 XAF"), so a token pattern without it reads that as the two numbers 50
  // and 000 — neither of which the engine computed, and the guard then rejects its own
  // app's formatting. The grouped alternative must come first in the alternation, or the
  // bare one matches "50" and stops there.
  const TOKEN = /\d{1,3}(?:[ \u202f\u00a0,]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  for (const tok of text.match(TOKEN) ?? []) {
    const spaced = tok.replace(/[\u202f\u00a0]/g, " ");
    const bare = spaced.replace(/[ ,]/g, "");
    if (allowed.has(tok) || allowed.has(spaced) || allowed.has(bare)) continue;
    bad.push(tok);
  }
  return [...new Set(bad)];
}

/** Drop any evidence a capability is not allowed to cite. Enforced HERE rather than inside
 *  the capability, because a capability that polices its own scope does not have one. */
function withinScope(def: CapabilityDef, claims: Claim[]): Claim[] {
  return claims.map((c) => {
    const kept = c.evidence.filter((e) => def.reads.includes(e.kind));
    const dropped = c.evidence.length - kept.length;
    if (dropped > 0) console.warn(`[intel] ${def.key}: dropped ${dropped} out-of-scope evidence item(s) — it may read ${def.reads.join(", ")}`);
    return { ...c, evidence: kept };
  });
}

const weakest = (claims: Claim[]): IntelConfidence =>
  claims.some((c) => c.confidence === "low") ? "low" : claims.some((c) => c.confidence === "medium") ? "medium" : "high";

/** The template. Always produced, and used whenever a model is absent or its phrasing is
 *  rejected — so there is no path where a question goes unanswered because an AI was down.
 *  §34: the core must work without the optional intelligence. */
function template(claims: Claim[]): string {
  const facts = claims.filter((c) => c.kind === "fact");
  const rest = claims.filter((c) => c.kind !== "fact");
  const lines = [...facts, ...rest].map((c) => (c.kind === "hypothesis" ? `Possibly: ${c.text}` : c.text));
  return lines.join(" ");
}

const SYSTEM = [
  "You turn verified findings about a payment system into two or three plain sentences for an operator.",
  "You may ONLY use the numbers given to you. Do not compute, convert, round differently, estimate, or add any figure that is not in the findings.",
  "Do not add causes, advice or reassurance that the findings do not state.",
  "A finding marked hypothesis must stay hedged. A finding marked fact may be stated plainly.",
  "Plain English. No bullet points, no headings, no jargon.",
].join(" ");

export interface AskInput {
  def: CapabilityDef;
  question: string;
  askedBy: string;
  claims: Claim[];
  assumptions?: string[];
  unknowns?: string[];
  dataUpdatedAt?: string;
}

/** Assemble, phrase, verify, audit. The single door every capability answers through. */
export async function answer(input: AskInput): Promise<IntelligenceAnswer> {
  const claims = withinScope(input.def, input.claims);
  const base: IntelligenceAnswer = {
    id: id("intel"), capability: input.def.key, question: input.question,
    summary: template(claims), claims,
    assumptions: input.assumptions ?? [], unknowns: input.unknowns ?? [],
    confidence: weakest(claims), explainedBy: "engine",
    dataUpdatedAt: input.dataUpdatedAt ?? new Date().toISOString(),
    askedBy: input.askedBy, at: new Date().toISOString(),
  };

  let rejected: string | undefined;
  if (metaAiConfigured() && claims.length) {
    const findings = claims.map((c) => ({ kind: c.kind, text: c.text, values: c.values ?? [] }));
    const phrased = await structured<{ summary: string }>(
      SYSTEM,
      `Question: ${input.question}\n\nFindings (the only numbers you may use):\n${JSON.stringify(findings, null, 1)}`,
      "operator_summary",
      { type: "object", additionalProperties: false, required: ["summary"], properties: { summary: { type: "string" } } },
    ).catch(() => null);
    const prose = phrased?.summary?.trim();
    if (prose) {
      const bad = unverifiedNumbers(prose, claims);
      if (bad.length === 0) { base.summary = prose; base.explainedBy = "engine+llm"; }
      else {
        // Kept, not hidden: the operator sees that a phrasing was offered and refused, and
        // the audit records what tripped it. A guard whose firings are invisible cannot be
        // told from a guard that never fires.
        rejected = `numbers not computed by the engine: ${bad.join(", ")}`;
        base.explainedBy = "engine (llm phrasing rejected)";
        console.warn(`[intel] ${input.def.key}: discarded LLM phrasing — ${rejected}`);
      }
    }
  }

  audit.push({
    id: base.id, at: base.at, capability: base.capability, user: input.askedBy, question: input.question,
    claims: claims.length, confidence: base.confidence, explainedBy: base.explainedBy,
    ...(rejected ? { rejectedPhrasing: rejected } : {}),
  });
  if (audit.length > AUDIT_CAP * 1.2) audit.splice(0, audit.length - AUDIT_CAP);
  touch("intel_audit");
  try {
    emit({ type: "intelligence.answered", subject: { type: "capability", id: base.capability }, actor: { type: "operator", id: input.askedBy },
      data: { claims: claims.length, confidence: base.confidence, explainedBy: base.explainedBy, ...(rejected ? { rejectedPhrasing: rejected } : {}) } });
  } catch { /* observability only */ }
  return base;
}

/** Helper for capabilities: build a claim without repeating the shape. */
export const claim = (kind: Claim["kind"], text: string, evidence: Evidence[], confidence: IntelConfidence = "high", values?: Claim["values"]): Claim =>
  ({ kind, text, evidence, confidence, ...(values ? { values } : {}) });
