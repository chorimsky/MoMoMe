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
import { collectorByName, selectCollector } from "../adapters/collect.js";
import * as ibex from "../adapters/ibex.js";
import { payoutsFor } from "../adapters/payouts.js";
import { selectFundedAggregator } from "./routing.js";
import { engine as compliance } from "./interop/compliance.js";
import { notify } from "./notifications.js";
import { btcUsd, usdXaf, ensureRatesFresh, ratesFresh } from "./rates.js";

const transfers = new Map<string, MomoTransfer>();
register("momo_transfers", () => [...transfers.values()].slice(-20_000), (d: MomoTransfer[]) => { for (const t of d ?? []) transfers.set(t.id, t); });

/** Our margin over the rails' own fees. Configuration, not a constant: this is the price of
 *  the money-in side and it must be changeable without a deploy (kept exported at its old
 *  name so nothing that reads it breaks). */
export const transferFeePct = (): number => {
  const v = getSettings().pricing.collectFeePct;
  return Number.isFinite(v) && v >= 0 && v < 1 ? v : 0.015;
};
/** The payer's approval window, from settings (Admin → Rails). Providers differ, and a
 *  prompt that outlives the customer standing at the till is worse than a clean expiry. */
const collectTtlMs = () => Math.max(1, getSettings().rails.collect.ttlMinutes || 15) * 60_000;

export function enabled(): boolean { return !!getSettings().features.momoTransfer; }
export function getTransfer(tid: string): MomoTransfer | undefined { return transfers.get(tid); }

/** A collection callback names OUR key; this settles that one transfer NOW rather than on
 *  the next reconcile tick. The rail's own `status()` is still what decides — a callback
 *  body is a hint that something changed, never the fact that it changed. Returns what the
 *  rail said, or null when the key is unknown to us (another deployment's, or a stale one).
 *  Safe to call repeatedly: every step re-reads the rail and `move()` is idempotent. */
export async function settleCollectionNow(transferId: string): Promise<"COMPLETED" | "FAILED" | "PENDING" | null> {
  const t = transfers.get(transferId);
  if (!t || t.state !== "AWAITING_PAYER") return null;
  const rail = collectorByName(t.collectRail);
  if (!rail) return null;
  const s = t.simulated ? "COMPLETED" : await rail.status(t.id).catch(() => null);
  if (s === "COMPLETED") { await onCollected(t); return "COMPLETED"; }
  if (s === "FAILED") { move(t, "FAILED", "the payer declined or the request failed"); return "FAILED"; }
  return s ?? null;
}
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
  const pct = transferFeePct();
  const feeXaf = Math.max(getSettings().pricing.minFeeXaf ?? 100, Math.round(xaf * pct));
  return { xaf, feeXaf, collectXaf: xaf + feeXaf, feePct: pct };
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
  // WHICH rail collects — decided before anything is created, because a corridor with no
  // collection rail, or an amount outside every rail's accepted range, must be refused here
  // rather than after the payer has been prompted.
  const pick = selectCollector({ provider: from.party.provider, country: from.party.country, xaf: q.collectXaf });
  if (!pick.rail) return { ok: false, status: 503, error: "collect_unavailable", message: "The payer's network cannot be charged right now. Please try again shortly." };
  const now = new Date().toISOString();
  const t: MomoTransfer = {
    id: id("mmt"), ref: ref(), createdAt: now, updatedAt: now, owner: input.owner,
    from: { ...from.party, ...(input.fromName ? { name: input.fromName } : {}) },
    to: { ...dest.to, ...(input.toName ? { name: input.toName } : {}) } as MomoTransfer["to"],
    route: dest.route, xaf: q.xaf, feeXaf: q.feeXaf, collectXaf: q.collectXaf,
    state: "AWAITING_PAYER", collectRail: pick.rail.name, expiresAt: new Date(Date.now() + collectTtlMs()).toISOString(),
    ...(screen.flags.length ? { complianceFlags: screen.flags } : {}),
    events: [{ at: now, state: "AWAITING_PAYER", note: `collecting ${q.collectXaf} XAF from ${from.party.provider} ${from.party.phone}` }],
  };
  // The collection request: a prompt on the payer's phone (or, on a hosted rail, a page for
  // them to complete). WHICH rail is the registry's decision — the operator's own API when it
  // is configured, an aggregator otherwise — and the chosen one is recorded on the transfer so
  // reconciliation asks the same rail that took the request.
  try {
    const res = await pick.rail.collect({ idempotencyKey: t.id, provider: t.from.provider, country: t.from.country, phone: t.from.phone, xaf: t.collectXaf, name: input.fromName ?? "MoMoMe transfer" });
    t.collectRef = res.providerRef; t.simulated = res.simulated;
    // A hosted rail answers with a PAGE, not a handset prompt. Carry it through, or the
    // payer sits waiting for a prompt that will never arrive until the request expires.
    if (res.paymentUrl) t.checkoutUrl = res.paymentUrl;
  } catch (e) {
    console.error(`[momo-transfer] collect request failed for ${t.ref} on ${pick.rail.name}:`, e instanceof Error ? e.message : e);
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
/** The payer's money arriving: into the clearing account, then our fee out of it. */
async function postCollection(t: MomoTransfer): Promise<void> {
  await store().recordTxn(t.id, [
    { account: "momo_collect_clearing", direction: "debit", amount: t.collectXaf, currency: "XAF" },
    { account: "customer_wallet", direction: "credit", amount: t.collectXaf, currency: "XAF" },
  ]);
  await store().recordTxn(t.id, [
    { account: "customer_wallet", direction: "debit", amount: t.feeXaf, currency: "XAF" },
    { account: "fee_revenue", direction: "credit", amount: t.feeXaf, currency: "XAF" },
  ]);
}

async function onCollected(t: MomoTransfer): Promise<void> {
  move(t, "COLLECTED", `${t.collectXaf} XAF collected from the payer`);
  await postCollection(t);
  if (t.complianceFlags?.length) { move(t, "HELD", `held for compliance review: ${t.complianceFlags.join("; ")} — an operator releases or refunds`); return; }
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
      // The value legs for this route are complete: the wallet paid the FX position in XAF
      // and the FX position paid the recipient in BTC. `delivered` must NOT post again.
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
    if (res.simulated) { await postDirectDelivery(t); await delivered(t, "simulated payout (sandbox)"); }
  } catch (e) {
    move(t, "REFUND_PENDING", `payout refused: ${e instanceof Error ? e.message : "error"}`);
    await refund(t);
  }
}

/** The recipient's value leg for a DIRECT payout: XAF leaves the wallet for the recipient.
 *
 *  This used to live inside `delivered()`, which every route called — so the Lightning route,
 *  which has already posted its own legs (wallet → fx_position in XAF, fx_position →
 *  recipient in BTC), posted the recipient a SECOND time in XAF. Each recordTxn balances on
 *  its own, so the per-transaction check stayed green while `customer_wallet` went negative
 *  by the full amount and `external_recipient` was credited once in XAF and once in BTC for
 *  one transfer. Posting belongs to the route that knows what moved. */
async function postDirectDelivery(t: MomoTransfer): Promise<void> {
  await store().recordTxn(t.id, [
    { account: "customer_wallet", direction: "debit", amount: t.xaf, currency: "XAF" },
    { account: "external_recipient", direction: "credit", amount: t.xaf, currency: "XAF" },
  ]);
}

/** State and notifications only. The value legs are the route's business. */
async function delivered(t: MomoTransfer, note: string): Promise<void> {
  move(t, "DELIVERED", note);
  const toLabel = "phone" in t.to ? `${COUNTRIES[t.to.country].dial} ${t.to.phone} (${t.to.provider})` : t.to.lightningAddress;
  await notify({ kind: "transfer_delivered", audience: "sender", to: `${COUNTRIES[t.from.country].dial.replace(/\D/g, "")}${t.from.phone}`, body: `Your transfer ${t.ref} of ${t.xaf} XAF to ${toLabel} has been delivered.`, paymentRef: t.ref }).catch(() => {});
  if ("phone" in t.to) await notify({ kind: "transfer_delivered", audience: "recipient", to: `${COUNTRIES[t.to.country].dial.replace(/\D/g, "")}${t.to.phone}`, body: `You received ${t.xaf} XAF on your ${t.to.provider} number via MoMo›Me (${t.ref}).`, paymentRef: t.ref }).catch(() => {});
}

/* ---------- refunds ----------
   A refund is a payout like any other, and it was the one payout here that was neither
   retried nor confirmed. The old version tried once: if no rail was funded, or if disburse
   threw, it logged, notified an operator and returned — leaving the transfer in
   REFUND_PENDING, which the reconcile tick did not look at, so a rail that was down for a
   minute stranded the payer's money permanently with nothing but a log line. And when
   disburse DID succeed it moved straight to REFUNDED and posted the reversal, although
   "accepted" means the rail took the request, not that the payer got their money back.

   Now REFUND_PENDING means exactly "we owe this payer and it is not confirmed back yet":
   the tick submits it if it has not been submitted, and only the rail's own COMPLETED
   moves it to REFUNDED and posts the reversal. */
const REFUND_MAX_ATTEMPTS = 20;
/** How long after a request lapses we keep asking the rail whether the payer paid anyway. */
const LATE_APPROVAL_GRACE_MS = 24 * 60 * 60_000;

/** Submit (or re-submit) the refund. Idempotent at the rail on `refund_<id>`. */
async function refund(t: MomoTransfer): Promise<void> {
  t.refundAttempts = (t.refundAttempts ?? 0) + 1;
  const first = t.refundAttempts === 1;
  const agg = await selectFundedAggregator(t.from.provider, t.from.country, t.collectXaf, liveMoney()).catch(() => null);
  if (!agg) {
    console.error(`[momo-transfer] ${t.ref} refund attempt ${t.refundAttempts}: no funded rail for ${t.from.provider} — will retry`);
    if (first) await notify({ kind: "transfer_failed", audience: "operator", body: `Transfer ${t.ref}: ${t.collectXaf} XAF collected from ${t.from.phone} could not be paid out, and no funded rail could refund it yet. Retrying automatically.` }).catch(() => {});
    touch("momo_transfers");
    return;
  }
  try {
    const res = await agg.disburse({ idempotencyKey: `refund_${t.id}`, provider: t.from.provider, country: t.from.country, phone: t.from.phone, xaf: t.collectXaf, name: t.from.name ?? "MoMoMe refund" });
    t.refundRail = agg.name; t.refundRef = res.providerRef;
    t.events.push({ at: new Date().toISOString(), state: "REFUND_PENDING", note: `refund of ${t.collectXaf} XAF submitted to ${agg.name}` });
    touch("momo_transfers");
    // A sandbox rail has no record to confirm against: its acceptance IS the settlement.
    if (res.simulated) await refunded(t, `${t.collectXaf} XAF returned to the payer via ${agg.name} (simulated)`);
    else await confirmRefund(t);
    // Tell the payer as soon as the refund is on its way, not only once it lands.
    await notify({ kind: "transfer_failed", audience: "sender", to: `${COUNTRIES[t.from.country].dial.replace(/\D/g, "")}${t.from.phone}`, body: `Transfer ${t.ref} could not be delivered. ${t.collectXaf} XAF is being returned to your number.`, paymentRef: t.ref }).catch(() => {});
  } catch (e) {
    console.error(`[momo-transfer] ${t.ref} refund attempt ${t.refundAttempts} failed:`, e instanceof Error ? e.message : e);
    if (first) await notify({ kind: "transfer_failed", audience: "operator", body: `Transfer ${t.ref}: refund of ${t.collectXaf} XAF to ${t.from.phone} was refused by the rail. Retrying automatically.` }).catch(() => {});
    touch("momo_transfers");
  }
}

/** Ask the rail that took the refund whether the payer actually has the money back. */
async function confirmRefund(t: MomoTransfer): Promise<void> {
  const agg = payoutsFor(t.from.provider).find((a) => a.name === t.refundRail);
  const s = agg ? await agg.queryStatus(`refund_${t.id}`).catch(() => null) : null;
  if (s === "COMPLETED") { await refunded(t, `${t.collectXaf} XAF returned to the payer via ${t.refundRail}`); return; }
  // Refused at the rail: forget the submission so the next tick submits a fresh one.
  if (s === "FAILED") { delete t.refundRef; delete t.refundRail; touch("momo_transfers"); }
}

/** The reversal, posted ONCE, when the payer's money is confirmed back with them. */
async function refunded(t: MomoTransfer, note: string): Promise<void> {
  // A reconcile tick and an operator's "retry refund" can both land on the same transfer.
  // The rail is idempotent on `refund_<id>`, so neither pays the payer twice — but the
  // reversal must not be BOOKED twice either.
  if (t.state === "REFUNDED") return;
  // Reverse the fee: a failed transfer costs the payer nothing.
  await store().recordTxn(t.id, [
    { account: "fee_revenue", direction: "debit", amount: t.feeXaf, currency: "XAF" },
    { account: "customer_wallet", direction: "credit", amount: t.feeXaf, currency: "XAF" },
  ]);
  await store().recordTxn(t.id, [
    { account: "customer_wallet", direction: "debit", amount: t.collectXaf, currency: "XAF" },
    { account: "external_recipient", direction: "credit", amount: t.collectXaf, currency: "XAF" },
  ]);
  move(t, "REFUNDED", note);
}

/** An operator's "retry refund" on a transfer whose automatic retries gave up. */
export async function retryRefund(t: MomoTransfer, by: string): Promise<boolean> {
  if (t.state !== "REFUND_PENDING") return false;
  t.refundAttempts = 0;
  t.events.push({ at: new Date().toISOString(), state: "REFUND_PENDING", note: `refund retried by ${by}` });
  if (t.refundRef) await confirmRefund(t); else await refund(t);
  return true;
}

/** Called each reconcile tick: collections that completed, payouts that settled, requests
 *  that lapsed. Idempotent — every step re-reads the rail's word before moving. */
export async function reconcileTransfers(now = Date.now()): Promise<void> {
  for (const t of transfers.values()) {
    try {
      if (t.state === "AWAITING_PAYER") {
        // Ask the rail that TOOK the request — not whichever one happens to be first now.
        const rail = collectorByName(t.collectRail);
        const s = t.simulated ? "COMPLETED" : rail ? await rail.status(t.id).catch(() => null) : null;
        if (s === "COMPLETED") { await onCollected(t); continue; }
        if (s === "FAILED") { move(t, "FAILED", "the payer declined or the request failed"); continue; }
        if (Date.parse(t.expiresAt) < now) move(t, "EXPIRED", "the payer did not approve in time");
      } else if (t.state === "EXPIRED" && !t.simulated && Date.parse(t.expiresAt) > now - LATE_APPROVAL_GRACE_MS) {
        /* A LATE APPROVAL. Our window and the rail's need not be the same, and a payer who
           approves a minute after we gave up is debited all the same. Nothing used to look
           at EXPIRED again, so that money stayed in the collection account: taken from the
           payer, never delivered, never returned, and invisible because the transfer read
           "nothing was taken". We keep asking for a day, and if the rail says the payer paid,
           we book it and give it straight back — the payer was told the request lapsed, the
           liquidity check that guarded the payout is long stale, and returning it is the
           only outcome that matches what they were told. */
        const rail = collectorByName(t.collectRail);
        const s = rail ? await rail.status(t.id).catch(() => null) : null;
        if (s === "COMPLETED") {
          move(t, "REFUND_PENDING", `the payer approved after the request expired — ${t.collectXaf} XAF was collected and is being returned`);
          await postCollection(t);
          await refund(t);
        }
      } else if (t.state === "PAYING_OUT" && t.route === "direct" && t.payoutRail) {
        const agg = payoutsFor((t.to as MomoParty).provider).find((a) => a.name === t.payoutRail);
        const s = agg ? await agg.queryStatus(`pay_${t.id}`).catch(() => null) : null;
        if (s === "COMPLETED") { await postDirectDelivery(t); await delivered(t, `payout confirmed by ${t.payoutRail}`); }
        else if (s === "FAILED") { move(t, "REFUND_PENDING", "payout failed at the rail"); await refund(t); }
      } else if (t.state === "REFUND_PENDING") {
        // Money we hold that belongs to the payer. Nothing used to look at this state, so a
        // refund that could not be submitted stayed here forever.
        if (t.refundRef) await confirmRefund(t);
        else if ((t.refundAttempts ?? 0) < REFUND_MAX_ATTEMPTS) await refund(t);
        else if (t.refundAttempts === REFUND_MAX_ATTEMPTS) {
          // Stop the loop, but stay in REFUND_PENDING: the debt is real and must stay
          // visible. An operator retries it from the console.
          t.refundAttempts++;
          t.events.push({ at: new Date().toISOString(), state: "REFUND_PENDING", note: `automatic refund gave up after ${REFUND_MAX_ATTEMPTS} attempts — an operator must retry or pay it by hand` });
          touch("momo_transfers");
          await notify({ kind: "transfer_failed", audience: "operator", body: `Transfer ${t.ref}: ${t.collectXaf} XAF is still owed to ${t.from.phone} after ${REFUND_MAX_ATTEMPTS} automatic refund attempts. Retry it in Admin → Mobile Money, or refund by hand.` }).catch(() => {});
        }
      }
    } catch (e) { console.error(`[momo-transfer] tick ${t.ref}:`, e instanceof Error ? e.message : e); }
  }
}

/** An operator releases a held transfer (compliance flags) — pays it out. */
export async function releaseTransfer(t: MomoTransfer, by: string): Promise<boolean> {
  if (t.state !== "HELD") return false;
  move(t, "COLLECTED", `released by ${by}`);
  await startPayout(t);
  return true;
}
/** An operator refunds a held transfer instead of releasing it. */
export async function refundHeldTransfer(t: MomoTransfer, by: string): Promise<boolean> {
  if (t.state !== "HELD") return false;
  move(t, "REFUND_PENDING", `refund decided by ${by}`);
  await refund(t);
  return true;
}
