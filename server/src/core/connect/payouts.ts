/* ============================================================
   MoMo›Me Connect — Payouts from a MoMo›Me balance (§13 lightning_send, Flow 2, Flow 5).

   "Pay 25 000 XAF from my balance to +237… / to name@wallet.com." The value leaves the
   payer's MPI balance (ledger), then:
     mobile_money → the existing payout rails (Peexit / PawaPay / simulator) through the
                    same balance-aware selection the engine uses; status by authoritative
                    re-query, never a callback body;
     lightning    → the Lightning provider adapter (IBEX today) pays the Lightning Address;
                    the institution never sees sats — it sends XAF.
   A payout that fails after the debit is REVERSED by a compensating ledger entry. Every
   payout is idempotent on `po_<id>`.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { getMpi, findByAlias, mpiForPhone, type Mpi } from "./identities.js";
import { debitForPayout, refundPayout, balanceOf } from "./ledger.js";
import { selectFundedAggregator, aggregatorByName } from "../routing.js";
import { checkPhone, splitDialed, COUNTRIES } from "../../../../shared/domain.js";
import type { CountryCode } from "../../../../shared/types.js";
import { msatForXaf } from "../lnurl.js";
import * as ibex from "../../adapters/ibex.js";
import { ibexConfigured, liveMoney } from "../../config.js";
import { effectiveFeePct } from "../platform/billing.js";
import { enqueueEvent } from "../interop/outbound.js";
import { config } from "../../config.js";

export type PayoutStatus = "created" | "processing" | "completed" | "failed" | "reversed";
export interface Payout {
  id: string; orgId: string; env: "live" | "test"; payer: string; amount: { value: number; currency: "XAF" }; feeXaf: number;
  destination: { type: "mobile_money"; phone: string; country: CountryCode; operator: string; name?: string; mpi?: string } | { type: "lightning"; address: string; mpi?: string };
  status: PayoutStatus; provider?: string; providerRef?: string; failureReason?: string; reference?: string; metadata: Record<string, string>;
  createdAt: string; updatedAt: string; completedAt?: string; events: Array<{ at: string; status: PayoutStatus; note?: string }>;
}
const rows = new Map<string, Payout>();
register("connect_payouts", () => [...rows.values()].slice(-20_000), (d: Payout[]) => { for (const p of d) rows.set(p.id, p); });
const now = () => new Date().toISOString();
function move(p: Payout, s: PayoutStatus, note?: string) { if (p.status === s) return; p.status = s; p.updatedAt = now(); p.events.push({ at: p.updatedAt, status: s, note }); if (s === "completed") p.completedAt = p.updatedAt; touch("connect_payouts"); enqueueEvent(`org:${p.orgId}`, `payout.${s}`, publicPayout(p)); }

export class PayoutError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }

export interface CreatePayoutInput { orgId: string; env: "live" | "test"; payer: Mpi; amountXaf: number; destination: { phone?: string; country?: string; lightning_address?: string; identity?: string; name?: string }; reference?: string; metadata?: Record<string, string>; /** A settlement of already-charged value: no platform fee again. */ feeFree?: boolean }
export async function createPayout(input: CreatePayoutInput): Promise<Payout> {
  if (!Number.isFinite(input.amountXaf) || input.amountXaf <= 0) throw new PayoutError("INVALID_REQUEST", "amount must be a positive number of XAF.", 422);
  const xaf = Math.round(input.amountXaf);
  const { feePct } = effectiveFeePct(input.orgId, input.env); const feeXaf = input.feeFree ? 0 : Math.round((xaf * feePct) / 100);
  let destination: Payout["destination"];
  const d = input.destination;
  if (d.identity) { const m = getMpi(d.identity); if (!m) throw new PayoutError("IDENTITY_NOT_FOUND", "Unknown destination identity.", 404); const ph = m.settlement.destination?.phone ?? m.aliases.find((a) => a.type === "phone")?.value; const ln = m.aliases.find((a) => a.type === "lightning_address")?.value; if (ph) d.phone = `+${ph}`; else if (ln) d.lightning_address = ln; else throw new PayoutError("ROUTE_UNAVAILABLE", "That identity has no payout destination.", 503); }
  if (d.phone) {
    const sp = splitDialed(d.phone, (d.country as CountryCode) ?? input.payer.country); const chk = checkPhone(sp.local, sp.country);
    if (!chk.ok || !chk.provider) throw new PayoutError("INVALID_IDENTITY", "Not a valid Mobile Money number.", 422);
    const mpi = findByAlias("phone", d.phone, sp.country) ?? mpiForPhone(d.phone, sp.country, d.name);
    destination = { type: "mobile_money", phone: chk.local, country: sp.country, operator: chk.provider, name: d.name, mpi: mpi?.id };
  } else if (d.lightning_address) {
    const addr = d.lightning_address.trim().toLowerCase().replace(/^lightning:/, "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr)) throw new PayoutError("INVALID_IDENTITY", "Not a valid Lightning Address.", 422);
    if (!ibexConfigured() && liveMoney()) throw new PayoutError("PAYMENT_METHOD_UNAVAILABLE", "Lightning sending is not available on this deployment.", 503);
    destination = { type: "lightning", address: addr, mpi: findByAlias("lightning_address", addr)?.id };
  } else throw new PayoutError("INVALID_REQUEST", "Give destination.phone, destination.lightning_address or destination.identity.", 422);
  if (balanceOf(input.payer.id) < xaf + feeXaf) throw new PayoutError("INSUFFICIENT_LIQUIDITY", `Balance ${balanceOf(input.payer.id)} XAF does not cover ${xaf + feeXaf} XAF (incl. fee).`, 409);
  const p: Payout = { id: `po_${crypto.randomBytes(8).toString("hex")}`, orgId: input.orgId, env: input.env, payer: input.payer.id, amount: { value: xaf, currency: "XAF" }, feeXaf, destination, status: "created", reference: input.reference, metadata: input.metadata ?? {}, createdAt: now(), updatedAt: now(), events: [{ at: now(), status: "created" }] };
  rows.set(p.id, p); touch("connect_payouts"); enqueueEvent(`org:${p.orgId}`, "payout.created", publicPayout(p));
  await execute(p);
  return p;
}

async function execute(p: Payout): Promise<void> {
  if (!debitForPayout(p.id, p.payer, p.amount.value, p.feeXaf)) { move(p, "failed", "balance insufficient at execution"); return; }
  move(p, "processing");
  try {
    if (p.destination.type === "mobile_money") {
      const rail = await selectFundedAggregator(p.destination.operator as "MTN" | "ORANGE", p.destination.country, p.amount.value, liveMoney());
      if (!rail) throw new Error("no funded payout rail for this operator");
      const r = await rail.disburse({ idempotencyKey: p.id, provider: p.destination.operator as "MTN" | "ORANGE", country: p.destination.country, phone: p.destination.phone, xaf: p.amount.value, name: p.destination.name ?? "MoMo›Me payout" });
      p.provider = rail.name; p.providerRef = r.providerRef; touch("connect_payouts");
      if (r.simulated) { move(p, "completed", "simulated rail confirmed"); return; }
      // Real rail: completion comes from the authoritative re-query (reconcilePayouts).
    } else {
      if (config.railsMode === "sandbox" && !ibexConfigured()) { p.provider = "sandbox"; p.providerRef = `sim_${p.id}`; move(p, "completed", "sandbox Lightning send"); return; }
      const msat = msatForXaf(p.amount.value);
      const r = await ibex.payLightningAddress(p.destination.address, msat);
      p.provider = "ibex"; p.providerRef = r.transactionId; touch("connect_payouts");
      if (r.settled) move(p, "completed", "Lightning payment settled"); // else reconcilePayouts polls
    }
  } catch (e) {
    refundPayout(p.id, p.payer, p.amount.value, p.feeXaf);
    p.failureReason = e instanceof Error ? e.message : "payout failed";
    move(p, "reversed", `payout failed and the balance was restored: ${p.failureReason}`);
  }
}
/** Authoritative status re-query for payouts still processing (job tick). */
export async function reconcilePayouts(): Promise<number> {
  let n = 0;
  for (const p of rows.values()) {
    if (p.status !== "processing" || !p.provider || !p.providerRef) continue;
    try {
      if (p.destination.type === "mobile_money") {
        const st = await aggregatorByName(p.provider).queryStatus(p.id);
        if (st === "COMPLETED") { move(p, "completed", "provider confirmed"); n++; }
        else if (st === "FAILED") { refundPayout(p.id, p.payer, p.amount.value, p.feeXaf); p.failureReason = "provider reported FAILED"; move(p, "reversed", "provider failed the payout; balance restored"); n++; }
      } else {
        const st = await ibex.transactionStatus(p.providerRef).catch(() => null);
        if (st?.settled) { move(p, "completed", "Lightning payment settled"); n++; }
        else if (st?.failed) { refundPayout(p.id, p.payer, p.amount.value, p.feeXaf); p.failureReason = "Lightning payment failed"; move(p, "reversed", "Lightning payment failed; balance restored"); n++; }
      }
    } catch { /* next tick */ }
  }
  return n;
}
export const getPayout = (id: string) => rows.get(id);
export const allPayoutsForMetrics = () => [...rows.values()];
export const payoutsOf = (orgId: string, env: string, limit = 100) => [...rows.values()].filter((p) => p.orgId === orgId && p.env === env).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
export function publicPayout(p: Payout) {
  return { id: p.id, object: "payout", status: p.status, payer: { identity: p.payer }, amount: { value: String(p.amount.value), currency: "XAF" }, fee: { value: String(p.feeXaf), currency: "XAF" }, destination: p.destination.type === "mobile_money" ? { type: "mobile_money", phone: `${COUNTRIES[p.destination.country].dial}${p.destination.phone}`, operator: p.destination.operator, name: p.destination.name ?? null, identity: p.destination.mpi ?? null } : { type: "lightning", address: p.destination.address, identity: p.destination.mpi ?? null }, provider_reference: p.providerRef ?? null, failure_reason: p.failureReason ?? null, reference: p.reference ?? null, metadata: p.metadata, created_at: p.createdAt, completed_at: p.completedAt ?? null, livemode: p.env === "live" };
}
export function _resetPayouts(): void { rows.clear(); }
