/* The platform fee, in one place. A percentage with a floor: at the 500 XAF minimum a
   flat 2.5% is 12 XAF, and the aggregator alone charged 8.5 XAF on a real 500 XAF
   movement — small tickets were carried at a loss. Partners may carry their own rate
   (a key's feePct) instead of the public one; the floor still applies. */
import { getSettings } from "./settings.js";

export function platformFee(xaf: number, pctOverride?: number | null): number {
  const pr = getSettings().pricing;
  const pct = typeof pctOverride === "number" && pctOverride >= 0 && pctOverride <= 0.2 ? pctOverride : pr.feePct;
  return Math.max(Math.round(xaf * pct), Math.min(pr.minFeeXaf ?? 0, xaf));
}
