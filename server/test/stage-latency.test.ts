/* ============================================================
   Per-stage latency, derived from what the payments already record.

   The assertions that matter are the ones about what it REFUSES to say. A latency report
   is read when something is slow, which is exactly when a number computed from three
   samples, or from payments that have not finished, would mislead the person reading it:

     • below MIN_SAMPLES every percentile is null and says why — not zero, not a guess;
     • a payment still in a stage is excluded from it, so "time so far" is never reported
       as "time taken";
     • a re-entered state (a failover back to PAYOUT_REQUESTED, a re-price re-locking FX)
       does not restart the clock of the stage leading into it, or a retried payment would
       look faster than it was;
     • out-of-order timestamps are dropped rather than allowed to move a percentile.
   Run: pnpm --filter @momome/server test:latency
   ============================================================ */
import assert from "node:assert/strict";
import type { Payment, PaymentState } from "../../shared/types.js";

process.env.DB_PATH = ":memory:";
process.env.RAILS_MODE = "sandbox";

let passed = 0;
function ok(label: string, cond: boolean, detail = "") {
  assert.ok(cond, `FAIL: ${label} ${detail}`);
  passed++;
  console.log(`  ✓ ${label}${detail ? `  (${detail})` : ""}`);
}

const T0 = Date.parse("2026-10-01T00:00:00Z");
/** A payment whose event timeline is exactly the (state, +seconds) pairs given. */
function made(id: string, steps: Array<[PaymentState, number]>): Payment {
  const at = (s: number) => new Date(T0 + s * 1000).toISOString();
  return {
    id, ref: `MMM-LAT-${id}`, quoteId: `q_${id}`,
    state: steps[steps.length - 1][0], displayStatus: "Pending", method: "LIGHTNING",
    recipient: { phone: "677000000", country: "CM", provider: "MTN", name: "", nameSource: "manual" },
    xaf: 10_000, feeXaf: 250, totalXaf: 10_250, usd: 17,
    payInstruction: { method: "LIGHTNING", code: `ln_${id}`, qr: `lightning:ln_${id}`, asset: "BTC", amount: 0.0001, amountLabel: "0.0001 BTC", expiresAt: at(0), providerRef: `ph_${id}`, provider: "sandbox" },
    events: steps.map(([state, s]) => ({ at: at(s), state })),
    createdAt: at(0), updatedAt: at(steps[steps.length - 1][1]),
  };
}

async function main() {
  const { stageStats, durations, MIN_SAMPLES, STAGES } = await import("../src/core/stageLatency.js");

  console.log("\nPer-stage latency");

  /* A full lifecycle: payer takes 60s, we lock FX in 2s, submit in 3s, the rail confirms
     in 20s, delivery takes 1s. */
  const full = (id: string, payerS = 60) => made(id, [
    ["QUOTED", 0], ["AWAITING_INBOUND", 0], ["INBOUND_CONFIRMED", payerS],
    ["FX_LOCKED", payerS + 2], ["PAYOUT_REQUESTED", payerS + 5],
    ["PAYOUT_CONFIRMED", payerS + 25], ["DELIVERED", payerS + 26],
  ]);

  /* 1. Below the floor, nothing is asserted. */
  let stats = stageStats([full("a"), full("b")]);
  const payer = stats.find((s) => s.key === "payer_wait")!;
  ok("under the sample floor every percentile is withheld", payer.p50 === null && payer.p95 === null && payer.p99 === null, JSON.stringify(payer));
  ok("…and it says why rather than reporting zero", (payer.note ?? "").includes(String(MIN_SAMPLES)), payer.note);
  ok("…while still reporting how many samples there were", payer.samples === 2, String(payer.samples));

  /* 2. With enough samples the figures appear, and they are right. */
  const many = Array.from({ length: 10 }, (_, i) => full(`p${i}`, 60 + i)); // 60…69s
  stats = stageStats(many);
  const pw = stats.find((s) => s.key === "payer_wait")!;
  ok("with enough samples the percentiles appear", pw.p50 !== null && pw.samples === 10, `p50=${pw.p50}ms n=${pw.samples}`);
  // Nearest-rank: for 10 sorted samples p50 is index ceil(0.5·10)−1 = 4, i.e. the 5th of
  // 60…69s. 64s, not 65s. Written out because the first version of this test asserted the
  // arithmetic mean of the range and "failed" against a correct implementation.
  ok("p50 of 60…69s is the 5th sample", pw.p50 === 64_000, String(pw.p50));
  ok("p99 is the slowest", pw.p99 === 69_000, String(pw.p99));
  const ours = stats.find((s) => s.key === "ours_only")!;
  ok("the stretch that is ours alone is 5s", ours.p50 === 5_000, String(ours.p50));
  const e2e = stats.find((s) => s.key === "end_to_end")!;
  ok("end to end is the whole thing", e2e.p50 === 90_000, String(e2e.p50)); // 86…95s, 5th = 90s

  /* 3. An unfinished payment contributes nothing to the stage it is still in. */
  const stuck = Array.from({ length: 10 }, (_, i) => made(`s${i}`, [
    ["QUOTED", 0], ["AWAITING_INBOUND", 0], ["INBOUND_CONFIRMED", 10],
    ["FX_LOCKED", 12], ["PAYOUT_REQUESTED", 15], // never confirmed — in flight right now
  ]));
  stats = stageStats([...many, ...stuck]);
  const rail = stats.find((s) => s.key === "rail_confirm")!;
  ok("a payout still in flight is excluded from rail_confirm", rail.samples === 10, String(rail.samples));
  ok("…so the stage it HAS finished still counts it", stats.find((s) => s.key === "fx_lock")!.samples === 20, String(stats.find((s) => s.key === "fx_lock")!.samples));
  ok("…and the slow stuck payments do not flatter rail_confirm", rail.p50 === 20_000, String(rail.p50));

  /* 4. A failover re-enters PAYOUT_REQUESTED. The stage LEADING INTO it must be measured
        from the FIRST entry, or the retry makes the submit look instant. */
  const retried = made("r1", [
    ["QUOTED", 0], ["AWAITING_INBOUND", 0], ["INBOUND_CONFIRMED", 10], ["FX_LOCKED", 12],
    ["PAYOUT_REQUESTED", 15], ["PAYOUT_REQUESTED", 300], ["PAYOUT_CONFIRMED", 320], ["DELIVERED", 321],
  ]);
  const d = durations([retried], "FX_LOCKED", "PAYOUT_REQUESTED");
  ok("a re-entered state does not restart the clock", d[0] === 3_000, `${d[0]}ms`);
  const dr = durations([retried], "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED");
  ok("…and the rail's time is measured from the first request, honestly long", dr[0] === 305_000, `${dr[0]}ms`);

  /* 5. Garbage in does not move a percentile. */
  const backwards = made("b1", [["AWAITING_INBOUND", 100], ["INBOUND_CONFIRMED", 0]]); // clock went back
  const ancient = made("b2", [["AWAITING_INBOUND", 0], ["INBOUND_CONFIRMED", 60 * 86_400]]); // 60 days
  ok("a negative duration is dropped", durations([backwards], "AWAITING_INBOUND", "INBOUND_CONFIRMED").length === 0);
  ok("an absurd duration is dropped", durations([ancient], "AWAITING_INBOUND", "INBOUND_CONFIRMED").length === 0);

  /* 6. Nothing at all is not an error. */
  const empty = stageStats([]);
  ok("an empty deployment reports every stage with zero samples", empty.length === STAGES.length && empty.every((s) => s.samples === 0 && s.p50 === null));

  console.log(`\n✅ stage-latency: ${passed} assertions passed\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
