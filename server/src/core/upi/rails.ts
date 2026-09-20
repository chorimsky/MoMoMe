/* SettlementRail / RailAdapter abstraction — ONE interface over the rails that already move
   money, so the routing engine can ask any of them the same questions. Every adapter here
   WRAPS an existing production module; none re-implements one. `initiate` is deliberately
   narrow: execution still goes through the V1 engine (createPaymentCore / the network saga)
   so a retry can never produce a second payout or a second send — the idempotency the V1
   code already guarantees is the idempotency this layer inherits. */
import type { Rail, RailHealthState, FeeLines } from "../../../../shared/upi.js";
import { PAYOUTS } from "../../adapters/payouts.js";
import { activeRails, railHealth, createInstruction } from "../../adapters/index.js";
import { payoutHealth, aggregatorFloatXaf, payoutReady } from "../routing.js";
import { payoutCostXaf } from "../pricing.js";
import { positions } from "../network/liquidity.js";
import { flag } from "./flags.js";
import { liveMoney } from "../../config.js";
import type { CountryCode, ProviderId } from "../../../../shared/types.js";

export interface RailQuoteRequest { amountXaf: number; provider?: string; country?: string; asset?: string; network?: string | null }
export interface RailQuote { rail: Rail; fees: Pick<FeeLines, "network" | "provider"> & { currency: string }; latencySec: { p50: number; p95: number }; available: boolean; reason?: string }
export interface RailAdapterV2 {
  readonly rail: Rail;
  readonly id: string;
  quote(req: RailQuoteRequest): Promise<RailQuote>;
  /** Only rails that can be driven directly from this layer implement it; the others are
   *  executed by V1 (see intents.ts) and say so. */
  initiate?(req: { ref: string; amount: number; usd?: number; label?: string }): Promise<{ accepted: boolean; providerRef?: string; instruction?: unknown; error?: string }>;
  getStatus(reference: string): Promise<{ status: "PENDING" | "COMPLETED" | "FAILED" | "UNKNOWN" }>;
  getBalance(): Promise<{ amount: number | null; currency: string }>;
  getLiquidity(): Promise<{ available: number | null; reserved: number; committed: number; currency: string }>;
  health(): Promise<{ state: RailHealthState; reason?: string }>;
}

/** Lightning — wraps the crypto rail registry (IBEX / phoenixd / sandbox). */
export const lightningRail: RailAdapterV2 = {
  rail: "LIGHTNING", id: "BTC/LIGHTNING",
  async quote(req) { const h = await this.health(); return { rail: "LIGHTNING", fees: { network: 0, provider: 0, currency: "XAF" }, latencySec: { p50: 5, p95: 60 }, available: h.state !== "UNAVAILABLE", reason: h.reason }; void req; },
  async initiate(req) { try { const i = await createInstruction({ method: "LIGHTNING", ref: req.ref, amount: req.amount, usd: req.usd, label: req.label }); return { accepted: true, providerRef: i.providerRef, instruction: i }; } catch (e) { return { accepted: false, error: (e as Error).message }; } },
  async getStatus() { return { status: "UNKNOWN" }; }, // inbound status is owned by the V1 state machine (webhooks + polling)
  async getBalance() { return { amount: null, currency: "BTC" }; },
  async getLiquidity() { return { available: null, reserved: 0, committed: 0, currency: "BTC" }; },
  async health() { const r = activeRails().filter((x) => x.name !== "sandbox"); if (!r.length) return { state: "DEGRADED", reason: "sandbox only" }; return r.some((x) => railHealth(x.name).eligible) ? { state: "HEALTHY" } : { state: "UNAVAILABLE", reason: "every Lightning rail is marked down" }; },
};
/** Stablecoins — Ethereum USDT/USDC held at IBEX (third-party custody). Receive is real
 *  (V1 mints the address and reconciles deposits by tx hash); SEND is an abstraction until
 *  STABLECOIN_SETTLEMENT_ENABLED and a documented custody model — no key material exists
 *  in this codebase and none is invented here. */
export function stablecoinRail(asset: "USDT" | "USDC", network = "ETHEREUM"): RailAdapterV2 {
  return {
    rail: "STABLECOIN", id: `${asset}/${network}`,
    async quote() { const h = await this.health(); return { rail: "STABLECOIN", fees: { network: 0, provider: 0, currency: "XAF" }, latencySec: { p50: 180, p95: 900 }, available: h.state !== "UNAVAILABLE", reason: h.reason }; },
    async initiate(req) { if (network !== "ETHEREUM") return { accepted: false, error: `${asset}/${network} has no adapter` }; try { const i = await createInstruction({ method: asset, ref: req.ref, amount: req.amount, usd: req.usd, label: req.label }); return { accepted: true, providerRef: i.providerRef, instruction: i }; } catch (e) { return { accepted: false, error: (e as Error).message }; } },
    async getStatus() { return { status: "UNKNOWN" }; },
    async getBalance() { return { amount: null, currency: asset }; },
    async getLiquidity() { return { available: null, reserved: 0, committed: 0, currency: asset }; },
    async health() { if (network !== "ETHEREUM") return { state: "UNAVAILABLE", reason: "planned network — no adapter, custody or liquidity" }; const on = flag("STABLECOIN_SETTLEMENT_ENABLED") && flag(asset === "USDT" ? "STABLECOIN_USDT_ENABLED" : "STABLECOIN_USDC_ENABLED"); const r = activeRails().filter((x) => x.name !== "sandbox"); return !r.length ? { state: "DEGRADED", reason: "sandbox only" } : on ? { state: "HEALTHY" } : { state: "DEGRADED", reason: "receive only — outbound settlement flag off" }; },
  };
}
/** Mobile Money payout — wraps the payout rails (Peexit, PawaPay) for a market × operator. */
export function mobileMoneyRail(country: CountryCode, provider: ProviderId): RailAdapterV2 {
  const rails = () => PAYOUTS.filter((r) => r.configured() && r.supports(provider));
  return {
    rail: "MOBILE_MONEY", id: `${country}:${provider}`,
    async quote(req) { const h = await this.health(); const ready = await payoutReady(provider, country, req.amountXaf, false).catch(() => ({ ok: false, reason: "balance check failed" })); return { rail: "MOBILE_MONEY", fees: { network: 0, provider: (await payoutCostXaf(rails()[0]?.name ?? "assumed", provider, req.amountXaf)).cost, currency: "XAF" }, latencySec: { p50: 20, p95: 300 }, available: h.state !== "UNAVAILABLE" && ready.ok, reason: !ready.ok ? ready.reason : h.reason }; },
    async getStatus(ref) { for (const r of rails()) { const s = await r.queryStatus(ref).catch(() => null); if (s) return { status: s }; } return { status: "UNKNOWN" }; },
    async getBalance() { const r = rails()[0]; return { amount: r ? await r.balance(country, provider).catch(() => null) : null, currency: "XAF" }; },
    async getLiquidity() { return { available: await aggregatorFloatXaf().catch(() => null), reserved: 0, committed: 0, currency: "XAF" }; },
    async health() {
      const r = rails();
      // V1's own rule: no configured rail + no real money live = the simulated rail pays.
      if (!r.length) return liveMoney() ? { state: "UNAVAILABLE", reason: "no configured payout rail for this operator" } : { state: "DEGRADED", reason: "simulated payout rail (sandbox)" };
      const down = r.filter((x) => !payoutHealth(x.name).eligible);
      if (down.length === r.length) return { state: "UNAVAILABLE", reason: `every payout rail for ${provider} is down (${down.map((x) => x.name).join(", ")})` };
      return r.some((x) => x.live()) ? { state: "HEALTHY" } : { state: "DEGRADED", reason: "sandbox rail" };
    },
  };
}
/** Multi-market aggregator (PawaPay v2 for KE/GH/NG…) — the network layer's own rail. */
export function aggregatorRail(market: string, provider: string): RailAdapterV2 {
  return {
    rail: "MOBILE_MONEY", id: `${market}:${provider}`,
    async quote() { const h = await this.health(); return { rail: "MOBILE_MONEY", fees: { network: 0, provider: 0, currency: "XAF" }, latencySec: { p50: 60, p95: 600 }, available: h.state !== "UNAVAILABLE", reason: h.reason }; },
    async getStatus() { return { status: "UNKNOWN" }; },
    async getBalance() { return { amount: null, currency: "" }; },
    async getLiquidity() { const p = (await positions()).find((x) => x.market === market); return { available: p?.available ?? null, reserved: p?.reserved ?? 0, committed: p?.committed ?? 0, currency: p?.currency ?? "" }; },
    async health() { const p = (await positions()).find((x) => x.market === market); return p && p.state === "AVAILABLE" ? { state: "HEALTHY" } : { state: "UNAVAILABLE", reason: p?.note ?? "corridor not activated" }; },
  };
}
export const bankRail: RailAdapterV2 = {
  rail: "BANK", id: "BANK",
  async quote() { return { rail: "BANK", fees: { network: 0, provider: 0, currency: "XAF" }, latencySec: { p50: 0, p95: 0 }, available: false, reason: "no bank adapter" }; },
  async getStatus() { return { status: "UNKNOWN" }; }, async getBalance() { return { amount: null, currency: "XAF" }; },
  async getLiquidity() { return { available: null, reserved: 0, committed: 0, currency: "XAF" }; }, async health() { return { state: "UNAVAILABLE", reason: "no bank adapter" }; },
};
