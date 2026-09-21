/* ============================================================
   API v1 — pricing plans, pricing rules and invoices.

   A plan says how an organization is charged and how hard it may hit the API:
     rateLimitRpm              requests per minute (payment endpoints get a quarter)
     paymentEndpointRpm        stricter ceiling for POST /v1/payments and refunds
     platformFeePct / minFee   default per-payment fee (the quote engine reads the org's
                               effective fee through effectiveFeePct())
     tiers                     volume tiers: fee % falls with monthly XAF volume
     fixedMonthlyXaf           platform subscription (0 for developer)
   Plans are configuration (admin-editable, persisted), never constants in the payment
   code. Invoices are computed from usage.ts at month end (or on demand) and are
   immutable once issued; a correction is a new credit-note invoice.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { getOrganization } from "./orgs.js";
import { usageSummary } from "./usage.js";

export interface VolumeTier { fromXaf: number; feePct: number }
export interface PricingPlan {
  id: string; name: string; rateLimitRpm: number; paymentEndpointRpm: number;
  platformFeePct: number; minFeeXaf: number; tiers: VolumeTier[]; fixedMonthlyXaf: number;
  /** Enterprise: a negotiated flat fee overrides tiers. */
  negotiatedFeePct?: number; description?: string; custom?: boolean;
}
export interface Invoice {
  id: string; orgId: string; env: "live"; period: string; // YYYY-MM
  issuedAt: string; status: "draft" | "issued" | "paid" | "void"; currency: "XAF";
  lines: Array<{ description: string; quantity: number; unitXaf: number; amountXaf: number }>;
  totalXaf: number; paidAt?: string; note?: string;
}

const DEFAULT_PLANS: PricingPlan[] = [
  { id: "developer", name: "Developer", rateLimitRpm: 60, paymentEndpointRpm: 15, platformFeePct: 1.5, minFeeXaf: 100, tiers: [], fixedMonthlyXaf: 0, description: "Sandbox and low-volume live use." },
  { id: "business", name: "Business", rateLimitRpm: 300, paymentEndpointRpm: 60, platformFeePct: 1.2, minFeeXaf: 100, tiers: [{ fromXaf: 10_000_000, feePct: 1.0 }, { fromXaf: 50_000_000, feePct: 0.9 }], fixedMonthlyXaf: 0, description: "Volume tiers from 10M XAF / month." },
  { id: "enterprise", name: "Enterprise", rateLimitRpm: 1200, paymentEndpointRpm: 300, platformFeePct: 0.9, minFeeXaf: 50, tiers: [], fixedMonthlyXaf: 0, custom: true, description: "Negotiated fee, custom limits, IP allow-list and signing." },
];
const plans = new Map<string, PricingPlan>(DEFAULT_PLANS.map((p) => [p.id, p]));
const invoices = new Map<string, Invoice>();
register("platform_plans", () => [...plans.values()], (d: PricingPlan[]) => { for (const p of d) plans.set(p.id, p); });
register("platform_invoices", () => [...invoices.values()], (d: Invoice[]) => { for (const i of d) invoices.set(i.id, i); });

export function listPlans(): PricingPlan[] { return [...plans.values()]; }
export function getPlan(id: string): PricingPlan { return plans.get(id) ?? plans.get("developer")!; }
export function upsertPlan(p: PricingPlan): PricingPlan { plans.set(p.id, p); touch("platform_plans"); return p; }
export function planOfOrg(orgId: string): PricingPlan { return getPlan(getOrganization(orgId)?.plan ?? "developer"); }

/** The fee % an organization pays on a payment now, given this month's volume so far. */
export function effectiveFeePct(orgId: string, env: string): { feePct: number; minFeeXaf: number; plan: string } {
  const plan = planOfOrg(orgId);
  if (plan.negotiatedFeePct !== undefined) return { feePct: plan.negotiatedFeePct, minFeeXaf: plan.minFeeXaf, plan: plan.id };
  const month = new Date().toISOString().slice(0, 7);
  const { summary } = usageSummary(orgId, env, `${month}-01`, `${month}-31`);
  let fee = plan.platformFeePct;
  for (const t of [...plan.tiers].sort((a, b) => a.fromXaf - b.fromXaf)) if (summary.volumeXaf >= t.fromXaf) fee = t.feePct;
  return { feePct: fee, minFeeXaf: plan.minFeeXaf, plan: plan.id };
}

/** Build (or rebuild while draft) the invoice for one org × month from usage. */
export function buildInvoice(orgId: string, period: string): Invoice {
  const existing = [...invoices.values()].find((i) => i.orgId === orgId && i.period === period);
  if (existing && existing.status !== "draft") return existing;
  const plan = planOfOrg(orgId);
  const { summary } = usageSummary(orgId, "live", `${period}-01`, `${period}-31`);
  const lines: Invoice["lines"] = [];
  if (plan.fixedMonthlyXaf > 0) lines.push({ description: `${plan.name} plan — monthly`, quantity: 1, unitXaf: plan.fixedMonthlyXaf, amountXaf: plan.fixedMonthlyXaf });
  lines.push({ description: `Platform fees on ${summary.completed} completed payments (${summary.volumeXaf.toLocaleString("en")} XAF)`, quantity: summary.completed, unitXaf: summary.completed ? Math.round(summary.feesXaf / summary.completed) : 0, amountXaf: summary.feesXaf });
  const inv: Invoice = existing ?? { id: `inv_${crypto.randomBytes(6).toString("hex")}`, orgId, env: "live", period, issuedAt: new Date().toISOString(), status: "draft", currency: "XAF", lines: [], totalXaf: 0 };
  inv.lines = lines; inv.totalXaf = lines.reduce((s, l) => s + l.amountXaf, 0);
  invoices.set(inv.id, inv); touch("platform_invoices");
  return inv;
}
export function issueInvoice(id: string): Invoice | undefined { const i = invoices.get(id); if (!i || i.status !== "draft") return i; i.status = "issued"; i.issuedAt = new Date().toISOString(); touch("platform_invoices"); return i; }
export function markInvoicePaid(id: string): Invoice | undefined { const i = invoices.get(id); if (!i || i.status !== "issued") return i; i.status = "paid"; i.paidAt = new Date().toISOString(); touch("platform_invoices"); return i; }
export function invoicesOf(orgId: string): Invoice[] { return [...invoices.values()].filter((i) => i.orgId === orgId).sort((a, b) => b.period.localeCompare(a.period)); }
export function _resetBilling(): void { plans.clear(); for (const p of DEFAULT_PLANS) plans.set(p.id, p); invoices.clear(); }
