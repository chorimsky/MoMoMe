/* ============================================================
   Route Selection Engine — picks a payout aggregator per payout based on
   corridor support, availability (up/down), balance, success rate and latency.
   It is now a thin selection/health layer OVER the open PayoutAdapter registry
   (adapters/payouts.ts): supports()/configured()/live()/priority all live on the
   adapters, so adding a fiat rail needs NO change here. Health is learned from
   real execution outcomes; a rail that fails repeatedly is taken out of rotation
   (auto-failover). Invisible to the user — the state machine just asks for "an
   aggregator". Mirrors the crypto inbound registry (adapters/index.ts).
   ============================================================ */
import type { ProviderId, CountryCode, RoutingSnapshot, AggregatorHealth, ExecutionLogEntry } from "../../../shared/types.js";
import { register, touch } from "./persist.js";
import { HealthTracker, type RailHealthState } from "./railHealth.js";
import { PAYOUTS, payoutByName, payoutsFor, peexitAdapter, type PayoutAdapter } from "../adapters/payouts.js";

const ALL_PROVIDERS: ProviderId[] = ["MTN", "ORANGE", "AIRTEL"];

/** Availability + auto-failover for payout rails, on the SHARED tracker also used by
 *  the crypto-inbound registry — one implementation of "3 strikes → out, one probe
 *  after a cooldown". After a rail is taken out, ONE probe is allowed after the cooldown. */
const PROBE_COOLDOWN_MS = 10 * 60_000;
const health = new HealthTracker(PAYOUTS.map((p) => p.name), { probeCooldownMs: PROBE_COOLDOWN_MS });
const eligible = (name: string): boolean => health.eligible(name);
const executions: ExecutionLogEntry[] = [];

register(
  "routing",
  () => ({ health: health.dump(), executions: executions.slice(0, 60) }),
  (d: { health: Record<string, RailHealthState>; executions: ExecutionLogEntry[] }) => {
    health.load(d.health);
    executions.push(...d.executions);
  },
);

const successRate = (name: string) => health.successRate(name);
const avgLatency = (name: string) => health.avgLatency(name);

/** Pick the payout rail: the preferred (lowest-priority) available rail for the
 *  corridor, else fail over to the healthiest supporting rail (success rate, latency). */
export function selectAggregator(provider: ProviderId): PayoutAdapter {
  const supporting = payoutsFor(provider); // priority-sorted (lowest = preferred)
  if (!supporting.length) return peexitAdapter; // nothing declared — display fallback
  const available = supporting.filter((p) => eligible(p.name));
  if (available.length) return available[0]; // lowest-priority available = preferred
  // All down → still try the healthiest supporting rail (never resolve to none).
  const sorted = [...supporting].sort((a, b) => successRate(b.name) - successRate(a.name) || avgLatency(a.name) - avgLatency(b.name));
  return sorted[0] ?? peexitAdapter;
}

/** Resolve a stored payment's rail by name (reconcile / status re-query). Falls back to
 *  the primary rail if the name is unknown (never null — callers deref immediately). */
export function aggregatorByName(name: string | undefined): PayoutAdapter {
  return payoutByName(name) ?? peexitAdapter;
}

/** Balance-aware selection for an ACTUAL payout. When any rail for this corridor is
 *  configured (real), require one with wallet balance ≥ amount (highest balance wins) —
 *  never silently fall back to a simulated rail. With no real rail configured, route by
 *  preference (sandbox/demo). Returns null → caller holds the payout for manual review.
 *
 *  requireLive: when the inbound is REAL money, a sandbox-configured rail must NEVER be
 *  chosen — only LIVE (production) rails are eligible, and we never fall back to a
 *  simulated rail (null instead → hold for manual review). */
export async function selectFundedAggregator(provider: ProviderId, country: CountryCode, amountXaf: number, requireLive = false): Promise<PayoutAdapter | null> {
  const supporting = payoutsFor(provider).filter((p) => eligible(p.name));
  if (!supporting.length) return null;
  const real = supporting.filter((p) => p.configured() && (!requireLive || p.live()));
  if (real.length) {
    const funded: Array<{ p: PayoutAdapter; bal: number }> = [];
    const seen: Array<{ a: string; bal: number | null }> = [];
    for (const p of real) {
      const bal = await p.balance(country, provider);
      seen.push({ a: p.name, bal });
      if (bal != null && bal >= amountXaf) funded.push({ p, bal });
    }
    if (funded.length) {
      funded.sort((x, y) => y.bal - x.bal || successRate(y.p.name) - successRate(x.p.name));
      return funded[0].p;
    }
    // No live rail has balance ≥ amount — the usual reason a real payout holds.
    console.log(`[route] ${provider}/${country} amt=${amountXaf}: NO funded live rail — balances ${seen.map((s) => `${s.a}=${s.bal}`).join(", ")}`);
    // Never silently simulate a real/live payout — hold instead.
    if (requireLive || real.some((p) => p.live())) return null;
  }
  if (requireLive) return null;
  // No real rail configured → simulated: the preferred (lowest-priority) supporting rail.
  return supporting[0];
}

/** Total queryable XAF across aggregators that are funded and not hard-down. This is
 *  the treasury's true payout ceiling; selectFundedAggregator already reads these
 *  per-rail balances, so this is a fold over the same data, not a new dependency. Each
 *  aggregator holds a single XAF payout wallet, so we query it once (provider-agnostic)
 *  and dedupe by name. Returns NaN when NO rail can be queried, so the caller falls back
 *  to the static ceiling rather than treating "unknown" as "zero float". */
/** Why each payout rail contributed nothing to the last float read. Surfaced so the ONE
 *  log line that reliably survives (the payout-gate refusal) can carry the diagnosis —
 *  Railway's log API truncates this service to a handful of lines, so a separate
 *  explanatory line is written and then thrown away. */
let lastBalanceReasons: string[] = [];
export function balanceReasons(): string[] { return lastBalanceReasons; }

export async function aggregatorFloatXaf(): Promise<number> {
  let sum = 0;
  let any = false;
  const seen = new Set<string>();
  // Track WHY each rail contributed nothing. The first version of this only recorded rails
  // that were queried and returned null — but a rail that is skipped before the query
  // (unconfigured, or marked ineligible by the health tracker) never reaches that branch, so
  // the list came back empty and nothing was logged at all. "Nobody was even asked" is a
  // different fault from "everyone was asked and none answered", and the operator needs to
  // be able to tell them apart.
  const why: string[] = [];
  for (const p of PAYOUTS) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    if (!p.configured()) { why.push(`${p.name}: not configured`); continue; }
    if (!eligible(p.name)) { why.push(`${p.name}: marked unhealthy by the rail health tracker`); continue; }
    const bal = await p.balance("CM");
    // Record what each rail DID contribute, not only why it contributed nothing. A single
    // summed figure cannot tell an operator which wallet needs funding.
    if (bal != null && Number.isFinite(bal)) { sum += bal; any = true; why.push(`${p.name}: ${bal} XAF`); }
    else { why.push(`${p.name}: balance unreadable (not live, or the balance API failed)`); }
  }
  // NaN sends availableFloatXaf() into the static-ceiling fallback, which on a long-lived
  // deployment has been depleted by every past delivery and blocks payouts outright. The
  // operator saw only "payouts_unavailable". Name the rails that could not answer — that is
  // the difference between "we are out of money" and "we cannot see our money".
  lastBalanceReasons = why;
  if (!any) {
    console.error(`[treasury] NO payout rail contributed a balance — falling back to the static ceiling. This is "balance unknown", NOT "balance zero". Reasons: ${why.length ? why.join(" | ") : "no payout rails registered at all"}`);
  }
  return any ? sum : NaN;
}

/** PRE-FLIGHT (no side effects): can a payout for this provider/amount land RIGHT NOW?
 *  Gates crypto-address generation — we never mint an inbound address unless a funded,
 *  healthy, (live when required) rail exists, so a paid invoice can never strand. */
export async function payoutReady(provider: ProviderId, country: CountryCode, amountXaf: number, requireLive: boolean): Promise<{ ok: boolean; reason?: string }> {
  const supporting = payoutsFor(provider);
  if (!supporting.length) return { ok: false, reason: "provider_unsupported" };
  const candidates = supporting.filter((p) => eligible(p.name));
  if (!candidates.length) return { ok: false, reason: "rails_down" };
  // Simulated payout (demo / non-real inbound): any eligible rail handles it (no funding
  // check — a sandbox rail has no real wallet).
  if (!requireLive) return { ok: true };
  // Real money: require a LIVE, configured rail with real balance ≥ amount.
  const live = candidates.filter((p) => p.configured() && p.live());
  if (!live.length) return { ok: false, reason: "no_live_rail" };
  // A null balance means UNKNOWN (the rail could not be read), not zero. Collapsing both
  // into "insufficient_rail_balance" sent operators hunting for an unfunded wallet when
  // the account was never reachable — the exact confusion a Peexit 403 (IP allowlist)
  // produces. Report the two apart.
  let anyKnown = false;
  for (const p of live) {
    const bal = await p.balance(country, provider);
    if (bal != null) anyKnown = true;
    if (bal != null && bal >= amountXaf) return { ok: true };
  }
  return { ok: false, reason: anyKnown ? "insufficient_rail_balance" : "rail_unreachable" };
}

/** Record a payout outcome — feeds success rate, latency, and auto-failover. */
export function recordExecution(e: ExecutionLogEntry): void {
  health.record(e.aggregator, e.status === "COMPLETED", e.latencyMs);
  executions.unshift(e);
  if (executions.length > 60) executions.pop();
  touch("routing");
}

/** A HARD payout failure (config errors like PAYOUTS_NOT_ALLOWED that won't fix
 *  themselves) takes the rail out of rotation IMMEDIATELY — one strike — so the
 *  pre-flight gate blocks NEW addresses at once. Recovers via probe cooldown or admin. */
export function markRailHardDown(name: string, reason: string): void {
  health.markHardDown(name);
  console.log(`[route] ${name} HARD DOWN · ${reason} — re-probe in ${Math.round(health.probeCooldownMs / 60000)}m or admin re-enable`);
  touch("routing");
}

/** Admin/ops: force a rail up or down. Up clears the cooldown; down stamps it. */
export function setAggregatorUp(name: string, up: boolean): void {
  health.setUp(name, up);
  touch("routing");
}

export function routingTable(): Array<{ provider: ProviderId; aggregator: string }> {
  return ALL_PROVIDERS.map((provider) => ({ provider, aggregator: selectAggregator(provider).name }));
}

export function routingSnapshot(): RoutingSnapshot {
  const aggregators: AggregatorHealth[] = PAYOUTS.map((p) => {
    const c = health.counts(p.name);
    return {
      name: p.name, up: health.isUp(p.name),
      successRatePct: Math.round(successRate(p.name) * 100), avgLatencyMs: avgLatency(p.name),
      count: c.success + c.failure, supports: ALL_PROVIDERS.filter((pr) => p.supports(pr)),
    };
  });
  return { aggregators, decisions: routingTable(), executions: executions.slice(0, 20) };
}
