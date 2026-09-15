/* ============================================================
   Liquidity engine — pools, positions, reservations (§8–§11, §37, PHASE 4).

   A liquidity source is the network's ability to settle value in a market. Provider
   availability and liquidity are tracked SEPARATELY (§9): a rail's API can be up while
   its payout wallet is empty. The router only ever sees `available` = balance − reserved
   − committed, and every accepted transaction reserves its destination liquidity before
   the source collection is requested (§11).

   Sources today:
   · cm:treasury:<aggregator>  — the production payout rails' XAF balances (Peexit, PawaPay),
                                  read through the same adapters the live engine uses.
   · <market>:sim              — configured simulated balances (sandbox rehearsal only).
   · <market>:partner:<id>     — operator-declared Lightning-accepting partners (Model B).
   · lightning:ibex            — the BTC position at IBEX (the settlement fabric's fuel);
                                  withdrawable = balance − crypto owed to senders.
   ============================================================ */
import type { LiquidityPosition, LiquidityReservation, LiquiditySource, MarketCode } from "../../../../shared/network.js";
import { getSettings } from "../settings.js";
import { register, touch } from "../persist.js";
import { id } from "../ids.js";
import { treasuryPools } from "../treasury.js";
import { config, ibexConfigured } from "../../config.js";
import { MARKETS } from "./markets.js";
import { adaptersFor } from "./adapters.js";

const reservations = new Map<string, LiquidityReservation>();
register("network_reservations", () => [...reservations.values()].slice(-20_000), (d: LiquidityReservation[]) => { for (const r of d ?? []) reservations.set(r.id, r); });

const now = () => new Date().toISOString();

/* ---------- sources ---------- */
export function sources(): LiquiditySource[] {
  const n = getSettings().network;
  const out: LiquiditySource[] = [];
  for (const code of Object.keys(MARKETS)) {
    const m = MARKETS[code];
    for (const a of adaptersFor(code)) {
      const sid = a.simulated ? `${code.toLowerCase()}:sim` : `${code.toLowerCase()}:treasury:${a.aggregator}`;
      out.push({
        id: sid, market: code, currency: m.currency, kind: a.simulated ? "momome_treasury" : "momome_treasury",
        name: a.simulated ? `${m.name} simulated pool` : `${m.name} float · ${a.aggregator}`,
        settlementMethod: "mobile_money", lightningCapable: false,
        paysOut: m.providers.filter((p) => a.supports(p.id, "payout")).map((p) => p.id),
        status: n.disabled.pools.includes(sid) ? "DISABLED" : a.getProviderHealth().status === "DOWN" ? "DEGRADED" : "ACTIVE",
        limits: { maxPerTx: m.limits.maxPerTx, maxPerDay: m.limits.maxPerDay ?? m.limits.maxPerTx }, feePct: 0,
      });
    }
    for (const p of n.partners.filter((x) => x.market === code)) {
      const sid = `${code.toLowerCase()}:partner:${p.id}`;
      out.push({ id: sid, market: code, currency: m.currency, kind: "partner", name: p.name, settlementMethod: "lightning", lightningCapable: true, paysOut: p.paysOut, status: !p.enabled || n.disabled.partners.includes(p.id) || n.disabled.pools.includes(sid) ? "DISABLED" : "ACTIVE", limits: { maxPerTx: p.maxPerTx, maxPerDay: p.maxPerTx * 20 }, feePct: p.feePct });
    }
  }
  out.push({ id: "lightning:ibex", market: "*", currency: "BTC", kind: "lightning", name: "Lightning position (IBEX)", settlementMethod: "lightning", lightningCapable: true, paysOut: [], status: n.disabled.lightningRoutes.includes("ibex") ? "DISABLED" : ibexConfigured() ? "ACTIVE" : config.railsMode === "sandbox" ? "ACTIVE" : "DEGRADED", limits: { maxPerTx: 1, maxPerDay: 10 }, feePct: 0.001 });
  return out;
}
export const sourceById = (sid: string): LiquiditySource | undefined => sources().find((s) => s.id === sid);

/* ---------- positions ---------- */
const reservedFor = (sid: string, state: LiquidityReservation["state"]) => [...reservations.values()].filter((r) => r.sourceId === sid && r.state === state).reduce((a, r) => a + r.amount, 0);

async function rawBalance(s: LiquiditySource): Promise<{ balance: number | null; note?: string }> {
  const n = getSettings().network;
  if (s.kind === "lightning") {
    if (!ibexConfigured()) return { balance: n.simulatedLiquidity[s.id] ?? (config.railsMode === "sandbox" ? 0.05 : null), note: "sandbox figure" };
    const pools = await treasuryPools().catch(() => []);
    const btc = pools.find((p) => p.asset === "BTC");
    return btc?.balanceKnown ? { balance: btc.withdrawable, note: "IBEX BTC withdrawable (balance − owed to senders)" } : { balance: null, note: "IBEX balance unknown" };
  }
  if (s.kind === "partner") return { balance: n.simulatedLiquidity[s.id] ?? null, note: n.simulatedLiquidity[s.id] != null ? "declared by operator" : "partner has not reported a balance" };
  if (s.id.endsWith(":sim")) return { balance: n.simulatedLiquidity[s.id] ?? 0, note: "simulated (sandbox)" };
  // Production treasury: the rail's own payout balance, through the production adapter.
  const agg = s.id.split(":")[2];
  const a = adaptersFor(s.market).find((x) => x.aggregator === agg);
  const b = a ? await a.getBalance().catch(() => null) : null;
  return { balance: b, note: b == null ? "rail did not report a balance" : `${agg} payout wallet` };
}

export async function positions(): Promise<LiquidityPosition[]> {
  const n = getSettings().network;
  const out: LiquidityPosition[] = [];
  for (const s of sources()) {
    const { balance, note } = await rawBalance(s);
    const reserved = reservedFor(s.id, "RESERVED"), committed = reservedFor(s.id, "COMMITTED");
    const available = balance == null ? null : Math.max(0, balance - reserved - committed);
    const floor = n.liquidityFloor[s.id] ?? 0;
    const state: LiquidityPosition["state"] = s.status === "DISABLED" ? "UNAVAILABLE" : balance == null ? "UNAVAILABLE" : s.status === "DEGRADED" ? "DEGRADED" : available != null && available <= floor ? "DEGRADED" : "AVAILABLE";
    out.push({ sourceId: s.id, market: s.market, currency: s.currency, state, balance, reserved, committed, available, note: state === "DEGRADED" && available != null && available <= floor ? `below floor ${floor}` : note, updatedAt: now() });
  }
  return out;
}

/** Can this source settle `amount` right now? (§36) */
export async function canSettle(sourceId: string, amount: number): Promise<{ ok: boolean; available: number | null; reason?: string }> {
  const s = sourceById(sourceId);
  if (!s) return { ok: false, available: null, reason: "unknown source" };
  if (s.status !== "ACTIVE") return { ok: false, available: null, reason: `${s.name} is ${s.status.toLowerCase()}` };
  if (amount > s.limits.maxPerTx) return { ok: false, available: null, reason: `above ${s.name} per-transaction limit` };
  const p = (await positions()).find((x) => x.sourceId === sourceId);
  if (!p || p.available == null) return { ok: false, available: null, reason: `${s.name}: liquidity unknown` };
  if (p.available < amount) return { ok: false, available: p.available, reason: `${s.name}: ${p.available.toLocaleString("en")} ${s.currency} available, ${amount.toLocaleString("en")} needed` };
  return { ok: true, available: p.available };
}

/* ---------- reservations (§11) ---------- */
export async function reserve(sourceId: string, txId: string, amount: number): Promise<{ ok: true; reservation: LiquidityReservation } | { ok: false; reason: string }> {
  if (!getSettings().network.flags.LIQUIDITY_ENGINE && config.railsMode !== "sandbox") return { ok: false, reason: "LIQUIDITY_ENGINE is off" };
  const existing = [...reservations.values()].find((r) => r.txId === txId && r.sourceId === sourceId && r.state !== "RELEASED");
  if (existing) return { ok: true, reservation: existing }; // idempotent
  const c = await canSettle(sourceId, amount);
  if (!c.ok) return { ok: false, reason: c.reason ?? "cannot settle" };
  const s = sourceById(sourceId)!;
  const r: LiquidityReservation = { id: id("lrs"), sourceId, txId, amount, currency: s.currency, state: "RESERVED", createdAt: now(), updatedAt: now() };
  reservations.set(r.id, r);
  touch("network_reservations");
  return { ok: true, reservation: r };
}
export function commit(reservationId: string): void { const r = reservations.get(reservationId); if (r && r.state === "RESERVED") { r.state = "COMMITTED"; r.updatedAt = now(); touch("network_reservations"); } }
export function release(reservationId: string): void { const r = reservations.get(reservationId); if (r && r.state !== "RELEASED") { r.state = "RELEASED"; r.updatedAt = now(); touch("network_reservations"); } }
/** A committed reservation is money that has LEFT the pool — once the payout is confirmed
 *  the pool's balance (read live) already reflects it, so the commitment is released. */
export function settle(reservationId: string): void { release(reservationId); }
export function reservationsList(): LiquidityReservation[] { return [...reservations.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function reservationOf(txId: string): LiquidityReservation | undefined { return [...reservations.values()].find((r) => r.txId === txId && r.state !== "RELEASED"); }

/** Low-liquidity alerts for monitoring (§49). */
export async function lowLiquidity(): Promise<Array<{ sourceId: string; available: number; floor: number }>> {
  const n = getSettings().network;
  return (await positions()).filter((p) => p.available != null && (n.liquidityFloor[p.sourceId] ?? 0) > 0 && p.available <= (n.liquidityFloor[p.sourceId] ?? 0)).map((p) => ({ sourceId: p.sourceId, available: p.available!, floor: n.liquidityFloor[p.sourceId] ?? 0 }));
}

/** Destination-side sources that can pay `provider` in `market`, best first. */
export function destinationSources(market: MarketCode, provider: string): LiquiditySource[] {
  return sources().filter((s) => s.market === market && s.paysOut.includes(provider) && s.status === "ACTIVE");
}
export function sourceSideSource(market: MarketCode): LiquiditySource | undefined {
  return sources().find((s) => s.market === market && s.kind === "momome_treasury" && s.status === "ACTIVE");
}
