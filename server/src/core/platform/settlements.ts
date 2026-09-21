/* ============================================================
   API v1 — settlements: an organization asks for its XAF balance (or part of it) to be
   paid to a destination. The balance is LEDGER-DERIVED (`org_balance:<orgId>`), never a
   column; a settlement request moves the amount to `settlement_payable` at once so two
   requests cannot spend the same money, and the payout later clears the payable.

   States: REQUESTED → (operator approval) PROCESSING → SUBMITTED → COMPLETED
                     ↘ CANCELLED (by the org while REQUESTED) · FAILED (payout failed;
                       the amount returns to the balance by a compensating entry).

   Today no product credits organization balances (the settlement model is pass-through:
   docs/upi/STABLECOIN_CUSTODY_MODEL), so balances are 0 and requests above the balance
   are refused with `insufficient_balance`. The domain, ledger legs, approval workflow and
   API are complete so the first collection product plugs in by crediting the account.
   Execution over a payout rail is an operator action (approval workflow) — the money leg
   is recorded here; the rail call is the treasury operator's, with the provider reference
   stored on the settlement.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { recordTxn, balance } from "../ledger.js";
import { meter, meterSettled } from "./usage.js";
import { enqueueEvent } from "../interop/outbound.js";

export type SettlementStatus = "REQUESTED" | "PROCESSING" | "SUBMITTED" | "COMPLETED" | "FAILED" | "CANCELLED";
export interface Settlement {
  id: string; orgId: string; env: "live" | "test"; currency: "XAF"; amountXaf: number; feeXaf: number; netXaf: number;
  destination: { type: "mobile_money"; phone: string; operator: string; name?: string } | { type: "bank"; bank: string; account: string; name?: string };
  status: SettlementStatus; batchId?: string; providerRef?: string; failureReason?: string;
  requestedAt: string; updatedAt: string; approvedBy?: string; submittedAt?: string; completedAt?: string;
  reference?: string; requestId?: string; items?: string[];
}
const rows = new Map<string, Settlement>();
register("platform_settlements", () => [...rows.values()], (d: Settlement[]) => { for (const s of d) rows.set(s.id, s); });

const SETTLEMENT_FEE_XAF = Number(process.env.SETTLEMENT_FEE_XAF ?? 0);
const now = () => new Date().toISOString();
const acct = (orgId: string) => `org_balance:${orgId}` as const;

export function orgBalance(orgId: string): { available: number; pending: number; currency: "XAF" } {
  // Ledger convention here: the org's balance account is a LIABILITY of ours — credits raise it.
  const available = -balance(acct(orgId), "XAF");
  const pending = [...rows.values()].filter((s) => s.orgId === orgId && ["REQUESTED", "PROCESSING", "SUBMITTED"].includes(s.status)).reduce((a, s) => a + s.amountXaf, 0);
  return { available: Math.max(0, Math.round(available)), pending, currency: "XAF" };
}
/** A product that collected XAF for an organization credits it here (balanced against the clearing account the money sits in). */
export function creditOrganization(orgId: string, xaf: number, from: "momo_collect_clearing" | "payout_float_XAF", reference: string): void {
  recordTxn(reference, [{ account: from, direction: "debit", amount: xaf, currency: "XAF" }, { account: acct(orgId), direction: "credit", amount: xaf, currency: "XAF" }]);
}

export function requestSettlement(input: { orgId: string; env: "live" | "test"; amountXaf: number; destination: Settlement["destination"]; reference?: string; requestId?: string }): { ok: true; settlement: Settlement } | { ok: false; error: "insufficient_balance" | "invalid_amount"; available: number } {
  const bal = orgBalance(input.orgId);
  if (!Number.isFinite(input.amountXaf) || input.amountXaf <= 0 || input.amountXaf !== Math.round(input.amountXaf)) return { ok: false, error: "invalid_amount", available: bal.available };
  if (input.amountXaf > bal.available) return { ok: false, error: "insufficient_balance", available: bal.available };
  const s: Settlement = { id: `stl_${crypto.randomBytes(8).toString("hex")}`, orgId: input.orgId, env: input.env, currency: "XAF", amountXaf: input.amountXaf, feeXaf: SETTLEMENT_FEE_XAF, netXaf: input.amountXaf - SETTLEMENT_FEE_XAF, destination: input.destination, status: "REQUESTED", requestedAt: now(), updatedAt: now(), reference: input.reference, requestId: input.requestId };
  // The amount leaves the balance now (liability moves from the org's account to the payable).
  recordTxn(s.id, [{ account: acct(input.orgId), direction: "debit", amount: s.amountXaf, currency: "XAF" }, { account: "settlement_payable", direction: "credit", amount: s.amountXaf, currency: "XAF" }]);
  rows.set(s.id, s); touch("platform_settlements");
  meter(input.orgId, input.env, "settlements");
  enqueueEvent(`org:${input.orgId}`, "settlement.created", publicSettlement(s));
  return { ok: true, settlement: s };
}
export function getSettlement(id: string): Settlement | undefined { return rows.get(id); }
export function settlementsOf(orgId: string, env: string): Settlement[] { return [...rows.values()].filter((s) => s.orgId === orgId && s.env === env).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)); }
export function allSettlements(): Settlement[] { return [...rows.values()].sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)); }

const ALLOWED: Record<SettlementStatus, SettlementStatus[]> = { REQUESTED: ["PROCESSING", "CANCELLED", "FAILED"], PROCESSING: ["SUBMITTED", "FAILED", "CANCELLED"], SUBMITTED: ["COMPLETED", "FAILED"], COMPLETED: [], FAILED: [], CANCELLED: [] };
function move(s: Settlement, to: SettlementStatus, patch: Partial<Settlement> = {}): boolean {
  if (!ALLOWED[s.status].includes(to)) return false;
  Object.assign(s, patch, { status: to, updatedAt: now() });
  if (to === "CANCELLED" || to === "FAILED") {
    // Compensating entry: the money returns to the organization's balance.
    recordTxn(s.id, [{ account: "settlement_payable", direction: "debit", amount: s.amountXaf, currency: "XAF" }, { account: acct(s.orgId), direction: "credit", amount: s.amountXaf, currency: "XAF" }]);
    enqueueEvent(`org:${s.orgId}`, "settlement.failed", publicSettlement(s));
  }
  if (to === "COMPLETED") {
    // The payable is cleared by the XAF that left the float.
    recordTxn(s.id, [{ account: "settlement_payable", direction: "debit", amount: s.amountXaf, currency: "XAF" }, { account: "payout_float_XAF", direction: "credit", amount: s.netXaf, currency: "XAF" }, ...(s.feeXaf ? [{ account: "fee_revenue" as const, direction: "credit" as const, amount: s.feeXaf, currency: "XAF" as const }] : [])]);
    s.completedAt = now();
    meterSettled(s.orgId, s.env, s.amountXaf);
    enqueueEvent(`org:${s.orgId}`, "settlement.completed", publicSettlement(s));
  }
  touch("platform_settlements");
  return true;
}
export const cancelSettlement = (s: Settlement) => move(s, "CANCELLED");
export const approveSettlement = (s: Settlement, by: string) => move(s, "PROCESSING", { approvedBy: by });
export const submitSettlement = (s: Settlement, providerRef: string) => move(s, "SUBMITTED", { providerRef, submittedAt: now() });
export const completeSettlement = (s: Settlement) => move(s, "COMPLETED");
export const failSettlement = (s: Settlement, reason: string) => move(s, "FAILED", { failureReason: reason });

export function publicSettlement(s: Settlement) {
  return { id: s.id, object: "settlement", status: s.status, currency: s.currency, amount: String(s.amountXaf), fee: String(s.feeXaf), net_amount: String(s.netXaf), destination: s.destination, reference: s.reference ?? null, provider_reference: s.providerRef ?? null, failure_reason: s.failureReason ?? null, batch_id: s.batchId ?? null, requested_at: s.requestedAt, submitted_at: s.submittedAt ?? null, completed_at: s.completedAt ?? null, updated_at: s.updatedAt, livemode: s.env === "live" };
}
export function _resetSettlements(): void { rows.clear(); }
