/* Name normalization and matching — ONE algorithm for the whole product, shared with the
   web and mobile apps (shared/domain.ts compareNames): the server's verdict on a payment
   and the badge a sender sees on the Details screen can never disagree. */
import type { NameMatch } from "../../../../shared/identity.js";
import { compareNames, nameTokens } from "../../../../shared/domain.js";

export function normalizeName(s: string): string[] { return nameTokens(s).map((t) => t.toUpperCase()); }
export function matchNames(expected: string | undefined, actual: string | undefined): NameMatch {
  return compareNames(expected, actual);
}
