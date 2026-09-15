/* ============================================================
   PawaPay beyond Cameroon — the first multi-market rail (PHASE 6).

   PawaPay's v2 API is one contract across its markets: the recipient carries the
   provider code (MPESA_KEN, MTN_MOMO_GHA …) and the amount is in the market's currency.
   This module is an ADAPTER PER MARKET over that contract, registered beside the
   Cameroon production adapter and never touching it (adapters/pawapay.ts keeps its own
   correspondent table, idempotency map and callback path).

   Safety:
   · configured() needs PAWAPAY_API_KEY; live() additionally needs the production URL,
     the same rule as the Cameroon rail. A sandbox key rehearses against PawaPay's sandbox.
   · every payout id is the v4 UUID derived from the saga's idempotency key (PawaPay
     dedupes on it), so a retry can never pay twice;
   · a provider is only OFFERED (supports) when its market row says so — switching a
     provider on is configuration (settings.network.markets), and the activation
     checklist asks PawaPay's active-conf whether it agrees.
   ============================================================ */
import type { MarketCode, NetworkProviderId } from "../../../../shared/network.js";
import { fetchT } from "../../adapters/http.js";
import { payoutIdFor } from "../../adapters/pawapay.js";
import { config, pawapayConfigured, pawapayLive } from "../../config.js";
import { register, touch } from "../persist.js";
import { getSettings } from "../settings.js";
import { market } from "./markets.js";
import type { MobileMoneyProviderAdapter, OpResult, OpStatus, PayoutRequest, CollectionRequest } from "./adapters.js";

/** ISO-3166 alpha-3 as PawaPay names countries. */
export const ISO3: Record<string, string> = { KE: "KEN", GH: "GHA", NG: "NGA", SN: "SEN", CI: "CIV", GA: "GAB", CG: "COG", TD: "TCD", UG: "UGA", TZ: "TZA", RW: "RWA" };
/** Provider codes per market, as published by PawaPay. Confirm against active-conf before
 *  a corridor is activated (activation.ts does); a wrong code is a REJECTED payout, not money lost. */
export const PROVIDER_CODES: Record<string, Record<string, string>> = {
  KE: { MPESA: "MPESA_KEN", AIRTEL: "AIRTEL_KEN" },
  GH: { MTN: "MTN_MOMO_GHA", TELECEL: "VODAFONE_GHA", AIRTELTIGO: "AIRTELTIGO_GHA" },
  NG: { MTN: "MTN_MOMO_NGA", AIRTEL: "AIRTEL_NGA" },
  SN: { ORANGE: "ORANGE_SEN", WAVE: "WAVE_SEN" },
  CI: { ORANGE: "ORANGE_CIV", MTN: "MTN_MOMO_CIV", WAVE: "WAVE_CIV" },
  GA: { AIRTEL: "AIRTEL_GAB", MOOV: "MOOV_GAB" },
  CG: { MTN: "MTN_MOMO_COG", AIRTEL: "AIRTEL_COG" },
  TD: { AIRTEL: "AIRTEL_TCD", MOOV: "MOOV_TCD" },
};
export const pawapayMarkets = (): MarketCode[] => Object.keys(PROVIDER_CODES);

/** Currencies PawaPay quotes with two decimals; the CFA francs are zero-decimal. */
const amountStr = (amount: number, ccy: string) => (["XAF", "XOF", "UGX", "RWF"].includes(ccy) ? String(Math.round(amount)) : (Math.round(amount * 100) / 100).toFixed(2).replace(/\.00$/, ""));
const msisdn = (phone: string, dial: string) => { const d = dial.replace(/\D/g, ""), p = phone.replace(/\D/g, ""); return p.startsWith(d) ? p : d + p; };
const H = () => ({ "content-type": "application/json", authorization: `Bearer ${config.pawapay.apiKey}` });

type Op = { providerRef: string; status: OpStatus; kind: "payout" | "deposit" };
const ops = new Map<string, Op>(); // idempotency key → op
register("network_pawapay", () => [...ops], (d: [string, Op][]) => { for (const [k, v] of d) ops.set(k, v); });

const mapStatus = (raw: string | undefined): OpStatus => { const s = (raw ?? "").toUpperCase(); return s === "COMPLETED" ? "COMPLETED" : ["FAILED", "REJECTED"].includes(s) ? "FAILED" : "PENDING"; };

async function submit(kind: "payouts" | "deposits", key: string, body: Record<string, unknown>): Promise<OpResult> {
  const existing = ops.get(key);
  if (existing) return { accepted: true, providerRef: existing.providerRef, simulated: !pawapayLive(), duplicate: true };
  const idField = kind === "payouts" ? "payoutId" : "depositId";
  const opId = payoutIdFor(key);
  try {
    const res = await fetchT(`${config.pawapay.apiUrl}/v2/${kind}`, { method: "POST", headers: H(), body: JSON.stringify({ [idField]: opId, ...body }) });
    const data = (await res.json().catch(() => ({}))) as { status?: string; failureReason?: { failureCode?: string; failureMessage?: string } };
    const s = (data.status ?? "").toUpperCase();
    if (!["ACCEPTED", "DUPLICATE_IGNORED"].includes(s)) {
      const why = data.failureReason ? `${data.failureReason.failureCode}: ${data.failureReason.failureMessage}` : `HTTP ${res.status}`;
      return { accepted: false, providerRef: opId, simulated: !pawapayLive(), error: `PawaPay ${kind.slice(0, -1)} not accepted: ${why}` };
    }
    ops.set(key, { providerRef: opId, status: "PENDING", kind: kind === "payouts" ? "payout" : "deposit" }); touch("network_pawapay");
    return { accepted: true, providerRef: opId, simulated: !pawapayLive() };
  } catch (e) { return { accepted: false, providerRef: opId, simulated: !pawapayLive(), error: e instanceof Error ? e.message : "pawapay unreachable" }; }
}

async function status(key: string): Promise<OpStatus | null> {
  const op = ops.get(key);
  if (!op) return null;
  if (op.status !== "PENDING") return op.status;
  try {
    const res = await fetchT(`${config.pawapay.apiUrl}/v2/${op.kind}s/${op.providerRef}`, { headers: H() });
    if (!res.ok) return "PENDING";
    const d = (await res.json()) as { status?: string; data?: { status?: string } };
    if ((d.status ?? "").toUpperCase() === "NOT_FOUND") return "PENDING";
    const s = mapStatus(d.data?.status);
    if (s !== "PENDING") { op.status = s; touch("network_pawapay"); }
    return s;
  } catch { return "PENDING"; }
}

const balCache = new Map<string, { at: number; amount: number | null }>();
async function balance(iso: string, ccy: string): Promise<number | null> {
  const hit = balCache.get(iso);
  if (hit && Date.now() - hit.at < 15_000) return hit.amount;
  let amount: number | null = null;
  try {
    const res = await fetchT(`${config.pawapay.apiUrl}/v2/wallet-balances?country=${iso}`, { headers: H() });
    if (res.ok) {
      const data = (await res.json()) as { balances?: Array<{ country?: string; balance?: string; currency?: string }> };
      let sum = 0, any = false;
      for (const b of data.balances ?? []) { if (b.currency !== ccy || (b.country && b.country !== iso)) continue; const n = Number(b.balance); if (Number.isFinite(n)) { sum += n; any = true; } }
      amount = any ? sum : null;
    } else console.error(`[pawapay ${iso}] wallet-balance read failed: ${res.status}`);
  } catch (e) { console.error(`[pawapay ${iso}] wallet-balance unreachable: ${e instanceof Error ? e.message : e}`); }
  balCache.set(iso, { at: Date.now(), amount });
  return amount;
}

/** PawaPay's own view of what it can do for us in a country: provider codes with an
 *  operation available. Used by the activation checklist; null when unreachable. */
export async function activeProviders(code: MarketCode, op: "PAYOUT" | "DEPOSIT"): Promise<string[] | null> {
  const iso = ISO3[code];
  if (!iso || !pawapayConfigured()) return null;
  try {
    const res = await fetchT(`${config.pawapay.apiUrl}/v2/active-conf?country=${iso}&operationType=${op}`, { headers: H() });
    if (!res.ok) return null;
    const data = (await res.json()) as unknown;
    const found = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") { const o = v as Record<string, unknown>; if (typeof o.provider === "string") found.add(o.provider); for (const k of Object.keys(o)) walk(o[k]); }
    };
    walk(data);
    return [...found];
  } catch { return null; }
}

export function pawapayMarketAdapter(code: MarketCode): MobileMoneyProviderAdapter {
  const codes = PROVIDER_CODES[code] ?? {};
  const iso = ISO3[code] ?? code;
  const m = () => market(code)!;
  const health = () => {
    const n = getSettings().network;
    const disabled = n.disabled.aggregators.includes("pawapay") || n.disabled.markets.includes(code);
    return !pawapayConfigured() ? "NOT_CONFIGURED" as const : disabled ? "DOWN" as const : !pawapayLive() ? "SANDBOX" as const : "OPERATIONAL" as const;
  };
  const supported = (provider: NetworkProviderId, role: "collect" | "payout") => !!codes[provider] && !!m().providers.find((p) => p.id === provider && p[role]);
  return {
    id: `${code.toLowerCase()}:pawapay`, market: code, aggregator: "pawapay", simulated: false,
    configured: () => pawapayConfigured() && !!m().enabled,
    live: () => pawapayLive(),
    supports: supported,
    verifyRecipient: async (_provider, phone) => ({ ok: phone.replace(/\D/g, "").length >= 8 }),
    createCollection: async (req: CollectionRequest) => submit("deposits", req.idempotencyKey, {
      payer: { type: "MMO", accountDetails: { phoneNumber: msisdn(req.phone, m().dial), provider: codes[req.provider] } },
      amount: amountStr(req.amount, req.currency), currency: req.currency, customerMessage: "MoMoMe payment",
    }),
    getCollectionStatus: status,
    createPayout: async (req: PayoutRequest) => submit("payouts", req.idempotencyKey, {
      recipient: { type: "MMO", accountDetails: { phoneNumber: msisdn(req.phone, m().dial), provider: codes[req.provider] } },
      amount: amountStr(req.amount, req.currency), currency: req.currency, customerMessage: "MoMoMe payout",
    }),
    getPayoutStatus: status,
    getBalance: async () => balance(iso, m().currency),
    getLimits: (provider) => ({ maxPerTx: m().providers.find((x) => x.id === provider)?.maxPerTx ?? m().limits.maxPerTx, maxPerDay: m().limits.maxPerDay ?? m().limits.maxPerTx }),
    getSupportedCurrencies: () => [m().currency],
    getProviderHealth: () => ({ status: health(), successRate: 1, avgLatencyMs: 0 }),
    payoutFeePct: async () => null, // per-market pricing is in the PawaPay contract, not the API
  };
}
