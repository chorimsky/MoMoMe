/* ============================================================
   Provider adapters — one normalised interface around every Mobile Money rail (§18, §19).

   Cameroon is served by WRAPPING the production adapters (adapters/payouts.ts: Peexit,
   PawaPay; adapters/peexit.ts collect): the same code that moves real money today,
   called through this interface, never rewritten. Markets without a live rail get a
   SIMULATED adapter — sandbox only (RAILS_MODE=sandbox) — so corridors can be rehearsed
   end to end, including their failure modes, before a real integration exists.

   The network's saga (saga.ts) talks ONLY to this interface. A new provider or aggregator
   is one more implementation registered here; the engine does not change (§17).
   ============================================================ */
import type { MarketCode, NetworkProviderId } from "../../../../shared/network.js";
import type { CountryCode, ProviderId } from "../../../../shared/types.js";
import { PAYOUTS, payoutByName } from "../../adapters/payouts.js";
import * as peexit from "../../adapters/peexit.js";
import { peexitLive } from "../../config.js";
import { payoutHealth } from "../routing.js";
import { MARKETS } from "./markets.js";
import { pawapayMarketAdapter, pawapayMarkets } from "./pawapayMarkets.js";

export type OpStatus = "PENDING" | "COMPLETED" | "FAILED";
export interface CollectionRequest { idempotencyKey: string; market: MarketCode; provider: NetworkProviderId; phone: string; amount: number; currency: string; name?: string }
export interface PayoutRequest { idempotencyKey: string; market: MarketCode; provider: NetworkProviderId; phone: string; amount: number; currency: string; name?: string }
export interface OpResult { accepted: boolean; providerRef: string; simulated: boolean; duplicate?: boolean; error?: string }

export interface MobileMoneyProviderAdapter {
  /** Stable id: "cm:peexit", "cm:pawapay", "sim:ke". */
  readonly id: string;
  readonly market: MarketCode;
  readonly aggregator: string;
  readonly simulated: boolean;
  configured(): boolean;
  live(): boolean;
  supports(provider: NetworkProviderId, role: "collect" | "payout"): boolean;
  verifyRecipient(provider: NetworkProviderId, phone: string): Promise<{ ok: boolean; name?: string; reason?: string }>;
  createCollection(req: CollectionRequest): Promise<OpResult>;
  getCollectionStatus(idempotencyKey: string): Promise<OpStatus | null>;
  createPayout(req: PayoutRequest): Promise<OpResult>;
  getPayoutStatus(idempotencyKey: string): Promise<OpStatus | null>;
  /** Available payout balance in the market's currency. null = unknown. */
  getBalance(provider?: NetworkProviderId): Promise<number | null>;
  getLimits(provider: NetworkProviderId): { maxPerTx: number; maxPerDay: number };
  getSupportedCurrencies(): string[];
  getProviderHealth(): { status: "OPERATIONAL" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED" | "SANDBOX"; successRate: number; avgLatencyMs: number };
  /** What this adapter charges on a payout, as a fraction. null = unknown. */
  payoutFeePct(provider: NetworkProviderId): Promise<number | null>;
}

/* ---------- Cameroon: wraps the production adapters ---------- */
function wrapProductionPayout(name: "peexit" | "pawapay"): MobileMoneyProviderAdapter {
  const p = payoutByName(name)!;
  const m = MARKETS.CM;
  return {
    id: `cm:${name}`, market: "CM", aggregator: name, simulated: false,
    configured: () => p.configured(),
    live: () => p.live(),
    supports: (provider, role) => (role === "payout" ? p.supports(provider as ProviderId) : name === "peexit" && (provider === "MTN" || provider === "ORANGE")),
    verifyRecipient: async (_provider, phone) => ({ ok: /^\d{8,9}$/.test(phone.replace(/\D/g, "")) }),
    createCollection: async (req) => {
      // Collection exists only on Peexit (the momo-transfer product uses it in production).
      if (name !== "peexit") return { accepted: false, providerRef: "", simulated: false, error: "collection not supported" };
      const r = await peexit.collect({ idempotencyKey: req.idempotencyKey, provider: req.provider as ProviderId, country: "CM" as CountryCode, phone: req.phone, xaf: req.amount, name: req.name });
      return { accepted: r.status === "accepted", providerRef: r.providerRef, simulated: r.simulated };
    },
    getCollectionStatus: async (key) => (name === "peexit" ? peexit.collectStatus(key) : null),
    createPayout: async (req) => {
      const r = await p.disburse({ idempotencyKey: req.idempotencyKey, provider: req.provider as ProviderId, country: "CM" as CountryCode, phone: req.phone, xaf: req.amount, name: req.name });
      return { accepted: true, providerRef: r.providerRef, simulated: r.simulated, duplicate: r.status === "duplicate" };
    },
    getPayoutStatus: async (key) => p.queryStatus(key),
    getBalance: async (provider) => p.balance("CM" as CountryCode, provider as ProviderId | undefined),
    getLimits: (provider) => ({ maxPerTx: m.providers.find((x) => x.id === provider)?.maxPerTx ?? m.limits.maxPerTx, maxPerDay: m.limits.maxPerDay ?? m.limits.maxPerTx }),
    getSupportedCurrencies: () => ["XAF"],
    getProviderHealth: () => {
      const h = payoutHealth(name);
      const status = !p.configured() ? "NOT_CONFIGURED" : !h.eligible ? "DOWN" : !p.live() ? "SANDBOX" : h.successRate < 0.9 ? "DEGRADED" : "OPERATIONAL";
      return { status, successRate: h.successRate, avgLatencyMs: h.avgLatencyMs };
    },
    payoutFeePct: async (provider) => (p.payoutFeePct ? p.payoutFeePct(provider as ProviderId, "CM" as CountryCode).catch(() => null) : null),
  };
}

/* ---------- simulated market rail (sandbox only) ---------- */
type SimOp = { status: OpStatus; providerRef: string; failNext?: boolean };
const simOps = new Map<string, SimOp>();
/** Test seam: make the NEXT operation with this key fail (payout-failure rehearsal, §29/§50). */
export function simulateFailure(idempotencyKey: string): void { simOps.set(`fail:${idempotencyKey}`, { status: "FAILED", providerRef: "", failNext: true }); }
/** Test seam: a provider callback for a simulated operation. */
export function simulateCallback(idempotencyKey: string, status: OpStatus): void { const op = simOps.get(idempotencyKey); if (op) op.status = status; }

function simulatedAdapter(marketCode: MarketCode): MobileMoneyProviderAdapter {
  const m = MARKETS[marketCode];
  const sandbox = () => process.env.RAILS_MODE === "sandbox";
  // A collection waits for the payer (the test/sandbox drives its callback); a payout
  // settles at once unless a failure was scheduled — like a real aggregator's happy path.
  const run = (req: { idempotencyKey: string }, kind: "collection" | "payout"): OpResult => {
    const existing = simOps.get(req.idempotencyKey);
    if (existing) return { accepted: true, providerRef: existing.providerRef, simulated: true, duplicate: true };
    const fail = simOps.get(`fail:${req.idempotencyKey}`);
    const ref = `sim_${marketCode.toLowerCase()}_${Math.random().toString(36).slice(2, 10)}`;
    simOps.set(req.idempotencyKey, { status: fail ? "FAILED" : kind === "payout" ? "COMPLETED" : "PENDING", providerRef: ref });
    return { accepted: true, providerRef: ref, simulated: true };
  };
  return {
    id: `sim:${marketCode.toLowerCase()}`, market: marketCode, aggregator: "simulated", simulated: true,
    configured: () => sandbox(),
    live: () => false,
    supports: (provider) => sandbox() && !!m.providers.find((p) => p.id === provider),
    verifyRecipient: async (_p, phone) => ({ ok: phone.replace(/\D/g, "").length >= 8, name: "Simulated Recipient" }),
    createCollection: async (req) => run(req, "collection"),
    getCollectionStatus: async (key) => simOps.get(key)?.status ?? null,
    createPayout: async (req) => run(req, "payout"),
    getPayoutStatus: async (key) => simOps.get(key)?.status ?? null,
    getBalance: async () => null, // liquidity comes from settings.simulatedLiquidity (liquidity.ts)
    getLimits: (provider) => ({ maxPerTx: m.providers.find((x) => x.id === provider)?.maxPerTx ?? m.limits.maxPerTx, maxPerDay: m.limits.maxPerDay ?? m.limits.maxPerTx }),
    getSupportedCurrencies: () => [m.currency],
    getProviderHealth: () => ({ status: sandbox() ? "SANDBOX" : "NOT_CONFIGURED", successRate: 1, avgLatencyMs: 200 }),
    payoutFeePct: async () => 0.01,
  };
}

/* ---------- registry ---------- */
const registry: MobileMoneyProviderAdapter[] = [];
export function adaptersFor(marketCode: MarketCode): MobileMoneyProviderAdapter[] {
  if (!registry.length) {
    registry.push(wrapProductionPayout("peexit"), wrapProductionPayout("pawapay"));
    // PawaPay's other markets: one adapter each over the same v2 contract (PHASE 6).
    for (const code of pawapayMarkets()) if (MARKETS[code]) registry.push(pawapayMarketAdapter(code));
    // Every market gets a simulated rail for the sandbox; Cameroon's is used only when no
    // production rail is configured (a sandbox deployment), never beside a real one.
    for (const code of Object.keys(MARKETS)) registry.push(simulatedAdapter(code));
  }
  const real = registry.filter((a) => a.market === marketCode && !a.simulated && a.configured());
  if (real.length) return real;
  return registry.filter((a) => a.market === marketCode && a.simulated && a.configured());
}
export function adapterById(id: string): MobileMoneyProviderAdapter | undefined { adaptersFor("CM"); return registry.find((a) => a.id === id); }
/** Peexit collect is the only live collection today; say so honestly. */
export const collectionLive = (): boolean => peexitLive() && PAYOUTS.some((p) => p.name === "peexit" && p.live());
