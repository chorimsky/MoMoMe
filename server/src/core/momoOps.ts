/* ============================================================
   Admin Mobile Money operations — manual, standalone cash-out (disburse to a
   number) and cash-in (collect from a number) via PawaPay/Peexit, independent of
   the customer send flow. Routes MTN→PawaPay, Orange→Peexit (the corridor design).
   These move the real MoMo wallet balances directly; they are deliberately NOT
   posted to the customer-payment ledger (so they can't corrupt the send-flow float
   / gates). Every op is recorded in an append-only audit log. Gating (Ops-Manager+)
   is enforced at the route.
   ============================================================ */
import type { CountryCode, MomoOp, MomoRail, MomoRailBalance, ProviderId } from "../../../shared/types.js";
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

/** Peexit auto-detects the operator and serves BOTH MTN and Orange from one API
 *  (disbursement + collection), so it's the rail for both. PawaPay's account is not
 *  activated (deposits + payouts NOT_ALLOWED), so it's bypassed here until PawaPay
 *  enables it — at which point restore MTN→pawapay. Routing is per-operator only via
 *  the wallet balance (Peexit keeps separate MTN-CM / Orange-cm wallets). */
function railFor(_provider: ProviderId): MomoRail { return "peexit"; }
const statusLabel = (s: PayoutStatus): MomoOp["status"] => (s === "COMPLETED" ? "completed" : s === "FAILED" ? "failed" : "accepted");
const railBalance = (rail: MomoRail, country: CountryCode, provider: ProviderId) =>
  rail === "peexit" ? peexit.availableBalanceXaf(country, provider) : pawapay.availableBalanceXaf(country);

/** Live Peexit XAF wallet balance per operator (MTN-CM / Orange-cm); null when
 *  unreachable. Both matter — Peexit serves both operators, and a negative/low MTN
 *  wallet is exactly why MTN can't route until it's topped up. */
export async function balances(country: CountryCode): Promise<MomoRailBalance[]> {
  const [mtn, orange] = await Promise.all([
    peexit.availableBalanceXaf(country, "MTN").catch(() => null),
    peexit.availableBalanceXaf(country, "ORANGE").catch(() => null),
  ]);
  return [
    { rail: "peexit", label: "Peexit · MTN", balanceXaf: mtn },
    { rail: "peexit", label: "Peexit · Orange", balanceXaf: orange },
  ];
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
