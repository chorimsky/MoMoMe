/* ============================================================
   API v1 — configurable limits. A rule has a SCOPE (which organizations, countries,
   assets, currencies, operators it applies to — empty = all) and CEILINGS (per
   transaction, per day, per month, velocity = payments per hour). Every rule that
   matches a payment is evaluated; the first breach refuses it with the rule named.
   Rules are persisted and admin-editable; there is one built-in default per environment
   so a new organization is bounded from its first call. Nothing Cameroon-specific is
   in code: the defaults are configuration rows.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { metasOf } from "./paymentMeta.js";
import { store } from "../../db/store.js";

export interface LimitRule {
  id: string; name: string; enabled: boolean; priority: number;
  scope: { orgIds?: string[]; envs?: Array<"live" | "test">; countries?: string[]; assets?: string[]; currencies?: string[]; operators?: string[]; plans?: string[] };
  ceilings: { maxTransactionXaf?: number; minTransactionXaf?: number; dailyXaf?: number; monthlyXaf?: number; velocityPerHour?: number; dailyCount?: number };
  createdAt: string; updatedAt: string;
}
const rules = new Map<string, LimitRule>();
const DEFAULTS: LimitRule[] = [
  { id: "lim_default_live", name: "Default (live)", enabled: true, priority: 100, scope: { envs: ["live"] }, ceilings: { minTransactionXaf: 100, maxTransactionXaf: 2_000_000, dailyXaf: 20_000_000, monthlyXaf: 200_000_000, velocityPerHour: 120, dailyCount: 1000 }, createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z" },
  { id: "lim_default_test", name: "Default (test)", enabled: true, priority: 100, scope: { envs: ["test"] }, ceilings: { minTransactionXaf: 100, maxTransactionXaf: 5_000_000, velocityPerHour: 600 }, createdAt: "2026-09-21T00:00:00Z", updatedAt: "2026-09-21T00:00:00Z" },
];
for (const r of DEFAULTS) rules.set(r.id, r);
register("platform_limits", () => [...rules.values()], (d: LimitRule[]) => { for (const r of d) rules.set(r.id, r); });

export function listLimitRules(): LimitRule[] { return [...rules.values()].sort((a, b) => a.priority - b.priority); }
export function upsertLimitRule(r: Omit<LimitRule, "id" | "createdAt" | "updatedAt"> & { id?: string }): LimitRule {
  const ex = r.id ? rules.get(r.id) : undefined;
  const now = new Date().toISOString();
  const row: LimitRule = { ...r, id: r.id ?? `lim_${crypto.randomBytes(5).toString("hex")}`, createdAt: ex?.createdAt ?? now, updatedAt: now };
  rules.set(row.id, row); touch("platform_limits"); return row;
}
export function deleteLimitRule(id: string): boolean { if (id.startsWith("lim_default_")) return false; const ok = rules.delete(id); if (ok) touch("platform_limits"); return ok; }

export interface LimitSubject { orgId: string; env: "live" | "test"; plan: string; country: string; asset: string; currency: string; operator: string; xaf: number }
const matches = (r: LimitRule, s: LimitSubject) => {
  const sc = r.scope; const has = (l: string[] | undefined, v: string) => !l || !l.length || l.includes(v);
  return r.enabled && has(sc.orgIds, s.orgId) && has(sc.envs, s.env) && has(sc.countries, s.country) && has(sc.assets, s.asset) && has(sc.currencies, s.currency) && has(sc.operators, s.operator) && has(sc.plans, s.plan);
};

/** Aggregate the organization's payments in a window (created through /v1, this env).
 *  Counts everything not FAILED/REFUNDED so an in-flight payment already consumes limit. */
async function windowTotals(orgId: string, env: "live" | "test", sinceMs: number): Promise<{ xaf: number; count: number }> {
  const ids = metasOf(orgId, env).filter((m) => Date.parse(m.createdAt) >= sinceMs).map((m) => m.paymentId);
  let xaf = 0, count = 0;
  for (const id of ids) { const p = await store().getPayment(id); if (!p || p.state === "FAILED" || p.state === "REFUNDED" || p.state === "REFUND_PENDING") continue; xaf += p.xaf; count++; }
  return { xaf, count };
}

export type LimitCheck = { ok: true; rules: string[] } | { ok: false; rule: LimitRule; limit: string; value: number; ceiling: number };
export async function checkLimits(s: LimitSubject): Promise<LimitCheck> {
  const applicable = listLimitRules().filter((r) => matches(r, s));
  const t = Date.now();
  const day0 = new Date(t); day0.setUTCHours(0, 0, 0, 0);
  const month0 = new Date(t); month0.setUTCDate(1); month0.setUTCHours(0, 0, 0, 0);
  let day: { xaf: number; count: number } | undefined, month: { xaf: number; count: number } | undefined, hour: { xaf: number; count: number } | undefined;
  for (const r of applicable) {
    const c = r.ceilings;
    if (c.minTransactionXaf !== undefined && s.xaf < c.minTransactionXaf) return { ok: false, rule: r, limit: "min_transaction_amount", value: s.xaf, ceiling: c.minTransactionXaf };
    if (c.maxTransactionXaf !== undefined && s.xaf > c.maxTransactionXaf) return { ok: false, rule: r, limit: "max_transaction_amount", value: s.xaf, ceiling: c.maxTransactionXaf };
    if (c.dailyXaf !== undefined || c.dailyCount !== undefined) { day ??= await windowTotals(s.orgId, s.env, day0.getTime());
      if (c.dailyXaf !== undefined && day.xaf + s.xaf > c.dailyXaf) return { ok: false, rule: r, limit: "daily_limit", value: day.xaf + s.xaf, ceiling: c.dailyXaf };
      if (c.dailyCount !== undefined && day.count + 1 > c.dailyCount) return { ok: false, rule: r, limit: "daily_count", value: day.count + 1, ceiling: c.dailyCount }; }
    if (c.monthlyXaf !== undefined) { month ??= await windowTotals(s.orgId, s.env, month0.getTime()); if (month.xaf + s.xaf > c.monthlyXaf) return { ok: false, rule: r, limit: "monthly_limit", value: month.xaf + s.xaf, ceiling: c.monthlyXaf }; }
    if (c.velocityPerHour !== undefined) { hour ??= await windowTotals(s.orgId, s.env, t - 3_600_000); if (hour.count + 1 > c.velocityPerHour) return { ok: false, rule: r, limit: "velocity_limit", value: hour.count + 1, ceiling: c.velocityPerHour }; }
  }
  return { ok: true, rules: applicable.map((r) => r.id) };
}
export function _resetLimits(): void { rules.clear(); for (const r of DEFAULTS) rules.set(r.id, r); }
