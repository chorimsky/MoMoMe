/* Name normalization and matching. Providers return names in their own casing and order;
   senders type them differently. MATCH / PARTIAL_MATCH / NO_MATCH / NOT_AVAILABLE — a
   provider's own authoritative verdict (when it gives one) is preserved by the caller. */
import type { NameMatch } from "../../../../shared/identity.js";

export function normalizeName(s: string): string[] {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z' -]/g, " ").split(/[\s-]+/).filter((t) => t.length > 1 && !["MR", "MRS", "MME", "MLLE", "DR"].includes(t));
}
export function matchNames(expected: string | undefined, actual: string | undefined): NameMatch {
  if (!expected || !actual) return "NOT_AVAILABLE";
  const a = normalizeName(expected), b = normalizeName(actual);
  if (!a.length || !b.length) return "NOT_AVAILABLE";
  const A = new Set(a), B = new Set(b);
  const common = [...A].filter((t) => B.has(t)).length;
  if (common === A.size && common === B.size) return "MATCH";
  if (common >= 1 && (common / Math.max(A.size, B.size)) >= 0.5) return "PARTIAL_MATCH";
  return "NO_MATCH";
}
