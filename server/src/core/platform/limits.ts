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

/* A rule has three independent parts, and confusing the first two is the easiest mistake
   here, so they are named apart:

     SCOPE    — which payments this rule is ABOUT. `scope.operators: ["MTN"]` means "this
                rule has an opinion about MTN payments". It permits nothing.
     ALLOW    — what a matched payment may DO. `allow.destinationOperators: ["MTN"]` means
                "only MTN may be paid". It is the delegation: who may be paid, over what,
                to where. An ABSENT or EMPTY list is NO CONSTRAINT, so every rule written
                before this existed behaves exactly as it did.
     CEILINGS — how much.

   Read the other way round: scope selects the rule, allow restricts the payment. A rule
   that scopes to MTN and allows nothing restricts nothing about MTN. */
export interface LimitRule {
  id: string; name: string; enabled: boolean; priority: number;
  /** credentialIds binds a rule to ONE machine credential, which is what makes a rule a
   *  delegation rather than an organization-wide policy: an agent's key can be bounded
   *  without bounding the humans and servers that share its organization. */
  scope: { orgIds?: string[]; credentialIds?: string[]; envs?: Array<"live" | "test">; countries?: string[]; assets?: string[]; currencies?: string[]; operators?: string[]; plans?: string[] };
  ceilings: { maxTransactionXaf?: number; minTransactionXaf?: number; dailyXaf?: number; monthlyXaf?: number; velocityPerHour?: number; dailyCount?: number };
  /** The delegation. Absent means unconstrained — never "deny all". */
  allow?: {
    /** Recipient numbers that may be paid, as local digits for their country. */
    recipients?: string[];
    /** Destination mobile money operators that may be paid. */
    destinationOperators?: string[];
    /** Pay-in methods that may fund a payment (LIGHTNING, ONCHAIN, USDT…). */
    fundingMethods?: string[];
    /** Destination jurisdictions. */
    destinationCountries?: string[];
  };
  /** Validity window. A delegation that cannot expire is not a delegation, it is a
   *  permission — so a rule may carry its own start and end, and outside them it simply
   *  does not apply (it is not a refusal: an expired delegation leaves whatever other
   *  rules match in charge, which for the defaults still bounds the organization). */
  notBefore?: string; notAfter?: string;
  /** Payments at or above this hold for a person, on top of the operator's global
   *  threshold. Only ever TIGHTENS: the effective threshold is the lower of the two. */
  requireApprovalAboveXaf?: number;
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

export interface LimitSubject {
  orgId: string; env: "live" | "test"; plan: string; country: string; asset: string; currency: string; operator: string; xaf: number;
  /** Which credential asked. Optional so every existing caller still compiles; a rule
   *  scoped to credentialIds simply cannot match a subject that does not say. */
  credentialId?: string;
  /** What the payment would actually do — read by `allow`, not by `scope`. */
  recipient?: string; method?: string;
}
/** Is the rule in force right now? An absent bound is unbounded. */
const inWindow = (r: LimitRule, t: number) =>
  (!r.notBefore || t >= Date.parse(r.notBefore)) && (!r.notAfter || t <= Date.parse(r.notAfter));
const matches = (r: LimitRule, s: LimitSubject, t = Date.now()) => {
  const sc = r.scope; const has = (l: string[] | undefined, v: string) => !l || !l.length || l.includes(v);
  // A credential-scoped rule needs to know the credential. Treating "unknown" as a match
  // would apply one machine's delegation to every caller that did not identify itself.
  const credOk = !sc.credentialIds || !sc.credentialIds.length || (!!s.credentialId && sc.credentialIds.includes(s.credentialId));
  return r.enabled && inWindow(r, t) && credOk && has(sc.orgIds, s.orgId) && has(sc.envs, s.env) && has(sc.countries, s.country) && has(sc.assets, s.asset) && has(sc.currencies, s.currency) && has(sc.operators, s.operator) && has(sc.plans, s.plan);
};
/** Digits only, last 9, so +237 670 123 456 and 670123456 are the same number. The same
 *  comparison the merchant attribution path uses — a delegation that can be defeated by
 *  writing the country code is not one. */
const sameNumber = (a: string, b: string) => {
  const d = (x: string) => x.replace(/\D/g, "").slice(-9);
  return d(a).length >= 6 && d(a) === d(b);
};

/** Aggregate the organization's payments in a window (created through /v1, this env).
 *  Counts everything not FAILED/REFUNDED so an in-flight payment already consumes limit. */
async function windowTotals(orgId: string, env: "live" | "test", sinceMs: number): Promise<{ xaf: number; count: number }> {
  const ids = metasOf(orgId, env).filter((m) => Date.parse(m.createdAt) >= sinceMs).map((m) => m.paymentId);
  let xaf = 0, count = 0;
  for (const id of ids) { const p = await store().getPayment(id); if (!p || p.state === "FAILED" || p.state === "REFUNDED" || p.state === "REFUND_PENDING") continue; xaf += p.xaf; count++; }
  return { xaf, count };
}

export type LimitCheck =
  | { ok: true; rules: string[]; approvalAboveXaf?: number }
  /** `ceiling` is a number for a ceiling breach; for a delegation refusal it is the
   *  allow-list that was not satisfied, so one shape carries both. */
  | { ok: false; rule: LimitRule; limit: string; value: number | string; ceiling: number | string[] };
export async function checkLimits(s: LimitSubject): Promise<LimitCheck> {
  const applicable = listLimitRules().filter((r) => matches(r, s));
  const t = Date.now();
  const day0 = new Date(t); day0.setUTCHours(0, 0, 0, 0);
  const month0 = new Date(t); month0.setUTCDate(1); month0.setUTCHours(0, 0, 0, 0);
  let day: { xaf: number; count: number } | undefined, month: { xaf: number; count: number } | undefined, hour: { xaf: number; count: number } | undefined;
  for (const r of applicable) {
    // THE DELEGATION, before the ceilings: "may this payment happen at all" is a different
    // question from "is it too big", and answering the cheaper one first means a payment to
    // an un-approved recipient is refused as such instead of being refused for its amount.
    const a = r.allow;
    if (a) {
      if (a.recipients?.length && !(s.recipient && a.recipients.some((x) => sameNumber(x, s.recipient!))))
        return { ok: false, rule: r, limit: "recipient_not_allowed", value: s.recipient ?? "(not given)", ceiling: a.recipients };
      if (a.destinationOperators?.length && !a.destinationOperators.includes(s.operator))
        return { ok: false, rule: r, limit: "operator_not_allowed", value: s.operator, ceiling: a.destinationOperators };
      if (a.destinationCountries?.length && !a.destinationCountries.includes(s.country))
        return { ok: false, rule: r, limit: "country_not_allowed", value: s.country, ceiling: a.destinationCountries };
      if (a.fundingMethods?.length && !(s.method && a.fundingMethods.includes(s.method)))
        return { ok: false, rule: r, limit: "funding_method_not_allowed", value: s.method ?? "(not given)", ceiling: a.fundingMethods };
    }
    const c = r.ceilings;
    if (c.minTransactionXaf !== undefined && s.xaf < c.minTransactionXaf) return { ok: false, rule: r, limit: "min_transaction_amount", value: s.xaf, ceiling: c.minTransactionXaf };
    if (c.maxTransactionXaf !== undefined && s.xaf > c.maxTransactionXaf) return { ok: false, rule: r, limit: "max_transaction_amount", value: s.xaf, ceiling: c.maxTransactionXaf };
    if (c.dailyXaf !== undefined || c.dailyCount !== undefined) { day ??= await windowTotals(s.orgId, s.env, day0.getTime());
      if (c.dailyXaf !== undefined && day.xaf + s.xaf > c.dailyXaf) return { ok: false, rule: r, limit: "daily_limit", value: day.xaf + s.xaf, ceiling: c.dailyXaf };
      if (c.dailyCount !== undefined && day.count + 1 > c.dailyCount) return { ok: false, rule: r, limit: "daily_count", value: day.count + 1, ceiling: c.dailyCount }; }
    if (c.monthlyXaf !== undefined) { month ??= await windowTotals(s.orgId, s.env, month0.getTime()); if (month.xaf + s.xaf > c.monthlyXaf) return { ok: false, rule: r, limit: "monthly_limit", value: month.xaf + s.xaf, ceiling: c.monthlyXaf }; }
    if (c.velocityPerHour !== undefined) { hour ??= await windowTotals(s.orgId, s.env, t - 3_600_000); if (hour.count + 1 > c.velocityPerHour) return { ok: false, rule: r, limit: "velocity_limit", value: hour.count + 1, ceiling: c.velocityPerHour }; }
  }
  // The tightest approval threshold among the rules that matched. Returned rather than
  // enforced here: holding a payment for a person is the settlement engine's job, and this
  // module must not be able to decide it on its own.
  const thresholds = applicable.map((r) => r.requireApprovalAboveXaf).filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
  return { ok: true, rules: applicable.map((r) => r.id), ...(thresholds.length ? { approvalAboveXaf: Math.min(...thresholds) } : {}) };
}
export function _resetLimits(): void { rules.clear(); for (const r of DEFAULTS) rules.set(r.id, r); }
