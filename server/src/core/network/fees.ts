/* ============================================================
   Fee engine — every component separately, the customer sees one clear number (§33).

   All fees are expressed in the SOURCE currency and are INSIDE the source amount: the
   customer pays what they typed; the recipient gets what is left after fees and FX. The
   platform fee is the production platformFee() (percentage with floor) applied to the
   source amount; provider/aggregator, Lightning and liquidity fees come from the adapters
   and sources on the chosen route.
   ============================================================ */
import type { FeeBreakdown, FxQuote, LiquiditySource } from "../../../../shared/network.js";
import { platformFee } from "../pricing.js";
import type { MobileMoneyProviderAdapter } from "./adapters.js";

const round = (n: number) => Math.round(n * 100) / 100;

export async function feeBreakdown(input: {
  sourceAmount: number; sourceCurrency: string;
  collection: MobileMoneyProviderAdapter; payout: MobileMoneyProviderAdapter; payoutProvider: string;
  destinationSource: LiquiditySource; lightningSource: LiquiditySource; fx: FxQuote; settlementSats: number;
  /** No Lightning leg (same-market aggregator settlement): no routing fee, no spread. */
  domestic?: boolean;
}): Promise<FeeBreakdown> {
  const { sourceAmount: amt } = input;
  // Collection: Peexit collect ≈ 1.0 % (aggregator schedule); simulated markets 1 %.
  const collectPct = input.collection.simulated ? 0.01 : 0.01;
  const providerCollect = round(amt * collectPct);
  const payoutPct = (await input.payout.payoutFeePct(input.payoutProvider)) ?? 0.015;
  const providerPayout = round(amt * payoutPct);
  const fxSpread = input.fx.from === input.fx.to ? 0 : round(amt * (input.fx.spreadBps / 10_000));
  // Lightning: routing fees are a few ppm; the source's feePct is the ceiling it charges.
  const lightning = input.domestic ? 0 : round(amt * Math.max(0.0005, input.lightningSource.feePct));
  const liquidity = input.domestic ? 0 : round(amt * input.destinationSource.feePct);
  // The platform fee: the production percentage with its floor — XAF-denominated floor
  // applies to XAF; other currencies use the percentage only until per-market floors exist.
  const momome = input.sourceCurrency === "XAF" ? platformFee(amt) : Math.round(amt * 0.025);
  const total = round(providerCollect + providerPayout + fxSpread + lightning + liquidity + momome);
  return { currency: input.sourceCurrency, providerCollect, providerPayout, fxSpread, lightning, liquidity, momome, total };
}
