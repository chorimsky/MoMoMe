/* ============================================================
   Route Selection Engine — picks PawaPay or Peexit per payout based on
   provider support, availability (up/down), success rate, and latency.
   Health is learned from real execution outcomes; an aggregator that
   fails repeatedly is taken out of rotation (auto-failover). Invisible
   to the user — the state machine just asks for "an aggregator".
   ============================================================ */
import type { ProviderId, CountryCode, Aggregator, RoutingSnapshot, AggregatorHealth, ExecutionLogEntry } from "../../../shared/types.js";
import { pawapayConfigured, peexitConfigured } from "../config.js";
import { register, touch } from "./persist.js";
import * as pawapay from "../adapters/pawapay.js";
import * as peexit from "../adapters/peexit.js";

export interface AggregatorAdapter {
  name: Aggregator;
  disburse: typeof pawapay.disburse;
  queryStatus: typeof pawapay.queryStatus;
  balance: (country: CountryCode) => Promise<number | null>;
}

const AGGREGATORS: Record<Aggregator, AggregatorAdapter> = {
  pawapay: { name: "pawapay", disburse: pawapay.disburse, queryStatus: pawapay.queryStatus, balance: pawapay.availableBalanceXaf },
  peexit: { name: "peexit", disburse: peexit.disburse, queryStatus: peexit.queryStatus, balance: peexit.availableBalanceXaf },
};

/** Which aggregators have real credentials (→ settle for real). */
const CONFIGURED: Record<Aggregator, () => boolean> = { pawapay: pawapayConfigured, peexit: peexitConfigured };

/** Which corridors each aggregator can execute. */
const SUPPORTS: Record<Aggregator, ProviderId[]> = {
  pawapay: ["MTN", "ORANGE", "AIRTEL"],
  peexit: ["MTN", "ORANGE"],
};

/** Preferred aggregator per corridor — used while it's available. */
const PREFERRED: Record<ProviderId, Aggregator> = { MTN: "pawapay", ORANGE: "peexit", AIRTEL: "pawapay" };

interface Health { success: number; failure: number; totalLatencyMs: number; consecFail: number; up: boolean; }
const health: Record<Aggregator, Health> = {
  pawapay: { success: 0, failure: 0, totalLatencyMs: 0, consecFail: 0, up: true },
  peexit: { success: 0, failure: 0, totalLatencyMs: 0, consecFail: 0, up: true },
};
const executions: ExecutionLogEntry[] = [];

register(
  "routing",
  () => ({ health, executions: executions.slice(0, 60) }),
  (d: { health: Record<Aggregator, Health>; executions: ExecutionLogEntry[] }) => {
    Object.assign(health, d.health);
    executions.push(...d.executions);
  },
);

const successRate = (a: Aggregator) => { const h = health[a]; const t = h.success + h.failure; return t ? h.success / t : 1; };
const avgLatency = (a: Aggregator) => { const h = health[a]; return h.success ? Math.round(h.totalLatencyMs / h.success) : 0; };

/** Pick the payout aggregator: the preferred one while it's available, else fail
 *  over to the healthiest available alternative (by success rate, then latency). */
export function selectAggregator(provider: ProviderId): AggregatorAdapter {
  const supporting = (Object.keys(SUPPORTS) as Aggregator[]).filter((a) => SUPPORTS[a].includes(provider));
  const available = supporting.filter((a) => health[a].up);
  const pool = available.length ? available : supporting; // all down → still try
  // Stable default: use the preferred aggregator while it's in the pool.
  const preferred = PREFERRED[provider];
  if (pool.includes(preferred)) return AGGREGATORS[preferred];
  // Failover: choose the healthiest alternative (success rate, then latency).
  const sorted = [...pool].sort((a, b) => successRate(b) - successRate(a) || avgLatency(a) - avgLatency(b));
  return AGGREGATORS[sorted[0] ?? "pawapay"];
}

export function aggregatorByName(name: Aggregator): AggregatorAdapter {
  return AGGREGATORS[name];
}

/** Balance-aware selection for an ACTUAL payout: the funded API picks it up.
 *  When any aggregator for this corridor is configured (real), require one with
 *  wallet balance ≥ amount (highest balance wins) — never silently fall back to
 *  a simulated rail. With no real rail configured, route by preference/health
 *  (sandbox/demo). Returns null → caller holds the payout for manual review. */
export async function selectFundedAggregator(provider: ProviderId, country: CountryCode, amountXaf: number): Promise<AggregatorAdapter | null> {
  const supporting = (Object.keys(SUPPORTS) as Aggregator[]).filter((a) => SUPPORTS[a].includes(provider) && health[a].up);
  if (!supporting.length) return null;
  const real = supporting.filter((a) => CONFIGURED[a]());
  if (real.length) {
    const funded: Array<{ a: Aggregator; bal: number }> = [];
    for (const a of real) {
      const bal = await AGGREGATORS[a].balance(country);
      if (bal != null && bal >= amountXaf) funded.push({ a, bal });
    }
    if (!funded.length) return null; // real rail(s) exist but none funded → manual review
    funded.sort((x, y) => y.bal - x.bal || successRate(y.a) - successRate(x.a));
    return AGGREGATORS[funded[0].a];
  }
  // No real rail configured → simulated: preferred while available, else first.
  const pref = PREFERRED[provider];
  return AGGREGATORS[supporting.includes(pref) ? pref : supporting[0]];
}

/** Record a payout outcome — feeds success rate, latency, and auto-failover. */
export function recordExecution(e: ExecutionLogEntry): void {
  const h = health[e.aggregator];
  if (e.status === "COMPLETED") { h.success += 1; h.totalLatencyMs += e.latencyMs; h.consecFail = 0; h.up = true; }
  else { h.failure += 1; h.consecFail += 1; if (h.consecFail >= 3) h.up = false; } // 3 strikes → out of rotation
  executions.unshift(e);
  if (executions.length > 60) executions.pop();
  touch("routing");
}

/** Admin/ops: force an aggregator up or down. */
export function setAggregatorUp(name: Aggregator, up: boolean): void {
  health[name].up = up;
  if (up) health[name].consecFail = 0;
  touch("routing");
}

export function routingTable(): Array<{ provider: ProviderId; aggregator: Aggregator }> {
  return (["MTN", "ORANGE", "AIRTEL"] as ProviderId[]).map((provider) => ({ provider, aggregator: selectAggregator(provider).name }));
}

export function routingSnapshot(): RoutingSnapshot {
  const aggregators: AggregatorHealth[] = (Object.keys(AGGREGATORS) as Aggregator[]).map((a) => ({
    name: a, up: health[a].up, successRatePct: Math.round(successRate(a) * 100), avgLatencyMs: avgLatency(a),
    count: health[a].success + health[a].failure, supports: SUPPORTS[a],
  }));
  return { aggregators, decisions: routingTable(), executions: executions.slice(0, 20) };
}
