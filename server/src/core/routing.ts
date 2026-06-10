/* ============================================================
   Route Selection Engine — picks PawaPay or Peexit per payout based on
   provider support, availability (up/down), success rate, and latency.
   Health is learned from real execution outcomes; an aggregator that
   fails repeatedly is taken out of rotation (auto-failover). Invisible
   to the user — the state machine just asks for "an aggregator".
   ============================================================ */
import type { ProviderId, CountryCode, Aggregator, RoutingSnapshot, AggregatorHealth, ExecutionLogEntry } from "../../../shared/types.js";
import { pawapayConfigured, peexitConfigured, aggregatorLive } from "../config.js";
import { register, touch } from "./persist.js";
import * as pawapay from "../adapters/pawapay.js";
import * as peexit from "../adapters/peexit.js";

export interface AggregatorAdapter {
  name: Aggregator;
  disburse: typeof pawapay.disburse;
  queryStatus: typeof pawapay.queryStatus;
  balance: (country: CountryCode, provider?: ProviderId) => Promise<number | null>;
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

/** After a rail is taken out of rotation, allow ONE probe payment through this long
 *  after, to re-test whether it has recovered (the "timed re-probe" half of recovery). */
const PROBE_COOLDOWN_MS = 10 * 60_000;
interface Health { success: number; failure: number; totalLatencyMs: number; consecFail: number; up: boolean; downSince: number; }
const health: Record<Aggregator, Health> = {
  pawapay: { success: 0, failure: 0, totalLatencyMs: 0, consecFail: 0, up: true, downSince: 0 },
  peexit: { success: 0, failure: 0, totalLatencyMs: 0, consecFail: 0, up: true, downSince: 0 },
};
/** A rail may be selected if it's up, OR it's been down past the probe cooldown
 *  (one re-test attempt). A failed probe re-stamps downSince → it backs off again. */
function eligible(a: Aggregator): boolean {
  const h = health[a];
  return h.up || (h.downSince > 0 && Date.now() - h.downSince >= PROBE_COOLDOWN_MS);
}
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
  const available = supporting.filter((a) => eligible(a));
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
 *  (sandbox/demo). Returns null → caller holds the payout for manual review.
 *
 *  requireLive: when the inbound is REAL money (real crypto), a sandbox-configured
 *  rail (e.g. Peexit with a sandbox key) must NEVER be chosen — it would simulate
 *  a payout and falsely mark a real payment "delivered" without moving funds. With
 *  requireLive, only LIVE (production) rails are eligible, and we never fall back
 *  to a simulated rail — null instead, so the caller holds it for manual review. */
export async function selectFundedAggregator(provider: ProviderId, country: CountryCode, amountXaf: number, requireLive = false): Promise<AggregatorAdapter | null> {
  const supporting = (Object.keys(SUPPORTS) as Aggregator[]).filter((a) => SUPPORTS[a].includes(provider) && eligible(a));
  if (!supporting.length) return null;
  const real = supporting.filter((a) => CONFIGURED[a]() && (!requireLive || aggregatorLive(a)));
  if (real.length) {
    const funded: Array<{ a: Aggregator; bal: number }> = [];
    const seen: Array<{ a: Aggregator; bal: number | null }> = [];
    for (const a of real) {
      const bal = await AGGREGATORS[a].balance(country, provider);
      seen.push({ a, bal });
      if (bal != null && bal >= amountXaf) funded.push({ a, bal });
    }
    if (funded.length) {
      funded.sort((x, y) => y.bal - x.bal || successRate(y.a) - successRate(x.a));
      return AGGREGATORS[funded[0].a];
    }
    // No live rail has balance ≥ amount — the usual reason a real payout holds.
    // Log balances so "stuck at MANUAL_REVIEW" is immediately diagnosable.
    console.log(`[route] ${provider}/${country} amt=${amountXaf}: NO funded live rail — balances ${seen.map((s) => `${s.a}=${s.bal}`).join(", ")}`);
    // No funded rail. Hold for manual review when REAL money is involved OR a LIVE
    // rail is configured (never silently simulate a real/live payout). Otherwise
    // (only sandbox rails configured + non-real inbound) fall through to a
    // simulated payout so the sandbox demo completes end-to-end.
    if (requireLive || real.some((a) => aggregatorLive(a))) return null;
  }
  // Real settlement with no live funded rail → hold (never simulate real money).
  if (requireLive) return null;
  // No real rail configured → simulated: preferred while available, else first.
  const pref = PREFERRED[provider];
  return AGGREGATORS[supporting.includes(pref) ? pref : supporting[0]];
}

/** PRE-FLIGHT (no side effects): can a payout for this provider/amount actually land
 *  RIGHT NOW? Gates crypto-address generation — we never mint an inbound address
 *  unless a funded, healthy, (live when required) rail exists, so a paid invoice can
 *  never strand. Returns a reason code for the blocked case so the UI can explain it. */
export async function payoutReady(provider: ProviderId, country: CountryCode, amountXaf: number, requireLive: boolean): Promise<{ ok: boolean; reason?: string }> {
  const supporting = (Object.keys(SUPPORTS) as Aggregator[]).filter((a) => SUPPORTS[a].includes(provider));
  if (!supporting.length) return { ok: false, reason: "provider_unsupported" };
  const candidates = supporting.filter((a) => eligible(a));
  if (!candidates.length) return { ok: false, reason: "rails_down" };
  const real = candidates.filter((a) => CONFIGURED[a]() && (!requireLive || aggregatorLive(a)));
  // No real/live rail. With real money (requireLive) that's a hard block; otherwise
  // (sandbox/demo) a simulated payout is fine, so the flow is allowed to proceed.
  if (!real.length) return requireLive ? { ok: false, reason: "no_live_rail" } : { ok: true };
  for (const a of real) {
    const bal = await AGGREGATORS[a].balance(country, provider);
    if (bal != null && bal >= amountXaf) return { ok: true };
  }
  return { ok: false, reason: "insufficient_rail_balance" };
}

/** Record a payout outcome — feeds success rate, latency, and auto-failover. */
export function recordExecution(e: ExecutionLogEntry): void {
  const h = health[e.aggregator];
  if (e.status === "COMPLETED") { h.success += 1; h.totalLatencyMs += e.latencyMs; h.consecFail = 0; h.up = true; h.downSince = 0; }
  else { h.failure += 1; h.consecFail += 1; if (h.consecFail >= 3 && h.up) { h.up = false; h.downSince = Date.now(); } } // 3 strikes → out
  executions.unshift(e);
  if (executions.length > 60) executions.pop();
  touch("routing");
}

/** A HARD payout failure (provider config errors like PAYOUTS_NOT_ALLOWED that won't
 *  fix themselves) takes the rail out of rotation IMMEDIATELY — one strike, not three —
 *  so the pre-flight gate blocks NEW addresses at once. Recovers via the probe cooldown
 *  or an admin re-enable. */
export function markRailHardDown(name: Aggregator, reason: string): void {
  const h = health[name];
  if (h.up) h.downSince = Date.now();
  h.up = false;
  h.failure += 1;
  h.consecFail = Math.max(h.consecFail, 3);
  console.log(`[route] ${name} HARD DOWN · ${reason} — re-probe in ${Math.round(PROBE_COOLDOWN_MS / 60000)}m or admin re-enable`);
  touch("routing");
}

/** Admin/ops: force an aggregator up or down. Up clears the cooldown; down stamps it. */
export function setAggregatorUp(name: Aggregator, up: boolean): void {
  health[name].up = up;
  if (up) { health[name].consecFail = 0; health[name].downSince = 0; }
  else if (health[name].downSince === 0) health[name].downSince = Date.now();
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
