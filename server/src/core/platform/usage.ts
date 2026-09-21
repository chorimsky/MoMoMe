/* ============================================================
   API v1 — usage metering. Counted per organization × environment × UTC day:
   requests (by endpoint class), quotes, payments created / completed / failed, volume
   (XAF delivered), fees (XAF), webhook deliveries, settlements. Billing reads these;
   the dashboard shows them; nothing else depends on them.
   ============================================================ */
import { register, touch } from "../persist.js";

export interface UsageDay {
  orgId: string; env: string; day: string; // YYYY-MM-DD (UTC)
  requests: number; requestsByClass: Record<string, number>; errors: number;
  quotes: number; payments: number; completed: number; failed: number; volumeXaf: number; feesXaf: number;
  webhooks: number; webhookFailures: number; settlements: number; settledXaf: number;
  latencyMsSum: number; latencyN: number;
}
const days = new Map<string, UsageDay>();
register("platform_usage", () => [...days.values()], (d: UsageDay[]) => { for (const u of d) days.set(`${u.orgId}|${u.env}|${u.day}`, u); });

const today = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);
function row(orgId: string, env: string, day = today()): UsageDay {
  const k = `${orgId}|${env}|${day}`;
  let u = days.get(k);
  if (!u) { u = { orgId, env, day, requests: 0, requestsByClass: {}, errors: 0, quotes: 0, payments: 0, completed: 0, failed: 0, volumeXaf: 0, feesXaf: 0, webhooks: 0, webhookFailures: 0, settlements: 0, settledXaf: 0, latencyMsSum: 0, latencyN: 0 }; days.set(k, u); }
  return u;
}
// Snapshot writes are coalesced: many requests a second must not each flush the store.
let dirty = false; let flush: NodeJS.Timeout | null = null;
const mark = () => { dirty = true; if (!flush) { flush = setTimeout(() => { flush = null; if (dirty) { dirty = false; touch("platform_usage"); } }, 2000); flush.unref?.(); } };

export function meterRequest(orgId: string, env: string, cls: string, status: number, latencyMs: number): void {
  const u = row(orgId, env); u.requests++; u.requestsByClass[cls] = (u.requestsByClass[cls] ?? 0) + 1; if (status >= 400) u.errors++; u.latencyMsSum += latencyMs; u.latencyN++; mark();
}
export function meter(orgId: string, env: string, what: "quotes" | "payments" | "webhooks" | "webhookFailures" | "settlements", n = 1): void { const u = row(orgId, env); u[what] += n; mark(); }
export function meterOutcome(orgId: string, env: string, outcome: "completed" | "failed", xaf: number, feeXaf: number): void { const u = row(orgId, env); u[outcome]++; if (outcome === "completed") { u.volumeXaf += xaf; u.feesXaf += feeXaf; } mark(); }
export function meterSettled(orgId: string, env: string, xaf: number): void { const u = row(orgId, env); u.settledXaf += xaf; mark(); }

export function usageOf(orgId: string, env: string, from: string, to: string): UsageDay[] {
  return [...days.values()].filter((u) => u.orgId === orgId && u.env === env && u.day >= from && u.day <= to).sort((a, b) => a.day.localeCompare(b.day));
}
export function usageSummary(orgId: string, env: string, from: string, to: string) {
  const rows = usageOf(orgId, env, from, to);
  const s = { from, to, requests: 0, errors: 0, quotes: 0, payments: 0, completed: 0, failed: 0, volumeXaf: 0, feesXaf: 0, webhooks: 0, webhookFailures: 0, settlements: 0, settledXaf: 0, avgLatencyMs: 0, successRatePct: 0 };
  let lsum = 0, ln = 0;
  for (const u of rows) { s.requests += u.requests; s.errors += u.errors; s.quotes += u.quotes; s.payments += u.payments; s.completed += u.completed; s.failed += u.failed; s.volumeXaf += u.volumeXaf; s.feesXaf += u.feesXaf; s.webhooks += u.webhooks; s.webhookFailures += u.webhookFailures; s.settlements += u.settlements; s.settledXaf += u.settledXaf; lsum += u.latencyMsSum; ln += u.latencyN; }
  s.avgLatencyMs = ln ? Math.round(lsum / ln) : 0;
  s.successRatePct = s.completed + s.failed ? Math.round((100 * s.completed) / (s.completed + s.failed)) : 0;
  return { summary: s, days: rows.map(({ latencyMsSum: _a, latencyN: _b, ...r }) => r) };
}
export function _resetUsage(): void { days.clear(); }
