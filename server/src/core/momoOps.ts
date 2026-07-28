/* ============================================================
   Admin Mobile Money operations — manual, standalone cash-out (disburse to a
   number) and cash-in (collect from a number) via PawaPay/Peexit, independent of
   the customer send flow. Routes MTN→PawaPay, Orange→Peexit (the corridor design).
   These move the real MoMo wallet balances directly; they are deliberately NOT
   posted to the customer-payment ledger (so they can't corrupt the send-flow float
   / gates). Every op is recorded in an append-only audit log. Gating (Ops-Manager+)
   is enforced at the route.
   ============================================================ */
import type { CountryCode, MomoFeeInfo, MomoOp, MomoRail, MomoRailBalance, ProviderId } from "../../../shared/types.js";
import { detectProvider } from "../../../shared/domain.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";
import * as pawapay from "../adapters/pawapay.js";
import * as peexit from "../adapters/peexit.js";
import type { DisburseRequest, PayoutStatus } from "../adapters/pawapay.js";

const ops: MomoOp[] = [];
register("momoops", () => ops.slice(0, 200), (d: MomoOp[]) => { ops.push(...d); });
export function history(): MomoOp[] { return ops.slice(0, 50); }
function record(o: MomoOp): void { ops.unshift(o); if (ops.length > 200) ops.pop(); touch("momoops"); }

/** Reconcile async admin Mobile Money ops (called on the reconcile loop):
 *  - cash-in / transfer_in (collections): the payer approves on their phone, so re-query
 *    the authoritative collection status and settle "accepted" → completed/failed.
 *  - transfer_out (a rebalance's disburse leg): once it COMPLETES, fire the matching
 *    collect leg (transfer_in) — so we only pull from the treasury phone AFTER the
 *    payout has actually landed there. Idempotent. */
export async function reconcilePendingCashins(): Promise<void> {
  const now = Date.now();
  for (const o of ops) {
    if (o.rail !== "peexit" || now - Date.parse(o.at) > 24 * 3600_000) continue; // only the last day
    if ((o.kind === "cashin" || o.kind === "transfer_in") && o.status === "accepted") {
      const s = await peexit.collectStatus(o.id).catch(() => null);
      if (s === "COMPLETED") { o.status = "completed"; o.feeXaf = peexit.feeXafFor(o.id) ?? o.feeXaf; touch("momoops"); }
      else if (s === "FAILED") { o.status = "failed"; o.error = o.error ?? "collection rejected by payer/rail"; touch("momoops"); }
    } else if (o.kind === "transfer_out") {
      if (o.status === "accepted") {
        const s = await peexit.queryStatus(o.id).catch(() => null);
        if (s === "COMPLETED") { o.status = "completed"; o.feeXaf = peexit.feeXafFor(o.id) ?? o.feeXaf; touch("momoops"); await fireCollectLeg(o); }
        else if (s === "FAILED") { o.status = "failed"; o.error = o.error ?? (peexit.failReason(o.id) ?? "rejected by the rail"); touch("momoops"); }
      } else if (o.status === "completed") {
        await fireCollectLeg(o); // idempotent backstop: ensure leg 2 exists
      }
    }
  }
}

/** Peexit auto-detects the operator and serves BOTH MTN and Orange from one API
 *  (disbursement + collection), so it's the rail for both. PawaPay's account is not
 *  activated (deposits + payouts NOT_ALLOWED), so it's bypassed here until PawaPay
 *  enables it — at which point restore MTN→pawapay. Routing is per-operator only via
 *  the wallet balance (Peexit keeps separate MTN-CM / Orange-cm wallets). */
function railFor(_provider: ProviderId): MomoRail { return "peexit"; }
const statusLabel = (s: PayoutStatus): MomoOp["status"] => (s === "COMPLETED" ? "completed" : s === "FAILED" ? "failed" : "accepted");
const railBalance = (rail: MomoRail, country: CountryCode, provider: ProviderId) =>
  rail === "peexit" ? peexit.availableBalanceXaf(country, provider) : pawapay.availableBalanceXaf(country);

/** Accurate account balances (XAF): the PAYOUT balance (disbursement_solde, shared by
 *  both operators — gates every cash-out) and the COLLECTION balance (collect_solde,
 *  what cash-in fills). null when unreachable. */
export async function balances(_country: CountryCode): Promise<MomoRailBalance[]> {
  const [payout, collect] = await Promise.all([
    peexit.availableBalanceXaf("CM").catch(() => null),
    peexit.collectBalanceXaf().catch(() => null),
  ]);
  return [
    { rail: "peexit", label: "Peexit payout wallet", balanceXaf: payout },
    { rail: "peexit", label: "Peexit collection wallet", balanceXaf: collect },
  ];
}

/** The active rail's fee schedule, for cost-aware ops in the admin UI. Small values
 *  (≤100) are treated as percentages (MoMo aggregator fees are ~1–3%); larger values
 *  as flat XAF. null when the rail doesn't expose fees / isn't live. */
export async function feeInfo(): Promise<MomoFeeInfo | null> {
  const s = await peexit.feeSchedule().catch(() => null);
  if (!s) return null;
  const vals = [s.disbMtn, s.disbOrange, s.collMtn, s.collOrange].filter((v): v is number => v != null && v > 0);
  if (!vals.length) return null;
  // Normalize to a single representation. MoMo aggregator fees are ~1–3%, so:
  //  - all < 1        → fractions (0.017) → percent ×100
  //  - all ≤ 20       → already percent (1.7)
  //  - otherwise      → flat XAF per op
  const allFraction = vals.every((v) => v < 1);
  const pct = allFraction || vals.every((v) => v <= 20);
  const scale = allFraction ? 100 : 1;
  const norm = (v: number | null): number | null => (v == null ? null : pct ? +(v * scale).toFixed(3) : v);
  return {
    rail: "peexit", pct,
    disburse: { mtn: norm(s.disbMtn), orange: norm(s.disbOrange) },
    collect: { mtn: norm(s.collMtn), orange: norm(s.collOrange) },
  };
}

/** CASH-OUT: disburse XAF to a Mobile Money number. Routes by the number's operator,
 *  requires the rail live + funded ≥ amount, records an audit entry. */
export async function cashout(phone: string, country: CountryCode, amount: number, by: string, name?: string): Promise<{ ok: boolean; error?: string; op?: MomoOp }> {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "bad_amount" };
  const provider = detectProvider(phone, country);
  if (!provider) return { ok: false, error: "bad_number" };
  const rail = railFor(provider);
  // Rail must be live + funded ≥ amount (mirrors the send-flow pre-flight gate).
  const bal = await railBalance(rail, country, provider);
  if (bal == null) return { ok: false, error: "rail_unavailable" };
  if (bal < amount) return { ok: false, error: "insufficient_balance" };
  const opId = id("mmo");
  const op: MomoOp = { id: opId, at: new Date().toISOString(), kind: "cashout", provider, rail, phone, amount, by, status: "accepted" };
  try {
    const req: DisburseRequest = { idempotencyKey: opId, provider, country, phone, xaf: amount, name };
    const res = rail === "peexit" ? await peexit.disburse(req) : await pawapay.disburse(req);
    op.providerRef = res.providerRef;
    // Real rails settle async; reflect the current status if already terminal.
    const status = rail === "peexit" ? await peexit.queryStatus(opId) : await pawapay.queryStatus(opId);
    if (status) op.status = statusLabel(status);
    // A payout accepted-then-rejected (e.g. INSUFFICIENT_FUND_TO_PAY_TX) → capture why.
    if (op.status === "failed") op.error = (rail === "peexit" ? peexit.failReason(opId) : undefined) ?? "rejected by the rail";
    if (rail === "peexit") op.feeXaf = peexit.feeXafFor(opId); // actual fee, when the row reported it

  } catch (e) {
    op.status = "failed"; op.error = e instanceof Error ? e.message : "send_failed";
    record(op);
    console.error(`[momo] cashout FAILED ${amount} XAF → ${phone} via ${rail} by ${by}: ${op.error}`);
    return { ok: false, error: op.error, op };
  }
  record(op);
  console.log(`[momo] cashout ${amount} XAF → ${phone} via ${rail} by ${by} (${op.status})`);
  return { ok: true, op };
}

/** CASH-IN: request XAF FROM a Mobile Money number (the payer approves on their
 *  phone). MTN→PawaPay deposit, Orange→Peexit collection. Pending until the payer
 *  approves, so it records as "accepted". `name` → the payer's name (customer_name). */
export async function cashin(phone: string, country: CountryCode, amount: number, by: string, name?: string): Promise<{ ok: boolean; error?: string; op?: MomoOp }> {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "bad_amount" };
  const provider = detectProvider(phone, country);
  if (!provider) return { ok: false, error: "bad_number" };
  const rail = railFor(provider);
  const opId = id("mmo");
  const op: MomoOp = { id: opId, at: new Date().toISOString(), kind: "cashin", provider, rail, phone, amount, by, status: "accepted" };
  try {
    const req: DisburseRequest = { idempotencyKey: opId, provider, country, phone, xaf: amount, name };
    const res = rail === "peexit" ? await peexit.collect(req) : await pawapay.deposit(req);
    op.providerRef = res.providerRef;
  } catch (e) {
    op.status = "failed"; op.error = e instanceof Error ? e.message : "deposit_failed";
    record(op);
    console.error(`[momo] cashin FAILED ${amount} XAF ← ${phone} via ${rail} by ${by}: ${op.error}`);
    return { ok: false, error: op.error, op };
  }
  record(op);
  console.log(`[momo] cashin ${amount} XAF ← ${phone} via ${rail} by ${by} (accepted — awaiting payer approval)`);
  return { ok: true, op };
}

/* ============================================================
   WALLET REBALANCE — Payout wallet → Collection wallet.
   Peexit has no internal wallet-to-wallet transfer API, so we move balance by
   round-tripping through an admin-controlled treasury Mobile Money number:
     leg 1 (transfer_out): DISBURSE the amount to the treasury number → payout ↓
     leg 2 (transfer_in):  COLLECT the same amount back            → collection ↑
   Leg 2 is only fired once leg 1 actually COMPLETES (here if it settled inline,
   else by the reconcile loop), so we never request a collection against money the
   treasury phone hasn't received yet. Per-leg Peexit fees apply, so the net moved
   is slightly less than the amount. The reverse (collection → payout) is NOT
   possible via the API — nothing credits the disbursement wallet except Peexit's
   own settlement — so only this direction is offered.
   ============================================================ */

/** Fire the collect leg (transfer_in) of a completed rebalance. Idempotent: no-ops
 *  if a transfer_in for this transferId already exists (fired or attempted). */
async function fireCollectLeg(outOp: MomoOp): Promise<void> {
  if (!outOp.transferId) return;
  if (ops.some((o) => o.kind === "transfer_in" && o.transferId === outOp.transferId)) return;
  const inId = id("mmo");
  const inOp: MomoOp = { id: inId, at: new Date().toISOString(), kind: "transfer_in", provider: outOp.provider, rail: "peexit", phone: outOp.phone, amount: outOp.amount, by: outOp.by, status: "accepted", transferId: outOp.transferId };
  try {
    const res = await peexit.collect({ idempotencyKey: inId, provider: outOp.provider, country: "CM", phone: outOp.phone, xaf: outOp.amount, name: "MoMoMe Treasury" });
    inOp.providerRef = res.providerRef;
  } catch (e) {
    inOp.status = "failed"; inOp.error = e instanceof Error ? e.message : "collect_failed";
  }
  record(inOp);
  console.log(`[momo] rebalance leg 2/2 (collect) ${outOp.amount} XAF ← ${outOp.phone} (transfer ${outOp.transferId}, ${inOp.status})`);
}

/** Rebalance the Peexit Payout wallet → Collection wallet via a controlled treasury
 *  number. Requires the payout balance to cover the amount; records the disburse leg
 *  and (once it settles) the collect leg. */
export async function transferToCollection(treasuryPhone: string, amount: number, by: string): Promise<{ ok: boolean; error?: string; op?: MomoOp }> {
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "bad_amount" };
  const provider = detectProvider(treasuryPhone, "CM");
  if (!provider) return { ok: false, error: "bad_number" };
  const payoutBal = await peexit.availableBalanceXaf("CM").catch(() => null);
  if (payoutBal == null) return { ok: false, error: "rail_unavailable" };
  if (payoutBal < amount) return { ok: false, error: "insufficient_balance" };
  const transferId = id("mmt");
  const opId = id("mmo");
  const op: MomoOp = { id: opId, at: new Date().toISOString(), kind: "transfer_out", provider, rail: "peexit", phone: treasuryPhone, amount, by, status: "accepted", transferId };
  try {
    const req: DisburseRequest = { idempotencyKey: opId, provider, country: "CM", phone: treasuryPhone, xaf: amount, name: "MoMoMe Treasury" };
    const res = await peexit.disburse(req);
    op.providerRef = res.providerRef;
    const status = await peexit.queryStatus(opId);
    if (status) op.status = statusLabel(status);
    if (op.status === "failed") op.error = peexit.failReason(opId) ?? "rejected by the rail";
    op.feeXaf = peexit.feeXafFor(opId);
  } catch (e) {
    op.status = "failed"; op.error = e instanceof Error ? e.message : "transfer_failed";
    record(op);
    console.error(`[momo] rebalance leg 1/2 FAILED ${amount} XAF → ${treasuryPhone} by ${by}: ${op.error}`);
    return { ok: false, error: op.error, op };
  }
  record(op);
  console.log(`[momo] rebalance leg 1/2 (disburse) ${amount} XAF → ${treasuryPhone} by ${by} (transfer ${transferId}, ${op.status})`);
  // If the disburse already settled inline (sandbox / fast rail), collect now; else
  // the reconcile loop fires leg 2 once it completes.
  if (op.status === "completed") await fireCollectLeg(op);
  return { ok: true, op };
}
