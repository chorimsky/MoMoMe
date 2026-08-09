/* ============================================================
   Shared rail availability + auto-failover tracker.

   Learns each rail's health from real execution outcomes: 3 consecutive
   failures take a rail out of rotation; after a cooldown it's allowed ONE
   probe attempt to re-test recovery. Used by BOTH the payout-aggregator
   router (core/routing.ts) and the crypto-inbound rail registry
   (adapters/index.ts), so availability/failover behaves identically on
   both sides of a payment instead of being reimplemented per layer.

   Extracted verbatim from the original routing.ts logic — behaviour is
   preserved (guarded by test/rail-health.test.ts).
   ============================================================ */

export interface RailHealthState {
  success: number;
  failure: number;
  totalLatencyMs: number;
  consecFail: number;
  up: boolean;
  /** epoch ms this rail went down (0 = up). Drives the probe cooldown. */
  downSince: number;
}

const fresh = (): RailHealthState => ({ success: 0, failure: 0, totalLatencyMs: 0, consecFail: 0, up: true, downSince: 0 });

export class HealthTracker {
  /** After a rail goes down, allow ONE probe this long after to re-test recovery. */
  readonly probeCooldownMs: number;
  private readonly state = new Map<string, RailHealthState>();

  constructor(names: string[], opts: { probeCooldownMs?: number } = {}) {
    this.probeCooldownMs = opts.probeCooldownMs ?? 10 * 60_000;
    for (const n of names) this.state.set(n, fresh());
  }

  /** Ensure a rail is tracked (rails can be registered after construction). */
  ensure(name: string): RailHealthState {
    let h = this.state.get(name);
    if (!h) { h = fresh(); this.state.set(name, h); }
    return h;
  }

  names(): string[] { return [...this.state.keys()]; }
  isUp(name: string): boolean { return this.ensure(name).up; }

  /** A rail may be selected if it's up, OR it's been down past the probe cooldown
   *  (one re-test attempt). A failed probe re-stamps downSince → it backs off again. */
  eligible(name: string): boolean {
    const h = this.ensure(name);
    return h.up || (h.downSince > 0 && Date.now() - h.downSince >= this.probeCooldownMs);
  }

  /** Record an execution outcome. ok = the rail succeeded. */
  record(name: string, ok: boolean, latencyMs = 0): void {
    const h = this.ensure(name);
    if (ok) { h.success += 1; h.totalLatencyMs += latencyMs; h.consecFail = 0; h.up = true; h.downSince = 0; }
    // 3 strikes → out. Re-stamp downSince on every failure-while-down too, so a FAILED
    // probe (after the cooldown) re-arms the backoff instead of leaving the rail eligible.
    else { h.failure += 1; h.consecFail += 1; if (h.consecFail >= 3) { h.up = false; h.downSince = Date.now(); } }
  }

  /** A HARD failure (config errors that won't self-heal) takes a rail out IMMEDIATELY —
   *  one strike, not three — so pre-flight gating blocks new work at once. */
  markHardDown(name: string): void {
    const h = this.ensure(name);
    h.downSince = Date.now(); // always re-arm the cooldown — a failed probe backs off again
    h.up = false;
    h.failure += 1;
    h.consecFail = Math.max(h.consecFail, 3);
  }

  /** Admin/ops: force a rail up or down. Up clears the cooldown; down stamps it. */
  setUp(name: string, up: boolean): void {
    const h = this.ensure(name);
    h.up = up;
    if (up) { h.consecFail = 0; h.downSince = 0; }
    else if (h.downSince === 0) h.downSince = Date.now();
  }

  successRate(name: string): number { const h = this.ensure(name); const t = h.success + h.failure; return t ? h.success / t : 1; }
  avgLatency(name: string): number { const h = this.ensure(name); return h.success ? Math.round(h.totalLatencyMs / h.success) : 0; }
  counts(name: string): { success: number; failure: number } { const h = this.ensure(name); return { success: h.success, failure: h.failure }; }

  /** Snapshot for persistence. */
  dump(): Record<string, RailHealthState> {
    const out: Record<string, RailHealthState> = {};
    for (const [k, v] of this.state) out[k] = { ...v };
    return out;
  }

  /** Restore from a persisted snapshot (merges — unknown rails are added). */
  load(d: Record<string, RailHealthState> | undefined | null): void {
    if (!d) return;
    for (const [k, v] of Object.entries(d)) this.state.set(k, { ...fresh(), ...v });
  }
}
