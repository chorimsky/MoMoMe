/* ============================================================
   Rail-cost backfill: a delivered payment's cost is written at delivery from what is known
   then; Peexit reports the EXACT fee on its settled row, which the status re-query reads.
   Within the rail's 3-day statement window, upgrade recent deliveries that still carry a
   contract/published/assumed figure to the invoice. Bounded, idempotent, best-effort.
   ============================================================ */
import { store } from "../db/store.js";
import * as peexit from "../adapters/peexit.js";
import { peexitLive } from "../config.js";

const WINDOW_MS = 3 * 24 * 60 * 60_000;
let lastRun = 0;

export async function backfillRailCosts(now = Date.now()): Promise<number> {
  if (!peexitLive() || now - lastRun < 10 * 60_000) return 0; // every 10 min is plenty
  lastRun = now;
  let n = 0;
  const recent = (await store().listPayments()).filter((p) => p.state === "DELIVERED" && p.aggregator === "peexit" && p.railCostSource !== "invoice" && now - Date.parse(p.updatedAt) < WINDOW_MS).slice(0, 50);
  for (const p of recent) {
    let fee = peexit.feeXafFor(p.ref);
    if (fee === undefined) { await peexit.queryStatus(p.ref).catch(() => null); fee = peexit.feeXafFor(p.ref); }
    if (typeof fee !== "number" || !Number.isFinite(fee)) continue;
    p.railCostXaf = fee; p.railCostSource = "invoice";
    await store().putPayment(p).catch(() => {});
    n++;
  }
  if (n) console.log(`[cost] ${n} payout cost(s) upgraded to the aggregator's invoice`);
  return n;
}
