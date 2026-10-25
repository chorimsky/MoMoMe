/* ============================================================
   The intelligence contract — shared by every capability, so there is ONE answer shape
   rather than one per domain.

   The Capital Copilot already proved the discipline this encodes (engine computes, the
   model only phrases, every exchange audited, nothing executable). What it did not do is
   generalise: its intents, its numbers and its audit are all capital-specific. §20 of the
   blueprint lists eleven capabilities; eleven copies of that pattern would be eleven places
   for the discipline to quietly diverge.

   The invariant, stated once here and enforced in core/intelligence/contract.ts:

     A CLAIM MAY ONLY CARRY A NUMBER THE ENGINE COMPUTED.

   Not "the model is instructed not to invent numbers" — instructed is not enforced. The
   phrasing is checked against the computed facts, and prose containing a figure that is not
   among them is DISCARDED in favour of the template. A wrong number in a sentence about
   somebody's money is worse than a plain sentence.
   ============================================================ */

/** How sure the ENGINE is — never how fluent the sentence was. */
import type { Section } from "./roles.js";

export type IntelConfidence = "high" | "medium" | "low";

/** Where a claim's number came from, so a reader can go and look. */
export interface Evidence {
  /** Stable id of the thing: a payment id, a journal event id, a rail name, a report key. */
  id: string;
  kind: "payment" | "payment_event" | "journal_event" | "rail" | "ledger" | "report" | "settings";
  /** One line a human can act on: what this evidence IS, not what it proves. */
  label: string;
  at?: string;
}

/** One statement the engine is prepared to stand behind. */
export interface Claim {
  text: string;
  /** Numbers used in `text`, exactly as the engine computed them. The guard checks the
   *  phrasing against these, so a claim with no numbers is as legitimate as one with ten. */
  values?: Array<{ label: string; value: number | string; unit?: string }>;
  evidence: Evidence[];
  confidence: IntelConfidence;
  /** FACT: in the records. INFERENCE: derived from them, and says how. HYPOTHESIS: a
   *  possible explanation that the records do not settle. The blueprint asks for exactly
   *  this separation (§23), and a reader who cannot tell them apart has been misled. */
  kind: "fact" | "inference" | "hypothesis";
}

export interface IntelligenceAnswer {
  id: string;
  capability: string;
  question: string;
  /** The prose. Templated from the claims, or an LLM's phrasing of the SAME claims. */
  summary: string;
  claims: Claim[];
  assumptions: string[];
  confidence: IntelConfidence;
  /** "engine" when nothing phrased it, "engine+llm" when a model did and the guard passed,
   *  "engine (llm phrasing rejected)" when it did and the guard caught it. That last value
   *  exists so a rejected phrasing is visible rather than silently indistinguishable from
   *  never having asked. */
  explainedBy: "engine" | "engine+llm" | "engine (llm phrasing rejected)";
  dataUpdatedAt: string;
  askedBy: string;
  at: string;
  /** Anything the engine could NOT establish. Named, because the blueprint's §31 asks what
   *  remains uncertain and an answer that omits its own gaps reads as complete. */
  unknowns: string[];
}

export interface IntelAuditEntry {
  id: string; at: string; capability: string; user: string; question: string;
  claims: number; confidence: IntelConfidence; explainedBy: IntelligenceAnswer["explainedBy"];
  /** Set when a model's phrasing was discarded, with what tripped it. */
  rejectedPhrasing?: string;
}

/** What a capability is allowed to read. Enforced by the registry, not by the capability:
 *  a capability that could widen its own scope is not scoped. */
export interface CapabilityDef {
  key: string;
  title: string;
  /** One line for the console. */
  what: string;
  /** Evidence kinds this capability may cite. Anything else it tries to cite is dropped. */
  reads: Evidence["kind"][];
  /** The console SECTION whose audience may ask this, so authorization goes through the
   *  one mechanism the admin console already has (ROLE_SECTIONS / canAccess in
   *  shared/roles.ts) rather than a vocabulary of its own.
   *
   *  The first version of this field was a `role` of "SUPER_ADMIN" | "ADMIN" | "SUPPORT" —
   *  three names that exist nowhere else in the system and that nothing checked. A field
   *  that looks like an access control and is never read is worse than no field: it makes
   *  a reviewer believe the question has been answered. */
  section: Section;
}
