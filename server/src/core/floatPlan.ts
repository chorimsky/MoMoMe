/* ============================================================
   Float plan (Tier-2 item 9 of the infrastructure audit): the payout float is the real
   ceiling on volume, and idle float is a cost. From the last two weeks of delivered
   payouts per aggregator and each wallet's live balance: what leaves per day, how many
   days the wallet lasts, and the top-up that brings it to the target. Read-only.
   ============================================================ */
import type { FloatPlan } from "../../../shared/types.js";
import { store } from "../db/store.js";
import { PAYOUTS } from "../adapters/payouts.js";
import { getSettings } from "./settings.js";
import { config } from "../config.js";
import * as momoTransfer from "./momoTransfer.js";

const WINDOW_DAYS = 14;

export async function floatPlan(now = Date.now()): Promise<FloatPlan> {
  const since = now - WINDOW_DAYS * 24 * 60 * 60_000;
  const targetDays = getSettings().treasury.floatTargetDays ?? 5;
  const by = new Map<string, { payouts: number; volumeXaf: number }>();
  const add = (agg: string | undefined, xaf: number) => { const k = agg ?? "unknown"; const e = by.get(k) ?? { payouts: 0, volumeXaf: 0 }; e.payouts++; e.volumeXaf += xaf; by.set(k, e); };
  for (const p of await store().listPayments()) {
    if (p.state !== "DELIVERED") continue;
    const at = p.events.find((e) => e.state === "DELIVERED")?.at ?? p.updatedAt;
    if (Date.parse(at) >= since) add(p.aggregator, p.xaf);
  }
  for (const t of momoTransfer.allTransfers(100_000)) {
    if (t.state === "DELIVERED" && Date.parse(t.updatedAt) >= since) add(t.payoutRail, t.xaf);
  }
  const aggregators: FloatPlan["aggregators"] = [];
  for (const a of PAYOUTS) {
    const stats = by.get(a.name) ?? { payouts: 0, volumeXaf: 0 };
    if (!a.configured() && stats.payouts === 0 && config.railsMode !== "sandbox") continue; // neither wired nor used
    const balance = await a.balance("CM").catch(() => null);
    const avgDaily = Math.round(stats.volumeXaf / WINDOW_DAYS);
    const days = balance == null ? null : avgDaily > 0 ? Math.round((balance / avgDaily) * 10) / 10 : null;
    const topUp = balance == null ? 0 : Math.max(0, Math.round(avgDaily * targetDays - balance));
    aggregators.push({ name: a.name, live: a.live(), balanceXaf: balance, avgDailyXaf: avgDaily, daysOfFloat: days, topUpXaf: topUp, payouts: stats.payouts, volumeXaf: stats.volumeXaf });
  }
  // Payouts recorded without a rail name (older records) still leave the float: show them.
  const unknown = by.get("unknown");
  if (unknown && unknown.payouts > 0) aggregators.push({ name: "unattributed", live: false, balanceXaf: null, avgDailyXaf: Math.round(unknown.volumeXaf / WINDOW_DAYS), daysOfFloat: null, topUpXaf: 0, payouts: unknown.payouts, volumeXaf: unknown.volumeXaf });
  const known = aggregators.filter((x) => x.balanceXaf != null);
  const balance = known.length ? known.reduce((n, x) => n + (x.balanceXaf ?? 0), 0) : null;
  const avgDaily = aggregators.reduce((n, x) => n + x.avgDailyXaf, 0);
  const days = balance == null ? null : avgDaily > 0 ? Math.round((balance / avgDaily) * 10) / 10 : null;
  const topUp = aggregators.reduce((n, x) => n + x.topUpXaf, 0);
  // Idle: float above the target on wallets whose balance is known — money that could work elsewhere.
  const idle = known.reduce((n, x) => n + Math.max(0, (x.balanceXaf ?? 0) - x.avgDailyXaf * targetDays), 0);
  const note = avgDaily === 0 ? `No payouts delivered in the last ${WINDOW_DAYS} days — days-of-float cannot be computed.` : days == null ? "A wallet balance could not be read; the plan is partial." : days < 2 ? `Under two days of float — top up ${topUp.toLocaleString("en")} XAF to reach ${targetDays} days.` : days > targetDays * 2 ? `${idle.toLocaleString("en")} XAF sits above the ${targetDays}-day target.` : `On target.`;
  return { windowDays: WINDOW_DAYS, targetDays, aggregators, totals: { balanceXaf: balance, avgDailyXaf: avgDaily, daysOfFloat: days, topUpXaf: topUp }, idleXaf: idle, note };
}
