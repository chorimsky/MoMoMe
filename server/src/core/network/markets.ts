/* ============================================================
   Markets and corridors — configuration, not code (§41, §42).

   A market is a liquidity node: currency, providers, aggregators, limits, compliance
   rules. Cameroon is derived from the production COUNTRIES entry so the two can never
   disagree; every other market is data that stays `enabled: false` until its rails,
   liquidity and FX exist (§ PHASE 6: "do not activate a corridor because the API exists").

   Adding a market = a row here. SWITCHING one on is configuration: settings.network.markets
   overlays `enabled` and each provider's collect/payout role on the base table, so a
   corridor is activated from the admin console (and rolled back the same way) without a
   deploy. Cameroon's row cannot be switched off here — that is the live engine.
   ============================================================ */
import type { Corridor, MarketCode, MarketConfig, NetworkProviderId } from "../../../../shared/network.js";
import { COUNTRIES } from "../../../../shared/domain.js";
import { getSettings } from "../settings.js";

const CM = COUNTRIES.CM;
export const MARKETS: Record<MarketCode, MarketConfig> = {
  CM: {
    code: "CM", name: CM.name, currency: CM.ccy, dial: CM.dial,
    providers: [
      { id: "MTN", name: "MTN MoMo", collect: true, payout: true, maxPerTx: 1_000_000 },
      { id: "ORANGE", name: "Orange Money", collect: true, payout: true, maxPerTx: 1_000_000 },
    ],
    aggregators: ["peexit", "pawapay"],
    limits: { minPerTx: 500, maxPerTx: 5_000_000, maxPerDay: 2_000_000 },
    compliance: ["CEMAC Règlement N°02/24", "BEAC Instruction N°002/GR/2026", "ANIF STR/CTR"],
    enabled: true,
  },
  GA: { code: "GA", name: "Gabon", currency: "XAF", dial: "+241", providers: [{ id: "AIRTEL", name: "Airtel Money", collect: false, payout: false }, { id: "MOOV", name: "Moov Money", collect: false, payout: false }], aggregators: [], limits: { minPerTx: 500, maxPerTx: 2_000_000 }, compliance: ["CEMAC Règlement N°02/24"], enabled: false },
  CG: { code: "CG", name: "Congo", currency: "XAF", dial: "+242", providers: [{ id: "MTN", name: "MTN MoMo", collect: false, payout: false }, { id: "AIRTEL", name: "Airtel Money", collect: false, payout: false }], aggregators: [], limits: { minPerTx: 500, maxPerTx: 2_000_000 }, compliance: ["CEMAC Règlement N°02/24"], enabled: false },
  TD: { code: "TD", name: "Chad", currency: "XAF", dial: "+235", providers: [{ id: "AIRTEL", name: "Airtel Money", collect: false, payout: false }, { id: "MOOV", name: "Moov Money", collect: false, payout: false }], aggregators: [], limits: { minPerTx: 500, maxPerTx: 2_000_000 }, compliance: ["CEMAC Règlement N°02/24"], enabled: false },
  CF: { code: "CF", name: "Central African Republic", currency: "XAF", dial: "+236", providers: [{ id: "ORANGE", name: "Orange Money", collect: false, payout: false }, { id: "MTN", name: "MTN MoMo", collect: false, payout: false }], aggregators: [], limits: { minPerTx: 500, maxPerTx: 2_000_000 }, compliance: ["CEMAC Règlement N°02/24"], enabled: false },
  KE: { code: "KE", name: "Kenya", currency: "KES", dial: "+254", providers: [{ id: "MPESA", name: "M-Pesa", collect: false, payout: false, maxPerTx: 250_000 }, { id: "AIRTEL", name: "Airtel Money", collect: false, payout: false }], aggregators: [], limits: { minPerTx: 50, maxPerTx: 500_000, maxPerDay: 500_000 }, compliance: ["CBK NPS Regulations 2014", "POCAMLA", "FRC STR"], enabled: false },
  GH: { code: "GH", name: "Ghana", currency: "GHS", dial: "+233", providers: [{ id: "MTN", name: "MTN MoMo", collect: false, payout: false }, { id: "TELECEL", name: "Telecel Cash", collect: false, payout: false }, { id: "AIRTELTIGO", name: "AT Money", collect: false, payout: false }], aggregators: [], limits: { minPerTx: 5, maxPerTx: 50_000 }, compliance: ["BoG Payment Systems Act 987", "FIC STR"], enabled: false },
  NG: { code: "NG", name: "Nigeria", currency: "NGN", dial: "+234", providers: [{ id: "MTN", name: "MoMo PSB", collect: false, payout: false }, { id: "AIRTEL", name: "Airtel SmartCash", collect: false, payout: false }, { id: "OPAY", name: "OPay", collect: false, payout: false }], aggregators: [], limits: { minPerTx: 500, maxPerTx: 5_000_000 }, compliance: ["CBN PSB Guidelines", "NFIU STR"], enabled: false },
  SN: { code: "SN", name: "Senegal", currency: "XOF", dial: "+221", providers: [{ id: "WAVE", name: "Wave", collect: false, payout: false }, { id: "ORANGE", name: "Orange Money", collect: false, payout: false }], aggregators: [], limits: { minPerTx: 500, maxPerTx: 2_000_000 }, compliance: ["BCEAO Instruction 008-05-2015"], enabled: false },
  CI: { code: "CI", name: "Côte d'Ivoire", currency: "XOF", dial: "+225", providers: [{ id: "ORANGE", name: "Orange Money", collect: false, payout: false }, { id: "MTN", name: "MTN MoMo", collect: false, payout: false }, { id: "WAVE", name: "Wave", collect: false, payout: false }], aggregators: [], limits: { minPerTx: 500, maxPerTx: 2_000_000 }, compliance: ["BCEAO Instruction 008-05-2015"], enabled: false },
};

/** The base row with the operator's overrides applied (settings.network.markets). */
export function market(code: string): MarketConfig | undefined {
  const base = MARKETS[code];
  if (!base) return undefined;
  const o = getSettings().network.markets?.[code];
  if (!o) return base;
  return {
    ...base,
    enabled: code === "CM" ? base.enabled : (o.enabled ?? base.enabled),
    providers: base.providers.map((p) => ({ ...p, ...(o.providers?.[p.id] ? { collect: o.providers[p.id].collect ?? p.collect, payout: o.providers[p.id].payout ?? p.payout } : {}) })),
  };
}
export const markets = (): MarketConfig[] => Object.keys(MARKETS).map((c) => market(c)!);
export const corridorId = (src: MarketCode, dst: MarketCode) => `${src}-${dst}`;
export const currencyOf = (code: MarketCode): string => MARKETS[code]?.currency ?? "";

/** A provider that can play a role in a market, honouring the emergency controls (§46). */
export function providerAvailable(code: MarketCode, provider: NetworkProviderId, role: "collect" | "payout"): { ok: boolean; reason?: string } {
  const m = market(code);
  if (!m) return { ok: false, reason: `unknown market ${code}` };
  const n = getSettings().network;
  if (!m.enabled) return { ok: false, reason: `${m.name} is not enabled` };
  if (n.disabled.markets.includes(code)) return { ok: false, reason: `${m.name} disabled by operator` };
  const p = m.providers.find((x) => x.id === provider);
  if (!p) return { ok: false, reason: `${provider} is not a provider in ${m.name}` };
  if (n.disabled.providers.includes(`${code}:${provider}`) || n.disabled.providers.includes(provider)) return { ok: false, reason: `${provider} ${code} disabled by operator` };
  if (!p[role]) return { ok: false, reason: `${provider} ${code} cannot ${role} yet` };
  return { ok: true };
}

/** Every corridor the configuration can express: enabled markets × enabled markets, with the
 *  operator switch and a computed readiness the router refines with liquidity. */
export function corridors(readiness: (c: Corridor) => { status: Corridor["status"]; reasons: string[] }): Corridor[] {
  const n = getSettings().network;
  const out: Corridor[] = [];
  const codes = Object.keys(MARKETS);
  for (const src of codes) for (const dst of codes) {
    const s = market(src)!, d = market(dst)!;
    const idc = corridorId(src, dst);
    const c: Corridor = {
      id: idc, source: src, destination: dst, sourceCurrency: s.currency, destinationCurrency: d.currency,
      sourceProviders: s.providers.filter((p) => p.collect).map((p) => p.id),
      destinationProviders: d.providers.filter((p) => p.payout).map((p) => p.id),
      enabled: !!n.corridors[idc], status: "INACTIVE", reasons: [],
    };
    const r = readiness(c);
    c.status = r.status; c.reasons = r.reasons;
    out.push(c);
  }
  // Only corridors that could ever exist: both markets enabled, or the operator switched it on.
  return out.filter((c) => (market(c.source)!.enabled && market(c.destination)!.enabled) || c.enabled);
}
