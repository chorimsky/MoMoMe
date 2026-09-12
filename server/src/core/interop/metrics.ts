/* ============================================================
   Observability — the numbers an operator of payment infrastructure watches.

   Measured, never fabricated:
     • API latency per route class (p50 / p95 / p99, count, 5xx) from a request timer
     • payment funnel timings from the payments' own event timelines: created → pay-in
       confirmed → delivered, and success / failure / held rates, per rail, over a window
     • provider health (circuit state, success rate, latency) from the two health trackers
     • webhook rejections / duplicates from the event log
   Kept in memory as bounded rings and recomputed on read; nothing here is on the money
   path or persisted (a restart resets latency samples, not the payment-derived figures).
   ============================================================ */
import type { Method, Payment } from "../../../../shared/types.js";
import type { Request, Response, NextFunction } from "express";
import { store } from "../../db/store.js";
import { eventStats } from "./events.js";
import { cryptoProviders, payoutProviders, railOfMethod } from "./rails.js";

/* ---------- request latency ---------- */
const SAMPLES = 2000;
const byRoute = new Map<string, { samples: number[]; count: number; errors5xx: number; errors4xx: number }>();

/** Group a path into a stable route class so per-id paths do not explode the table. */
export function routeClass(method: string, path: string): string {
  const p = path.split("?")[0]
    .replace(/\/(pay|pi|rt|px|q|MMM-\d{4}-\d+|[0-9a-f]{8,}|[A-Za-z0-9_-]{16,})(?=\/|$)/g, "/:id")
    .replace(/\/\d+(?=\/|$)/g, "/:n");
  return `${method} ${p}`;
}

export function recordLatency(method: string, path: string, ms: number, status: number): void {
  const k = routeClass(method, path);
  let r = byRoute.get(k);
  if (!r) { r = { samples: [], count: 0, errors5xx: 0, errors4xx: 0 }; byRoute.set(k, r); }
  r.count++;
  if (status >= 500) r.errors5xx++; else if (status >= 400) r.errors4xx++;
  r.samples.push(ms);
  if (r.samples.length > SAMPLES) r.samples.splice(0, r.samples.length - SAMPLES);
  if (byRoute.size > 300) byRoute.delete(byRoute.keys().next().value as string);
}

/** Express middleware: time every request, record on finish. */
export function latencyMiddleware(req: Request, res: Response, next: NextFunction): void {
  const t0 = process.hrtime.bigint();
  res.on("finish", () => recordLatency(req.method, req.originalUrl ?? req.url, Number(process.hrtime.bigint() - t0) / 1e6, res.statusCode));
  next();
}

function pct(sorted: number[], p: number): number { if (!sorted.length) return 0; return Math.round(sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))]); }

export function latencyReport(): Array<{ route: string; count: number; p50: number; p95: number; p99: number; errors5xx: number; errors4xx: number }> {
  return [...byRoute.entries()].map(([route, r]) => { const s = [...r.samples].sort((a, b) => a - b); return { route, count: r.count, p50: pct(s, 50), p95: pct(s, 95), p99: pct(s, 99), errors5xx: r.errors5xx, errors4xx: r.errors4xx }; })
    .sort((a, b) => b.count - a.count).slice(0, 60);
}

/* ---------- payment funnel ---------- */
const ms = (a?: string, b?: string): number | null => (a && b ? Date.parse(b) - Date.parse(a) : null);
const at = (p: Payment, state: Payment["state"]): string | undefined => p.events.find((e) => e.state === state)?.at;

export async function paymentMetrics(windowHours = 24): Promise<{
  windowHours: number; total: number; delivered: number; failed: number; refunded: number; held: number; open: number; expired: number;
  successRate: number | null;
  timings: { toInboundMs: { p50: number; p95: number } | null; toDeliveredMs: { p50: number; p95: number } | null; payoutMs: { p50: number; p95: number } | null };
  byRail: Array<{ rail: string; method: Method; total: number; delivered: number; failed: number; held: number; successRate: number | null; toDeliveredP50Ms: number | null }>;
  reasons: Array<{ reason: string; count: number }>;
}> {
  const since = Date.now() - windowHours * 3600_000;
  const ps = (await store().listPayments()).filter((p) => Date.parse(p.createdAt) >= since);
  const terminal = (p: Payment) => ["DELIVERED", "FAILED", "REFUNDED"].includes(p.state);
  const delivered = ps.filter((p) => p.state === "DELIVERED");
  const failed = ps.filter((p) => p.state === "FAILED");
  const refunded = ps.filter((p) => p.state === "REFUNDED");
  const held = ps.filter((p) => p.state === "MANUAL_REVIEW" || p.state === "REFUND_PENDING");
  const expired = ps.filter((p) => p.state === "AWAITING_INBOUND" && Date.parse(p.payInstruction.expiresAt) < Date.now() && p.method === "LIGHTNING");
  const open = ps.filter((p) => !terminal(p) && !held.includes(p) && !expired.includes(p));
  const stats = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return { p50: pct(s, 50), p95: pct(s, 95) }; };
  const toInbound = delivered.map((p) => ms(p.createdAt, at(p, "INBOUND_CONFIRMED"))).filter((x): x is number => x != null && x >= 0);
  const toDelivered = delivered.map((p) => ms(p.createdAt, at(p, "DELIVERED"))).filter((x): x is number => x != null && x >= 0);
  const payout = delivered.map((p) => ms(at(p, "PAYOUT_REQUESTED"), at(p, "DELIVERED"))).filter((x): x is number => x != null && x >= 0);
  const settledCount = delivered.length + failed.length + refunded.length;
  const byMethod = new Map<Method, Payment[]>();
  for (const p of ps) byMethod.set(p.method, [...(byMethod.get(p.method) ?? []), p]);
  const byRail = [...byMethod.entries()].map(([method, list]) => {
    const d = list.filter((p) => p.state === "DELIVERED"), f = list.filter((p) => p.state === "FAILED" || p.state === "REFUNDED"), h = list.filter((p) => p.state === "MANUAL_REVIEW" || p.state === "REFUND_PENDING");
    const td = d.map((p) => ms(p.createdAt, at(p, "DELIVERED"))).filter((x): x is number => x != null && x >= 0);
    return { rail: railOfMethod(method), method, total: list.length, delivered: d.length, failed: f.length, held: h.length, successRate: d.length + f.length ? d.length / (d.length + f.length) : null, toDeliveredP50Ms: td.length ? stats(td)!.p50 : null };
  });
  const reasonCount = new Map<string, number>();
  for (const p of [...failed, ...held]) { const note = [...p.events].reverse().find((e) => e.note)?.note ?? "(no note)"; const key = note.replace(/\d[\d\s.,]*/g, "#").slice(0, 80); reasonCount.set(key, (reasonCount.get(key) ?? 0) + 1); }
  return {
    windowHours, total: ps.length, delivered: delivered.length, failed: failed.length, refunded: refunded.length, held: held.length, open: open.length, expired: expired.length,
    successRate: settledCount ? delivered.length / settledCount : null,
    timings: { toInboundMs: stats(toInbound), toDeliveredMs: stats(toDelivered), payoutMs: stats(payout) },
    byRail, reasons: [...reasonCount.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 10),
  };
}

/* ---------- the whole picture ---------- */
export async function observability(windowHours = 24) {
  const [payments, payouts] = await Promise.all([paymentMetrics(windowHours), payoutProviders()]);
  return {
    generatedAt: new Date().toISOString(),
    api: latencyReport(),
    payments,
    providers: [...cryptoProviders(), ...payouts].map((p) => ({ id: p.id, rail: p.rail, health: p.health, successRate: p.successRate, avgLatencyMs: p.avgLatencyMs, liquidity: p.liquidity ?? null })),
    webhooks: eventStats(),
  };
}
