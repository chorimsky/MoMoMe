/* ============================================================
   Rail & provider registry — ONE view over the two adapter families that already exist:
   crypto INBOUND rails (adapters/index.ts: IBEX, phoenixd, sandbox) and Mobile-Money PAYOUT
   rails (adapters/payouts.ts: Peexit, PawaPay). Nothing here talks to a provider; it reads
   configuration, health and balances the adapters already expose and describes them in the
   rail-neutral vocabulary of shared/interop.ts.

   Adding a rail = implement its adapter, register it in its family, add a describe() row
   here. The payment core does not change.
   ============================================================ */
import type { CountryCode, Method, ProviderId } from "../../../../shared/types.js";
import type { ProviderInfo, RailId, RailInfo, RailCapabilities } from "../../../../shared/interop.js";
import { COUNTRIES, MIN_XAF, MAX_XAF, PROVIDER_PAYOUT_MAX } from "../../../../shared/domain.js";
import { activeRails, railHealth, methodServable } from "../../adapters/index.js";
import { PAYOUTS } from "../../adapters/payouts.js";
import { payoutHealth } from "../routing.js";
import { getSettings } from "../settings.js";
import { rateFor } from "../fx.js";

const METHOD_RAIL: Record<Method, RailId> = { LIGHTNING: "lightning", ONCHAIN: "onchain_btc", USDT: "stablecoin", USDC: "stablecoin" };
export const railOfMethod = (m: Method): RailId => METHOD_RAIL[m];
export const methodsOfRail = (r: RailId): Method[] => (Object.keys(METHOD_RAIL) as Method[]).filter((m) => METHOD_RAIL[m] === r);

const CAPS: Record<RailId, RailCapabilities> = {
  mobile_money: { directions: ["send"], currencies: ["XAF"], instant: true, supportsInvoice: false, supportsAddress: true, supportsRefund: false, supportsQuote: true, supportsStatus: true },
  lightning:    { directions: ["receive", "send"], currencies: ["BTC"], instant: true, supportsInvoice: true, supportsAddress: true, supportsRefund: true, supportsQuote: true, supportsStatus: true },
  onchain_btc:  { directions: ["receive"], currencies: ["BTC"], instant: false, supportsInvoice: false, supportsAddress: true, supportsRefund: false, supportsQuote: true, supportsStatus: true },
  stablecoin:   { directions: ["receive"], currencies: ["USDT", "USDC"], instant: false, supportsInvoice: false, supportsAddress: true, supportsRefund: false, supportsQuote: true, supportsStatus: true },
  bank:         { directions: [], currencies: [], instant: false, supportsInvoice: false, supportsAddress: false, supportsRefund: false, supportsQuote: false, supportsStatus: false },
  card:         { directions: [], currencies: [], instant: false, supportsInvoice: false, supportsAddress: false, supportsRefund: false, supportsQuote: false, supportsStatus: false },
  ussd:         { directions: [], currencies: [], instant: false, supportsInvoice: false, supportsAddress: false, supportsRefund: false, supportsQuote: false, supportsStatus: false },
};

const REGULATED_PARTY: Record<RailId, string> = {
  mobile_money: "Licensed payout aggregator (Peexit / PawaPay) → MTN / Orange",
  lightning: "Licensed crypto rail operator (IBEX Hub) or MoMo›Me's own node",
  onchain_btc: "Licensed crypto rail operator (IBEX Hub)",
  stablecoin: "Licensed crypto rail operator (IBEX Hub)",
  bank: "Not connected", card: "Not connected", ussd: "Not connected",
};

function healthOf(h: { eligible: boolean; successRate: number }, configured: boolean, live: boolean): ProviderInfo["health"] {
  if (!configured) return "NOT_CONFIGURED";
  if (!h.eligible) return "DOWN";
  if (!live) return "SANDBOX";
  return h.successRate < 0.9 ? "DEGRADED" : "OPERATIONAL";
}

/** Providers on the crypto side, described rail-neutrally. */
export function cryptoProviders(): ProviderInfo[] {
  const out: ProviderInfo[] = [];
  for (const r of activeRails()) {
    if (r.name === "sandbox") continue;
    const methods = (["LIGHTNING", "ONCHAIN", "USDT", "USDC"] as Method[]).filter((m) => r.supports(m) && methodServable(m));
    const rails = [...new Set(methods.map(railOfMethod))];
    const h = railHealth(r.name);
    for (const rail of rails) {
      out.push({
        id: r.name, rail, name: r.name === "ibex" ? "IBEX Hub" : r.name === "phoenixd" ? "MoMo›Me node (phoenixd)" : r.name,
        reaches: methods.filter((m) => railOfMethod(m) === rail),
        countries: Object.values(COUNTRIES).filter((c) => c.active).map((c) => c.code),
        health: healthOf(h, r.configured(), r.trusted()), live: r.trusted(),
        successRate: h.successRate, avgLatencyMs: h.avgLatencyMs,
      });
    }
  }
  return out;
}

/** Providers on the Mobile-Money side, with live payout liquidity when they expose it. */
export async function payoutProviders(country: CountryCode = "CM"): Promise<ProviderInfo[]> {
  const out: ProviderInfo[] = [];
  for (const p of PAYOUTS) {
    const h = payoutHealth(p.name);
    const reaches = (COUNTRIES[country].providers as ProviderId[]).filter((op) => p.supports(op));
    const bal = p.configured() ? await p.balance(country).catch(() => null) : null;
    out.push({
      id: p.name, rail: "mobile_money", name: p.name === "peexit" ? "Peexit" : p.name === "pawapay" ? "PawaPay" : p.name,
      reaches, countries: [country],
      health: healthOf(h, p.configured(), p.live()), live: p.live(),
      successRate: h.successRate, avgLatencyMs: h.avgLatencyMs,
      liquidity: { currency: COUNTRIES[country].ccy, available: bal },
    });
  }
  return out;
}

export async function listProviders(country: CountryCode = "CM"): Promise<ProviderInfo[]> {
  return [...cryptoProviders(), ...(await payoutProviders(country))];
}

export async function listRails(country: CountryCode = "CM"): Promise<RailInfo[]> {
  const providers = await listProviders(country);
  const feePct = getSettings().pricing.feePct;
  const ccy = COUNTRIES[country].ccy;
  const maxPayout = Math.max(...(COUNTRIES[country].providers as ProviderId[]).map((p) => PROVIDER_PAYOUT_MAX[p] ?? MAX_XAF));
  return (Object.keys(CAPS) as RailId[]).map((id) => {
    const ps = providers.filter((p) => p.rail === id);
    const m = methodsOfRail(id)[0];
    const spread = m ? (() => { try { return rateFor(m).spreadBps; } catch { return undefined; } })() : undefined;
    return {
      // Mobile Money RECEIVES (a payer's own network collects) only when the admin has turned
      // Mobile Money → Mobile Money transfers on; the API says so instead of pretending.
      id, name: RAIL_NAME[id], capabilities: id === "mobile_money" && getSettings().features.momoTransfer ? { ...CAPS[id], directions: ["receive", "send"] } : CAPS[id], providers: ps,
      limits: id === "mobile_money" ? { currency: ccy, min: MIN_XAF, max: Math.min(MAX_XAF, maxPayout) } : { currency: ccy, min: MIN_XAF, max: MAX_XAF },
      fees: { platformPct: feePct, ...(spread !== undefined ? { spreadBps: spread } : {}) },
      regulatedParty: REGULATED_PARTY[id],
    };
  });
}

const RAIL_NAME: Record<RailId, string> = {
  mobile_money: "Mobile Money", lightning: "Lightning", onchain_btc: "Bitcoin (on-chain)", stablecoin: "Stablecoins (ERC-20)", bank: "Bank", card: "Card", ussd: "USSD",
};
