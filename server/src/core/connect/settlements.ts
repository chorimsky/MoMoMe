/* ============================================================
   MoMo›Me Connect — Settlement intents per payment (§6 Phase 6, §11, §20).

   A payment is COMPLETED when the payee is owed the value; it is SETTLED when the value is
   where the payee asked for it (their Settlement Profile). The two are separate objects and
   separate statuses. A settlement intent is opened for every completed payment whose value
   landed on the payee's MoMo›Me balance but whose profile wants it elsewhere:
     mobile_money / lightning → executed automatically as a payout from the balance
                                (instant, or batched by the profile's frequency);
     bank_transfer            → executed by the OPERATOR from treasury: the queue in Admin →
                                API Platform → Connect; the ledger moves balance → float at
                                the moment the operator records the bank reference.
   Externally funded payments are settled by the engine itself (delivered to Mobile Money);
   they get a settlement intent already `settled` for the audit trail.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { getMpi, type SettlementMethodId } from "./identities.js";
import { balanceOf, debitForPayout, refundPayout } from "./ledger.js";
import { createPayout } from "./payouts.js";
import { enqueueEvent } from "../interop/outbound.js";
import { COUNTRIES } from "../../../../shared/domain.js";

export type SettlementIntentStatus = "pending" | "processing" | "submitted" | "settled" | "failed" | "reversed";
export interface SettlementIntent {
  id: string; intentId: string; orgId: string; env: "live" | "test"; payee: string; amountXaf: number;
  method: SettlementMethodId; destination: Record<string, string | undefined>; frequency: string; dueAt: string;
  status: SettlementIntentStatus; payoutId?: string; providerRef?: string; operator?: string; failureReason?: string; note?: string;
  createdAt: string; updatedAt: string; settledAt?: string; events: Array<{ at: string; status: SettlementIntentStatus; note?: string }>;
}
const rows = new Map<string, SettlementIntent>();
register("connect_settlement_intents", () => [...rows.values()].slice(-20_000), (d: SettlementIntent[]) => { for (const r of d) rows.set(r.id, r); });
const now = () => new Date().toISOString();
const DUE_MS: Record<string, number> = { instant: 0, daily: 86_400_000, weekly: 7 * 86_400_000, manual: Number.POSITIVE_INFINITY };

let onChange: ((s: SettlementIntent) => void) | null = null;
/** intents.ts mirrors the settlement intent's status onto the payment intent's settlement_status. */
export function onSettlementChange(f: typeof onChange): void { onChange = f; }
function move(s: SettlementIntent, st: SettlementIntentStatus, note?: string) { if (s.status === st) return; s.status = st; s.updatedAt = now(); s.events.push({ at: s.updatedAt, status: st, note }); if (st === "settled") s.settledAt = s.updatedAt; touch("connect_settlement_intents"); enqueueEvent(`org:${s.orgId}`, `settlement.${st === "settled" ? "completed" : st === "submitted" ? "processing" : st}`, publicSettlementIntent(s)); onChange?.(s); }

/** Open (or record as already settled) the settlement of a completed payment intent. */
export function openSettlement(input: { intentId: string; orgId: string; env: "live" | "test"; payee: string; amountXaf: number; alreadySettledBy?: string }): SettlementIntent | undefined {
  if ([...rows.values()].some((r) => r.intentId === input.intentId)) return undefined; // one per payment
  const m = getMpi(input.payee); if (!m) return undefined;
  const orgId = m.orgId ?? input.orgId;
  const method = m.settlement.preferred; const dest = m.settlement.destination ?? {};
  const s: SettlementIntent = { id: `si_${crypto.randomBytes(8).toString("hex")}`, intentId: input.intentId, orgId, env: input.env, payee: m.id, amountXaf: input.amountXaf, method, destination: { phone: dest.phone, country: dest.country, bank: dest.bank, account: dest.account, lightning_address: dest.lightning_address }, frequency: m.settlement.frequency, dueAt: new Date(Date.now() + (Number.isFinite(DUE_MS[m.settlement.frequency]) ? DUE_MS[m.settlement.frequency] : 0)).toISOString(), status: "pending", createdAt: now(), updatedAt: now(), events: [{ at: now(), status: "pending" }] };
  if (input.alreadySettledBy) { s.status = "settled"; s.settledAt = s.createdAt; s.note = input.alreadySettledBy; s.events.push({ at: s.createdAt, status: "settled", note: input.alreadySettledBy }); }
  else if (method === "momo_me") { s.status = "settled"; s.settledAt = s.createdAt; s.note = "value is on the payee's MoMo›Me balance"; s.events.push({ at: s.createdAt, status: "settled", note: s.note }); }
  rows.set(s.id, s); touch("connect_settlement_intents");
  enqueueEvent(`org:${s.orgId}`, "settlement.created", publicSettlementIntent(s));
  if (s.status === "pending" && m.settlement.frequency === "instant") void execute(s);
  return s;
}

/** Automatic execution for Mobile Money / Lightning: a payout from the payee's balance. */
async function execute(s: SettlementIntent): Promise<void> {
  if (s.status !== "pending") return;
  const m = getMpi(s.payee); if (!m) return;
  if (s.method === "bank_transfer") { move(s, "processing", "queued for the treasury operator (bank transfer)"); return; }
  if (s.method !== "mobile_money" && s.method !== "lightning") return;
  if (balanceOf(m.id) < s.amountXaf) { move(s, "failed", `balance ${balanceOf(m.id)} XAF < ${s.amountXaf} XAF`); return; }
  move(s, "processing", `payout to ${s.method}`);
  try {
    const p = await createPayout({ orgId: s.orgId, env: s.env, payer: m, amountXaf: s.amountXaf, destination: s.method === "lightning" ? { lightning_address: s.destination.lightning_address } : { phone: s.destination.phone ? `+${s.destination.phone}` : undefined, country: s.destination.country, name: m.displayName }, reference: `settlement:${s.id}`, metadata: { settlement_intent: s.id }, feeFree: true });
    s.payoutId = p.id; s.providerRef = p.providerRef; touch("connect_settlement_intents");
    if (p.status === "completed") move(s, "settled", `paid out (${p.provider ?? "rail"})`);
    else if (p.status === "reversed" || p.status === "failed") move(s, "failed", p.failureReason ?? "payout failed");
    else move(s, "submitted", "payout submitted; awaiting the provider");
  } catch (e) { move(s, "failed", e instanceof Error ? e.message : "payout failed"); }
}
/** Tick: batched (daily/weekly) settlements that are due, and submitted payouts that resolved. */
export async function settlementTick(payoutStatus: (id: string) => { status: string; providerRef?: string; failureReason?: string } | undefined): Promise<number> {
  let n = 0;
  for (const s of rows.values()) {
    if (s.status === "pending" && s.frequency !== "manual" && Date.parse(s.dueAt) <= Date.now()) { await execute(s); n++; }
    else if (s.status === "submitted" && s.payoutId) { const p = payoutStatus(s.payoutId); if (p?.status === "completed") { s.providerRef = p.providerRef; move(s, "settled", "provider confirmed"); n++; } else if (p?.status === "reversed" || p?.status === "failed") { move(s, "failed", p.failureReason ?? "payout failed"); n++; } }
  }
  return n;
}
/* ---------- operator actions (bank transfers, manual frequency, retries) ---------- */
export function operatorSubmit(s: SettlementIntent, by: string, bankRef: string): boolean {
  if (s.method !== "bank_transfer" || !["pending", "processing"].includes(s.status)) return false;
  const m = getMpi(s.payee); if (!m) return false;
  // The value leaves the payee's balance and the treasury pays the bank: one ledger transaction.
  if (!debitForPayout(s.id, m.id, s.amountXaf, 0)) { move(s, "failed", "balance no longer covers the settlement"); return false; }
  s.operator = by; s.providerRef = bankRef; touch("connect_settlement_intents");
  move(s, "submitted", `bank transfer ${bankRef} recorded by ${by}`);
  return true;
}
export function operatorSettle(s: SettlementIntent, by: string): boolean { if (s.status !== "submitted") return false; s.operator = by; move(s, "settled", `confirmed by ${by}`); return true; }
export function operatorFail(s: SettlementIntent, by: string, reason: string): boolean {
  if (!["pending", "processing", "submitted"].includes(s.status)) return false;
  if (s.status === "submitted" && s.method === "bank_transfer") { const m = getMpi(s.payee); if (m) refundPayout(s.id, m.id, s.amountXaf, 0); }
  s.operator = by; s.failureReason = reason; move(s, "failed", reason); return true;
}
export async function operatorExecuteNow(s: SettlementIntent): Promise<boolean> { if (s.status !== "pending") return false; await execute(s); return true; }
export function retrySettlement(s: SettlementIntent): boolean { if (s.status !== "failed") return false; s.status = "pending"; s.updatedAt = now(); s.events.push({ at: s.updatedAt, status: "pending", note: "retry" }); touch("connect_settlement_intents"); void execute(s); return true; }

export const getSettlementIntent = (id: string) => rows.get(id);
export const settlementIntentOf = (intentId: string) => [...rows.values()].find((r) => r.intentId === intentId);
export const settlementIntentsOf = (orgId: string, env: string, limit = 100) => [...rows.values()].filter((r) => r.orgId === orgId && r.env === env).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
export const allSettlementIntents = (limit = 500) => [...rows.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
export function publicSettlementIntent(s: SettlementIntent) {
  const dest = s.method === "bank_transfer" ? { type: "bank", bank: s.destination.bank ?? null, account: s.destination.account ? `…${s.destination.account.slice(-4)}` : null } : s.method === "lightning" ? { type: "lightning", address: s.destination.lightning_address ?? null } : s.method === "mobile_money" ? { type: "mobile_money", phone: s.destination.phone ? `${COUNTRIES[(s.destination.country ?? "CM") as keyof typeof COUNTRIES]?.dial ?? "+"}${s.destination.phone.replace(/^237/, "")}` : null } : { type: "momo_me" };
  return { id: s.id, object: "settlement_intent", payment_intent: s.intentId, payee: s.payee, status: s.status, method: s.method, frequency: s.frequency, due_at: s.dueAt, amount: { value: String(s.amountXaf), currency: "XAF" }, destination: dest, payout_id: s.payoutId ?? null, provider_reference: s.providerRef ?? null, failure_reason: s.failureReason ?? null, note: s.note ?? null, created_at: s.createdAt, settled_at: s.settledAt ?? null, livemode: s.env === "live" };
}
export function _resetSettlementIntents(): void { rows.clear(); }
