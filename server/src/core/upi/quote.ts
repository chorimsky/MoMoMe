/* QuoteEngine — for an intent ("10 000 XAF to +237…"), every way a payer could fund it,
   priced on the live feeds, with the fee lines apart: network, provider, MoMo›Me, FX spread,
   liquidity. Quotation never executes anything; it does not even claim a V1 quote — the V1
   quote is minted only when the payer picks an option and the intent is executed. */
import type { PaymentIntentV2, QuoteOption, FeeLines } from "../../../../shared/upi.js";
import { fxRate } from "./fx.js";
import { platformFee } from "../pricing.js";
import { inboundAmount, formatAmount, rateFor } from "../fx.js";
import { getSettings } from "../settings.js";
import { assets, assetKey } from "./assets.js";
import { lightningRail, stablecoinRail, mobileMoneyRail } from "./rails.js";
import { discover } from "../network/router.js";
import { corridorFlag, flag } from "./flags.js";
import { id } from "../ids.js";
import type { Method, ProviderId } from "../../../../shared/types.js";

const QUOTE_TTL_MS = 30_000;
const METHOD: Record<string, Method> = { "BTC/LIGHTNING": "LIGHTNING", "USDT/ETHEREUM": "USDT", "USDC/ETHEREUM": "USDC" };

export async function quoteIntent(intent: PaymentIntentV2, feePctOverride?: number | null): Promise<{ id: string; options: QuoteOption[]; expiresAt: string }> {
  const now = Date.now();
  const expiresAt = new Date(now + QUOTE_TTL_MS).toISOString();
  const options: QuoteOption[] = [];
  const idn = intent.recipient.resolved;
  const mm = intent.recipient.destinations.find((d) => d.rail === "MOBILE_MONEY");
  const domestic = !!mm && mm.country === "CM";
  if (domestic && mm) {
    const xaf = intent.amount.value;
    const feeXaf = platformFee(xaf, feePctOverride);
    const totalXaf = xaf + feeXaf;
    const settle = await mobileMoneyRail("CM", mm.provider as ProviderId).quote({ amountXaf: xaf, provider: mm.provider, country: "CM" });
    const enabled = getSettings().methods;
    for (const a of assets().filter((x) => x.type !== "FIAT" && x.network !== "BITCOIN" && METHOD[assetKey(x.code, x.network)])) {
      const key = assetKey(a.code, a.network);
      const method = METHOD[key];
      const rail = a.type === "STABLECOIN" ? stablecoinRail(a.code as "USDT" | "USDC", a.network ?? "ETHEREUM") : lightningRail;
      const rq = await rail.quote({ amountXaf: xaf, asset: a.code, network: a.network });
      const fx = fxRate(key, "XAF", now);
      const off = enabled[method] === false;
      if (!fx) { options.push(opt({ key, a, intent, fees: lines(0, settle.fees.provider, feeXaf, 0), amount: 0, label: "—", fx: null, expiresAt, latency: rq.latencySec, available: false, reason: "no fresh rate" })); continue; }
      const r = rateFor(method);
      const amount = inboundAmount(totalXaf, r);
      const spreadXaf = Math.round(amount * (r.midXafPerUnit - r.customerXafPerUnit));
      options.push(opt({ key, a, intent, fees: lines(rq.fees.network, settle.fees.provider, feeXaf, spreadXaf), amount, label: formatAmount(amount, r.asset), fx, expiresAt, latency: rq.latencySec, available: !off && rq.available && settle.available, reason: off ? "switched off in Settings" : !settle.available ? settle.reason : rq.reason }));
    }
    // Funding with Mobile Money itself (MTN → Orange): the admin-gated transfer product.
    const mt = getSettings().features.momoTransfer;
    options.push({ id: id("qo"), sourceRail: "MOBILE_MONEY", sourceAsset: "XAF", sourceNetwork: null, sourceAmount: totalXaf, sourceAmountLabel: `${totalXaf.toLocaleString("en-US").replace(/,/g, " ")} XAF`, destinationRail: "MOBILE_MONEY", destinationAmount: { value: xaf, currency: "XAF" }, fx: null, fees: lines(0, settle.fees.provider, feeXaf, 0), latencySec: { p50: 60, p95: 600 }, expiresAt, available: !!mt && settle.available, reason: mt ? settle.reason : "Mobile Money → Mobile Money is switched off (features.momoTransfer)" });
  } else if (idn?.type === "MSISDN" && idn.country && mm) {
    // Cross-border: the network layer prices and routes it (source = the payer's Mobile Money).
    if (!flag("CROSS_BORDER_ROUTING_ENABLED") || !corridorFlag("CM", idn.country)) {
      options.push({ id: id("qo"), sourceRail: "MOBILE_MONEY", sourceAsset: "XAF", sourceNetwork: null, sourceAmount: 0, sourceAmountLabel: "—", destinationRail: "MOBILE_MONEY", destinationAmount: { value: intent.amount.value, currency: intent.amount.currency }, fx: null, fees: lines(0, 0, 0, 0), latencySec: { p50: 0, p95: 0 }, expiresAt, available: false, reason: `corridor CM-${idn.country} is not enabled (CROSS_BORDER_ROUTING_ENABLED + CORRIDOR_CM_${idn.country}_ENABLED)` });
    } else {
      const disc = await discover({ id: intent.id, owner: intent.owner, sourceMarket: "CM", sourceProvider: "MTN", sourceCurrency: "XAF", sourcePhone: "", destinationMarket: idn.country, destinationProvider: mm.provider as never, destinationCurrency: intent.amount.currency as never, destinationPhone: idn.canonical, sourceAmount: intent.amount.value, status: "OPEN", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never).catch(() => ({ routes: [], quotes: [], reasons: ["router error"] }));
      for (const q of disc.quotes) options.push({ id: q.id, sourceRail: "MOBILE_MONEY", sourceAsset: q.sourceCurrency, sourceNetwork: null, sourceAmount: q.totalSource, sourceAmountLabel: `${q.totalSource} ${q.sourceCurrency}`, destinationRail: "MOBILE_MONEY", destinationAmount: { value: q.destinationAmount, currency: q.destinationCurrency }, fx: { pair: `${q.fx.from}/${q.fx.to}`, rate: q.fx.rate, mid: q.fx.mid, spreadBps: q.fx.spreadBps, source: q.fx.source, timestamp: q.fx.at, expiresAt: q.fx.expiresAt }, fees: { network: q.fees.lightning, provider: q.fees.providerCollect + q.fees.providerPayout, momome: q.fees.momome, fxSpread: q.fees.fxSpread, liquidity: q.fees.liquidity, total: q.fees.total, currency: q.sourceCurrency }, latencySec: { p50: 120, p95: 900 }, expiresAt: q.fx.expiresAt, available: true });
      if (!disc.quotes.length) options.push({ id: id("qo"), sourceRail: "MOBILE_MONEY", sourceAsset: "XAF", sourceNetwork: null, sourceAmount: 0, sourceAmountLabel: "—", destinationRail: "MOBILE_MONEY", destinationAmount: { value: intent.amount.value, currency: intent.amount.currency }, fx: null, fees: lines(0, 0, 0, 0), latencySec: { p50: 0, p95: 0 }, expiresAt, available: false, reason: disc.reasons.join("; ") || "no route" });
    }
  } else if (intent.recipient.destinations.some((d) => d.rail === "LIGHTNING" && !idn?.native)) {
    options.push({ id: id("qo"), sourceRail: "LIGHTNING", sourceAsset: "BTC", sourceNetwork: "LIGHTNING", sourceAmount: 0, sourceAmountLabel: "—", destinationRail: "LIGHTNING", destinationAmount: { value: intent.amount.value, currency: intent.amount.currency }, fx: fxRate("XAF", "BTC/LIGHTNING", now), fees: lines(0, 0, 0, 0), latencySec: { p50: 5, p95: 60 }, expiresAt, available: false, reason: "paying a foreign Lightning Address from MoMo›Me is not offered (no outbound Lightning product)" });
  }
  return { id: id("q2"), options, expiresAt };
}
function lines(network: number, provider: number, momome: number, fxSpread: number, liquidity = 0): FeeLines { return { network, provider, momome, fxSpread, liquidity, total: network + provider + momome + fxSpread + liquidity, currency: "XAF" }; }
function opt(x: { key: string; a: { code: string; network: string | null }; intent: PaymentIntentV2; fees: FeeLines; amount: number; label: string; fx: QuoteOption["fx"]; expiresAt: string; latency: QuoteOption["latencySec"]; available: boolean; reason?: string }): QuoteOption {
  return { id: id("qo"), sourceRail: x.a.network === "LIGHTNING" ? "LIGHTNING" : "STABLECOIN", sourceAsset: x.a.code, sourceNetwork: x.a.network, sourceAmount: x.amount, sourceAmountLabel: x.label, destinationRail: "MOBILE_MONEY", destinationAmount: { value: x.intent.amount.value, currency: x.intent.amount.currency }, fx: x.fx, fees: x.fees, latencySec: x.latency, expiresAt: x.expiresAt, available: x.available, reason: x.reason };
}
