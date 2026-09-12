/* ============================================================
   Mobile Money → Mobile Money — any network can pay any other.

   MTN and Orange do not talk to each other. MoMo›Me makes them: the payer approves a
   COLLECTION request on their own network (a prompt on their phone), the money lands
   in the aggregator's collection wallet, and the recipient is paid from the payout
   float on THEIR network. Cost: the aggregator's collect fee + payout fee + our margin,
   a fraction of the "withdraw cash, walk, deposit" it replaces.

   Where Lightning comes in. Within the corridors our payout rails reach, a Lightning hop
   would add cost and remove nothing, so it is not used. Beyond them — another country,
   another platform, a wallet — the recipient's LIGHTNING ADDRESS is the universal
   endpoint: we collect XAF, buy the sats from our own BTC position, and pay the address;
   whoever operates it pays out on its side. That is how one network talks to one it has
   never heard of, at Lightning's cost. The MoMo›Me identity `<number>@momome.xyz` is the
   same thing seen from the other direction.

   Money rules, same as everywhere else here:
     • never collect what we cannot pay out — payout liquidity is checked BEFORE the
       collection request goes to the payer's phone;
     • every state change is an event, every movement is a ledger entry;
     • a payout that fails after collection is REFUNDED to the payer, never kept;
     • the feature is OFF until an admin turns it on (settings.features.momoTransfer);
       users never see it and the API refuses it.
   ============================================================ */
import type { CountryCode, MomoParty, MomoTransfer, MomoTransferRoute, MomoTransferState, ProviderId } from "../../../shared/types.js";
import { COUNTRIES, LN_ADDRESS_DOMAIN, MAX_XAF, MIN_XAF, checkPhone, lnAddressNumber, splitDialed } from "../../../shared/domain.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";
import { store } from "../db/store.js";
import { getSettings } from "./settings.js";
import { liveMoney, ibexConfigured } from "../config.js";
import * as peexit from "../adapters/peexit.js";
import * as ibex from "../adapters/ibex.js";
import { payoutsFor } from "../adapters/payouts.js";
import { selectFundedAggregator } from "./routing.js";
import { engine as compliance } from "./interop/compliance.js";
import { notify } from "./notifications.js";
import { btcUsd, usdXaf, ensureRatesFresh, ratesFresh } from "./rates.js";

const transfers = new Map<string, MomoTransfer>();
register("momo_transfers", () => [...transfers.values()].slice(-20_000), (d: MomoTransfer[]) => { for (const t of d ?? []) transfers.set(t.id, t); });

export const TRANSFER_FEE_PCT = 0.015;   // our margin over the rails' own fees
const COLLECT_TTL_MS = 15 * 60_000;      // the payer has this long to approve on their phone

export function enabled(): boolean { return !!getSettings().features.momoTransfer; }
export function getTransfer(tid: string): MomoTransfer | undefined { return transfers.get(tid); }
export function transfersOf(owner: string): MomoTransfer[] { return [...transfers.values()].filter((t) => t.owner === owner).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function allTransfers(limit = 200): MomoTransfer[] { return [...transfers.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); }

function move(t: MomoTransfer, state: MomoTransferState, note?: string): void {
  t.state = state; t.updatedAt = new Date().toISOString();
  t.events.push({ at: t.updatedAt, state, ...(note ? { note } : {}) });
  touch("momo_transfers");
  console.log(`[momo-transfer] ${t.ref} → ${state}${note ? ` · ${note}` : ""}`);
}
const ref = () => `MMT-${new Date().getFullYear()}-${Math.floor(100000 + Math.random() * 900000)}`;

/** Quote: the recipient gets `xaf`; the payer is asked for `xaf` plus the fee. */
export function quote(xaf: number): { xaf: number; feeXaf: number; collectXaf: number; feePct: number } {
  const feeXaf = Math.max(100, Math.round(xaf * TRANSFER_FEE_PCT));
  return { xaf, feeXaf, collectXaf: xaf + feeXaf, feePct: TRANSFER_FEE_PCT };
}

export type CreateInput = { owner: string; fromPhone: string; toAddress: string; xaf: number; country?: CountryCode; fromName?: string; toName?: string; byAdmin?: boolean };
export type CreateResult = { ok: true; transfer: MomoTransfer } | { ok: false; status: number; error: string; message: string };

function party(raw: string, fallback: CountryCode): { ok: true; party: MomoParty } | { ok: false; reason: string; country: CountryCode } {
  const { country, local } = splitDialed(raw, fallback);
  const chk = checkPhone(local, country);
  if (!chk.ok || !chk.provider) return { ok: false, reason: chk.reason ?? "bad_length", country };
  return { ok: true, party: { phone: chk.local, country, provider: chk.provider } };
}

/** Where can this recipient be paid, and how? A number on a network our payout rails reach
 *  → direct. A Lightning Address on another domain → over Lightning. Our own Lightning
 *  Address is just the number. Anything else is refused with the reason. */
export function resolveDestination(raw: string, fallback: CountryCode): { ok: true; route: MomoTransferRoute; to: MomoTransfer["to"] } | { ok: false; error: string; message: string } {
  const s = raw.trim();
  const own = lnAddressNumber(s);
  const asLn = s.replace(/^lightning:/i, "");
  if (!own && /^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(asLn) && !asLn.toLowerCase().endsWith(`@${LN_ADDRESS_DOMAIN}`)) {
    if (!ibexConfigured()) return { ok: false, error: "lightning_unavailable", message: "Paying a Lightning Address needs the Lightning rail, which is not configured on this deployment." };
    return { ok: true, route: "lightning", to: { lightningAddress: asLn.toLowerCase() } };
  }
  const p = party(own ?? s, fallback);
  if (!p.ok) return { ok: false, error: "bad_recipient", message: p.reason === "unknown_operator" ? "No Mobile Money operator serves that number." : p.reason === "foreign_country" ? "That number belongs to another country; write it with its country code." : "That is not a valid Mobile Money number." };
  if (!COUNTRIES[p.party.country].active) return { ok: false, error: "country_inactive", message: `${COUNTRIES[p.party.country].name} is not live on MoMo›Me yet. A Lightning Address there can still be paid.` };
  if (!payoutsFor(p.party.provider).length) return { ok: false, error: "no_payout_rail", message: `No payout rail reaches ${p.party.provider} today.` };
  return { ok: true, route: "direct", to: p.party };
}

export async function createTransfer(input: CreateInput): Promise<CreateResult> {
  if (!enabled() && !input.byAdmin) return { ok: false, status: 403, error: "feature_disabled", message: "Mobile Money transfers are not available yet." };
  const xaf = Math.round(Number(input.xaf));
  if (!Number.isFinite(xaf) || xaf < MIN_XAF || xaf > MAX_XAF) return { ok: false, status: 400, error: "bad_amount", message: `Amount must be between ${MIN_XAF} and ${MAX_XAF} XAF.` };
  const fallback = input.country ?? "CM";
  const from = party(input.fromPhone, fallback);
  if (!from.ok) return { ok: false, status: 400, error: "bad_payer", message: "The payer's number is not a valid Mobile Money number." };
  if (!COUNTRIES[from.party.country].active) return { ok: false, status: 422, error: "country_inactive", message: `${COUNTRIES[from.party.country].name} is not live on MoMo›Me yet.` };
  const dest = resolveDestination(input.toAddress, from.party.country);
  if (!dest.ok) return { ok: false, status: 422, error: dest.error, message: dest.message };
  if (dest.route === "direct" && "phone" in dest.to && dest.to.phone === from.party.phone && dest.to.country === from.party.country) return { ok: false, status: 400, error: "same_number", message: "The payer and the recipient are the same number." };

  // Compliance before any money moves — the same engine as every payment.
  const screen = await compliance.screenTransaction({ owner: input.owner, recipientPhone: "phone" in dest.to ? dest.to.phone : dest.to.lightningAddress, recipientName: input.toName, country: "phone" in dest.to ? dest.to.country : from.party.country, xaf });
  if (screen.verdict === "blocked") return { ok: false, status: 403, error: "compliance_blocked", message: "This transfer cannot be made." };

  // Never collect what we cannot pay out. Direct: a funded payout rail for the recipient's
  // network; Lightning: a configured rail and a fresh rate. Checked BEFORE the payer is asked.
  if (dest.route === "direct") {
    const agg = await selectFundedAggregator((dest.to as MomoParty).provider, (dest.to as MomoParty).country, xaf, liveMoney()).catch(() => null);
    if (!agg) return { ok: false, status: 503, error: "no_liquidity", message: "The recipient's network cannot be paid right now. Please try again shortly." };
  } else {
    await ensureRatesFresh().catch(() => {});
    if (!ratesFresh()) return { ok: false, status: 503, error: "rates_unavailable", message: "Exchange rates are not available right now." };
  }
  const q = quote(xaf);
  const now = new Date().toISOString();
  const t: MomoTransfer = {
    id: id("mmt"), ref: ref(), createdAt: now, updatedAt: now, owner: input.owner,
    from: { ...from.party, ...(input.fromName ? { name: input.fromName } : {}) },
    to: { ...dest.to, ...(input.toName ? { name: input.toName } : {}) } as MomoTransfer["to"],
    route: dest.route, xaf: q.xaf, feeXaf: q.feeXaf, collectXaf: q.collectXaf,
    state: "AWAITING_PAYER", collectRail: "peexit", expiresAt: new Date(Date.now() + COLLECT_TTL_MS).toISOString(),
    ...(screen.flags.length ? { complianceFlags: screen.flags } : {}),
    events: [{ at: now, state: "AWAITING_PAYER", note: `collecting ${q.collectXaf} XAF from ${from.party.provider} ${from.party.phone}` }],
  };
  // The collection request: a prompt on the payer's phone. Peexit serves MTN and Orange.
  try {
    const res = await peexit.collect({ idempotencyKey: t.id, provider: t.from.provider, country: t.from.country, phone: t.from.phone, xaf: t.collectXaf, name: input.fromName ?? "MoMoMe transfer" });
    t.collectRef = res.providerRef; t.simulated = res.simulated;
  } catch (e) {
    console.error(`[momo-transfer] collect request failed for ${t.ref}:`, e instanceof Error ? e.message : e);
    return { ok: false, status: 503, error: "collect_unavailable", message: "The payer's network did not accept the request. Please try again." };
  }
  transfers.set(t.id, t); touch("momo_transfers");
  return { ok: true, transfer: t };
}

/** Before the payer approved, nothing has moved: the request simply lapses. */
export function cancelTransfer(t: MomoTransfer, by: string): boolean {
  if (t.state !== "AWAITING_PAYER") return false;
  move(t, "CANCELLED", `cancelled by ${by}`);
  return true;
}

/* ---------- the lifecycle, driven by the reconcile tick ---------- */
async function onCollected(t: MomoTransfer): Promise<void> {
  move(t, "COLLECTED", `${t.collectXaf} XAF collected from the payer`);
  await store().recordTxn(t.id, [
    { account: "momo_collect_clearing", direction: "debit", amount: t.collectXaf, currency: "XAF" },
    { account: "customer_wallet", direction: "credit", amount: t.collectXaf, currency: "XAF" },
  ]);
  await store().recordTxn(t.id, [
    { account: "customer_wallet", direction: "debit", amount: t.feeXaf, currency: "XAF" },
    { account: "fee_revenue", direction: "credit", amount: t.feeXaf, currency: "XAF" },
  ]);
  if (t.complianceFlags?.length) { move(t, "REFUND_PENDING", `held: ${t.complianceFlags.join("; ")} — refund unless an operator releases`); return; }
  await startPayout(t);
}

async function startPayout(t: MomoTransfer): Promise<void> {
  if (t.route === "lightning") {
    const to = t.to as { lightningAddress: string };
    try {
      await ensureRatesFresh();
      if (!ratesFresh()) throw new Error("FX feed not fresh");
      const btc = t.xaf / usdXaf() / btcUsd();
      const msat = Math.round(btc * 1e8) * 1000;
      move(t, "PAYING_OUT", `paying ${Math.round(btc * 1e8)} sats to ${to.lightningAddress}`);
      const r = await ibex.payLightningAddress(to.lightningAddress, msat);
      t.paidBtc = btc; t.lightningRef = r.transactionId;
      await store().recordTxn(t.id, [
        { account: "customer_wallet", direction: "debit", amount: t.xaf, currency: "XAF" },
        { account: "fx_position", direction: "credit", amount: t.xaf, currency: "XAF" },
      ]);
      await store().recordTxn(t.id, [
        { account: "fx_position", direction: "debit", amount: btc, currency: "BTC" },
        { account: "external_recipient", direction: "credit", amount: btc, currency: "BTC" },
      ]);
      await delivered(t, `paid over Lightning (${r.transactionId})`);
    } catch (e) {
      move(t, "REFUND_PENDING", `Lightning payment failed: ${e instanceof Error ? e.message : "error"}`);
      await refund(t);
    }
    return;
  }
  const to = t.to as MomoParty;
  const agg = await selectFundedAggregator(to.provider, to.country, t.xaf, liveMoney()).catch(() => null);
  if (!agg) { move(t, "REFUND_PENDING", "no funded payout rail at settlement time"); await refund(t); return; }
  try {
    const res = await agg.disburse({ idempotencyKey: `pay_${t.id}`, provider: to.provider, country: to.country, phone: to.phone, xaf: t.xaf, name: to.name ?? `${to.provider} ${to.phone}` });
    t.payoutRail = agg.name; t.payoutRef = res.providerRef;
    move(t, "PAYING_OUT", `payout requested via ${agg.name}`);
    if (res.simulated) await delivered(t, "simulated payout (sandbox)");
  } catch (e) {
    move(t, "REFUND_PENDING", `payout refused: ${e instanceof Error ? e.message : "error"}`);
    await refund(t);
  }
}

async function delivered(t: MomoTransfer, note: string): Promise<void> {
  await store().recordTxn(t.id, [
    { account: "customer_wallet", direction: "debit", amount: t.xaf, currency: "XAF" },
    { account: "external_recipient", direction: "credit", amount: t.xaf, currency: "XAF" },
  ]);
  move(t, "DELIVERED", note);
  const toLabel = "phone" in t.to ? `${COUNTRIES[t.to.country].dial} ${t.to.phone} (${t.to.provider})` : t.to.lightningAddress;
  await notify({ kind: "transfer_delivered", audience: "sender", to: `${COUNTRIES[t.from.country].dial.replace(/\D/g, "")}${t.from.phone}`, body: `Your transfer ${t.ref} of ${t.xaf} XAF to ${toLabel} has been delivered.`, paymentRef: t.ref }).catch(() => {});
  if ("phone" in t.to) await notify({ kind: "transfer_delivered", audience: "recipient", to: `${COUNTRIES[t.to.country].dial.replace(/\D/g, "")}${t.to.phone}`, body: `You received ${t.xaf} XAF on your ${t.to.provider} number via MoMo›Me (${t.ref}).`, paymentRef: t.ref }).catch(() => {});
}

/** The payer's money comes back to the payer's number, fee included: we failed, not them. */
async function refund(t: MomoTransfer): Promise<void> {
  const agg = await selectFundedAggregator(t.from.provider, t.from.country, t.collectXaf, liveMoney()).catch(() => null);
  if (!agg) { console.error(`[momo-transfer] ${t.ref} refund has no funded rail — operator must refund ${t.collectXaf} XAF to ${t.from.phone}`); await notify({ kind: "transfer_failed", audience: "operator", body: `Transfer ${t.ref}: ${t.collectXaf} XAF collected from ${t.from.phone} could not be paid out NOR refunded automatically — refund by hand.` }).catch(() => {}); return; }
  try {
    const res = await agg.disburse({ idempotencyKey: `refund_${t.id}`, provider: t.from.provider, country: t.from.country, phone: t.from.phone, xaf: t.collectXaf, name: t.from.name ?? "MoMoMe refund" });
    t.refundRef = res.providerRef;
    // Reverse the fee: a failed transfer costs the payer nothing.
    await store().recordTxn(t.id, [
      { account: "fee_revenue", direction: "debit", amount: t.feeXaf, currency: "XAF" },
      { account: "customer_wallet", direction: "credit", amount: t.feeXaf, currency: "XAF" },
    ]);
    await store().recordTxn(t.id, [
      { account: "customer_wallet", direction: "debit", amount: t.collectXaf, currency: "XAF" },
      { account: "external_recipient", direction: "credit", amount: t.collectXaf, currency: "XAF" },
    ]);
    move(t, "REFUNDED", `${t.collectXaf} XAF returned to the payer via ${agg.name}`);
    await notify({ kind: "transfer_failed", audience: "sender", to: `${COUNTRIES[t.from.country].dial.replace(/\D/g, "")}${t.from.phone}`, body: `Transfer ${t.ref} could not be delivered. ${t.collectXaf} XAF is being returned to your number.`, paymentRef: t.ref }).catch(() => {});
  } catch (e) {
    console.error(`[momo-transfer] ${t.ref} refund failed:`, e instanceof Error ? e.message : e);
    await notify({ kind: "transfer_failed", audience: "operator", body: `Transfer ${t.ref}: refund of ${t.collectXaf} XAF to ${t.from.phone} FAILED — refund by hand.` }).catch(() => {});
  }
}

/** Called each reconcile tick: collections that completed, payouts that settled, requests
 *  that lapsed. Idempotent — every step re-reads the rail's word before moving. */
export async function reconcileTransfers(now = Date.now()): Promise<void> {
  for (const t of transfers.values()) {
    try {
      if (t.state === "AWAITING_PAYER") {
        const s = t.simulated ? "COMPLETED" : await peexit.collectStatus(t.id).catch(() => null);
        if (s === "COMPLETED") { await onCollected(t); continue; }
        if (s === "FAILED") { move(t, "FAILED", "the payer declined or the request failed"); continue; }
        if (Date.parse(t.expiresAt) < now) move(t, "EXPIRED", "the payer did not approve in time");
      } else if (t.state === "PAYING_OUT" && t.route === "direct" && t.payoutRail) {
        const agg = payoutsFor((t.to as MomoParty).provider).find((a) => a.name === t.payoutRail);
        const s = agg ? await agg.queryStatus(`pay_${t.id}`).catch(() => null) : null;
        if (s === "COMPLETED") await delivered(t, `payout confirmed by ${t.payoutRail}`);
        else if (s === "FAILED") { move(t, "REFUND_PENDING", "payout failed at the rail"); await refund(t); }
      }
    } catch (e) { console.error(`[momo-transfer] tick ${t.ref}:`, e instanceof Error ? e.message : e); }
  }
}

/** An operator releases a held transfer (compliance flags) — pays it out. */
export async function releaseTransfer(t: MomoTransfer, by: string): Promise<boolean> {
  if (t.state !== "REFUND_PENDING" || !t.complianceFlags?.length || t.refundRef) return false;
  move(t, "COLLECTED", `released by ${by}`);
  await startPayout(t);
  return true;
}
