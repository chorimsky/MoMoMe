/* ============================================================
   Payment lifecycle state machine (BACKEND_DESIGN §1)
   Drives a payment from confirmed inbound to delivered Mobile Money,
   writing balanced ledger entries and paying out exactly once.

   Two entry points, one money path:
   - sandbox `settle()` simulates rail latency with timers
   - live webhooks call markDetected() / confirmInbound() directly
   Both converge on confirmInbound(), which is idempotent.
   ============================================================ */
import type { Payment, PaymentState, DisplayStatus } from "../../../shared/types.js";
import { store } from "../db/store.js";
import { PROVIDER_PAYOUT_MAX, XAF_FLOAT_MAX, btcToMsat } from "../../../shared/domain.js";
import { isLive, aggregatorLive } from "../config.js";
import { railTrusted, confirmSettlement, adapterByName, payRefund, refundStatus } from "../adapters/index.js";
import { selectAggregator, selectFundedAggregator, aggregatorByName, aggregatorFloatXaf, balanceReasons, recordExecution, markRailHardDown } from "./routing.js";
import { recordSuccessfulPayout, payoutBlocked } from "./merchant.js";
import { ensureIdentity } from "./identity.js";
import { getSettings, refreshSettingsIfStale } from "./settings.js";
import type { PayoutStatus } from "../adapters/pawapay.js";
import { bolt11AmountMsat } from "./bolt11.js";
import { rateFor } from "./fx.js";
import { ratesFresh, ensureRatesFresh } from "./rates.js";

/** Live queryable XAF across funded aggregators, briefly cached so the payment hot
 *  path (every /payments pre-flight + every confirmInbound) doesn't issue a balance
 *  RPC to each provider on every call. NaN when no rail can be queried. */
let floatCache: { xaf: number; at: number } | null = null;
const FLOAT_CACHE_MS = Number(process.env.FLOAT_CACHE_MS ?? 8_000);
// A confirmed on-chain/stablecoin inbound materially larger than invoiced isn't the
// quoted deal (a fat-finger over-send, or an AML-relevant unexpected deposit) — hold
// for review instead of auto-delivering a windfall. 15% over covers wallet rounding
// / dust while catching 2×+ mistakes. Underpayment uses the mirror band (0.999).
const OVERPAY_TOLERANCE = Number(process.env.OVERPAY_TOLERANCE ?? 1.15);
/** SINGLE-FLIGHT refresh. The cache alone does NOT bound upstream load: on a miss,
 *  every concurrent caller used to launch its OWN aggregatorFloatXaf(), and each of those
 *  hits EVERY configured rail's balance API (Peexit alone = /disbursement/me +
 *  /collection/me). A burst of 10 payment creations therefore became ~20 simultaneous
 *  balance RPCs — on the user-facing critical path of POST /payments, which is why
 *  sequential creation stayed ~0.8s while a concurrent burst timed out: the rail throttles,
 *  every call rides fetchT's 12s ceiling, and the requests pile up. Sharing one in-flight
 *  refresh collapses that back to a single upstream round trip.
 *  This changes NO value any caller observes — a joiner gets exactly the number the
 *  refresh it joined produces, so the float/payout guards are untouched. */
let floatInflight: Promise<number> | null = null;
async function liveAggregatorXaf(): Promise<number> {
  if (floatCache && Date.now() - floatCache.at < FLOAT_CACHE_MS) return floatCache.xaf;
  if (floatInflight) return floatInflight; // a refresh is already running — join it
  const run = (async () => {
    let live = NaN;
    try {
      live = await aggregatorFloatXaf(); // sum of funded-aggregator balances (NaN = none queryable)
    } catch (e) {
      console.error("[treasury] balance query failed — falling back to XAF_FLOAT_MAX", e);
    }
    floatCache = { xaf: live, at: Date.now() };
    return live;
  })();
  floatInflight = run;
  void run.catch(() => {}).then(() => { if (floatInflight === run) floatInflight = null; });
  return run;
}

/** Available XAF payout float. Two accounting regimes:
 *   • LIVE rails queryable → the aggregator wallet balance is TODAY's real capacity and
 *     ALREADY nets out every delivered payout (money that left the rail). So we subtract
 *     only what's currently RESERVED in-flight (payout_float_XAF, ≤ 0) — NOT the all-time
 *     external_recipient delta, which would double-count deliveries and drift the float
 *     permanently negative. Capped by XAF_FLOAT_MAX so a spoofed/oversized balance can't
 *     authorize unlimited payout.
 *   • No queryable rail (sandbox/tests, or a total balance-API outage) → a static EXPOSURE
 *     ceiling: XAF_FLOAT_MAX − in-flight reserved (payout_float_XAF, a negative credit).
 *     All-time delivered is NOT subtracted — see the note at the fallback for why that
 *     term bricked production.
 *  Each payment reserves at FX-lock BEFORE this is read, so concurrent settlements can't
 *  all see the full float and over-commit the treasury. */
/** How the last availableFloatXaf() figure was arrived at — a live rail balance, or the
 *  static-ceiling fallback and why. Logged with the refusal so the number is explicable. */
let floatBasis = "not yet computed";
export function floatBasisNote(): string { return floatBasis; }

export async function availableFloatXaf(): Promise<number> {
  const s = store();
  const reserved = await s.balance("payout_float_XAF", "XAF"); // in-flight reservation (≤ 0)
  const live = await liveAggregatorXaf();
  // A KNOWN balance is authoritative — including zero. The guard used to be `live > 0`, so a
  // rail that truthfully answered "0 XAF" was treated exactly like a rail that could not be
  // reached, and fell through to the constant-treasury fallback below. On a long-lived
  // deployment that fallback subtracts every delivery ever made from a static ceiling, so an
  // unfunded rail produced a large NEGATIVE float (-423,041 XAF in production) and blocked
  // payouts with a number that describes nothing real. Both paths refuse the payout — but
  // one says "the rail is empty, fund it" and the other invents an accounting figure that
  // sends you looking for a bug in the ledger.
  if (Number.isFinite(live)) {
    floatBasis = `live rail balance ${live} XAF`;
    if (live <= 0) {
      console.error(`[treasury] payout rail balance is ${live} XAF — payouts are blocked because the rail is UNFUNDED, not because the treasury ceiling is exhausted.`);
    }
    return Math.min(live, XAF_FLOAT_MAX) + reserved;
  }
  // Balance genuinely UNKNOWN (no rail could answer) → fall back to the static EXPOSURE
  // ceiling: how much we are willing to have committed at once, less what is committed now.
  //
  // This deliberately does NOT subtract external_recipient (all-time delivered). That term
  // made the fallback a ONE-WAY RATCHET: the account is only ever credited (settle() posts a
  // delivery leg, nothing ever posts back), and no top-up path exists anywhere in the
  // codebase, so the figure could only descend. Production reached -423,041 XAF and refused
  // EVERY payment — not because any treasury was short, but because ~200,000,000 XAF of
  // *simulated* sandbox payouts had eaten a ceiling denominated in real money. A number that
  // can only fall, cannot be replenished, and counts fake money against real capacity is not
  // a balance; it is a countdown to a permanently bricked platform.
  //
  // The LIVE branch above already excludes this term, for the same stated reason ("would
  // double-count deliveries and drift the float permanently negative"). The fallback now
  // matches it: capacity minus in-flight, refreshed as payouts settle. Money that already
  // left is gone — it neither adds to nor subtracts from what we can commit next.
  floatBasis = `NO rail balance available (${balanceReasons().join("; ") || "no rails"}) → static exposure ceiling ${XAF_FLOAT_MAX} less in-flight ${-reserved}. This is a commitment cap, NOT a measured balance.`;
  return XAF_FLOAT_MAX + reserved;
}

/** True once the inbound has been booked to the ledger (the INBOUND_CONFIRMED
 *  transition ran). This is the correct idempotency signal — NOT a rank() check:
 *  the off-sequence hold/terminal states (MANUAL_REVIEW / REFUND_PENDING /
 *  REFUNDED / FAILED) all map to rank -1, so a `rank(state) >= INBOUND_CONFIRMED`
 *  guard was FALSE for them and let an at-least-once duplicate settled webhook
 *  re-drive the entire settlement on a held payment — double-posting the ledger,
 *  double-reserving float, double-counting the fee, and potentially firing a
 *  second payout or abandoning an in-flight refund. A payment that expired at
 *  AWAITING_INBOUND and only later truly paid has no INBOUND_CONFIRMED event, so
 *  the reconcile recovery path (reconcileStuckInbounds → confirmInbound on FAILED)
 *  still works. */
const inboundBooked = (p: Payment) => p.events.some((e) => e.state === "INBOUND_CONFIRMED");

const DISPLAY: Partial<Record<PaymentState, DisplayStatus>> = {
  DELIVERED: "Completed",
  PAYOUT_CONFIRMED: "Completed",
  FAILED: "Failed",
  REFUNDED: "Failed",
  MANUAL_REVIEW: "Pending",
};

async function transition(p: Payment, state: PaymentState, note?: string): Promise<void> {
  p.state = state;
  p.displayStatus = DISPLAY[state] ?? "Pending";
  p.updatedAt = new Date().toISOString();
  p.events.push({ at: p.updatedAt, state, note });
  await store().putPayment(p);
  // Observability: the settlement happy path is otherwise silent, which makes a
  // held/stuck payout impossible to diagnose from logs. Surface the money-critical
  // transitions (every reason a payout holds is carried in `note`).
  if (["INBOUND_CONFIRMED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED", "MANUAL_REVIEW", "FAILED", "REFUNDED"].includes(state)) {
    console.log(`[settle] ${p.ref} → ${state}${note ? ` · ${note}` : ""} (xaf=${p.xaf}${p.aggregator ? `, agg=${p.aggregator}` : ""})`);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Provider failures that won't fix themselves on retry (account/config blocks like
 *  PawaPay's PAYOUTS_NOT_ALLOWED). These take the rail down and refund immediately. */
const HARD_PAYOUT_FAIL = /not[_ ]?allowed|not[_ ]?configured|payouts?_not_allowed/i;

/** Submit a payout, auto-retrying TRANSIENT failures (network/5xx) up to 3 times.
 *  A HARD failure (config block) throws immediately — retrying is futile. disburse is
 *  idempotent on the ref, so a retry never double-pays. */
async function submitWithRetry(agg: ReturnType<typeof aggregatorByName>, p: Payment) {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await agg.disburse({ idempotencyKey: p.ref, provider: p.recipient.provider, country: p.recipient.country, phone: p.recipient.phone, xaf: p.xaf, name: p.recipient.name });
    } catch (e) {
      lastErr = e;
      if (HARD_PAYOUT_FAIL.test(e instanceof Error ? e.message : "")) throw e; // config block — stop
      if (attempt < 2) await wait(1500 * (attempt + 1)); // transient — back off and retry
    }
  }
  throw lastErr;
}

/** Terminal-but-recoverable: inbound crypto arrived but the payout can't land. Move to
 *  REFUND_PENDING and flag that the sender must supply a refund destination — the crypto
 *  is held until refunded. Replaces the old MANUAL_REVIEW limbo with a clear "we owe a
 *  refund" state. (Ledger is NOT reversed here — we still hold the inbound asset; it's
 *  unwound when the refund is actually paid out — the refund-claim flow.) */
async function beginRefund(p: Payment, note: string): Promise<void> {
  // Only Lightning has an automated refund-claim path (the sender supplies a bolt11
  // and we pay it). On-chain BTC / ERC-20 stablecoin inbounds have NO auto path —
  // completeRefund rejects them (refund_lightning_only), so they used to strand
  // permanently in REFUND_PENDING. Route them to MANUAL_REVIEW so an operator returns
  // the crypto out-of-band and then adminRefund reverses the ledger.
  if (p.payInstruction.method !== "LIGHTNING") {
    await transition(p, "MANUAL_REVIEW", `${note} — ${p.payInstruction.method} inbound needs a manual crypto refund`);
    return;
  }
  p.refundNeedsDestination = true;
  await transition(p, "REFUND_PENDING", note);
}

/** Inbound seen in mempool / HTLC held. Idempotent, only moves forward. Only an
 *  as-yet-unseen inbound (still AWAITING_INBOUND) advances to DETECTED — guarding by
 *  state, not rank(), so a stray "detected" webhook can't resurrect a held/terminal
 *  payment (whose rank is -1) back to INBOUND_DETECTED. */
export async function markDetected(p: Payment): Promise<void> {
  if (p.state !== "AWAITING_INBOUND") return;
  await transition(p, "INBOUND_DETECTED");
}

/**
 * The money path: inbound confirmed → FX lock → exactly-once payout → delivered.
 * Idempotent — safe to call from a re-delivered webhook. `actualAmount` (asset
 * units) lets us guard against underpayment before paying out.
 */
export async function confirmInbound(pIn: Payment, actualAmount?: number, eventId?: string, matchedRef?: string): Promise<void> {
  // Serialize per payment across instances (Postgres advisory lock / memory mutex): the
  // whole book-and-pay critical section runs once. A racing second delivery (at-least-once
  // webhooks) re-reads inside the lock, sees the booking below, and aborts — closing the
  // double-settle → double real-payout hole (memory's shared-object serialization the tests
  // rely on does NOT hold on Postgres, where each call gets an independent copy).
  return store().lockPayment(pIn.id, () => confirmInboundLocked(pIn.id, actualAmount, eventId, matchedRef));
}
async function confirmInboundLocked(paymentId: string, actualAmount?: number, eventId?: string, matchedRef?: string): Promise<void> {
  await refreshSettingsIfStale(); // payout-approval threshold / kill-switch fresh across instances
  const p = await store().getPayment(paymentId); // fresh read under the lock
  if (!p) return;
  // Has this exact deposit already been processed? A rail redelivers webhooks freely, so a
  // repeat of the SAME deposit must be ignored — that is what the seen-list is for.
  const seen = p.inboundEventIds ?? [];
  if (eventId && seen.includes(eventId)) return; // true replay of a deposit already handled

  if (inboundBooked(p)) {
    // The payment has already settled. Two very different things land here:
    //
    //  (a) a redelivered webhook for the deposit we already booked — ignore it; and with
    //      no eventId to tell it apart, that is the only safe assumption (the old
    //      behaviour, kept for rails that cannot supply one).
    //  (b) a genuinely NEW deposit — the sender paid twice, or paid an address again after
    //      it had settled. That is real money arriving for an order already filled.
    //
    // (b) used to take the same silent `return` as (a): the crypto was received, never
    // credited, never refunded, never even recorded. Delivering again is not the answer
    // either — the recipient was already paid once. So book it as a LIABILITY we owe back
    // and say so on the payment, where an operator can act on it.
    if (!eventId) return; // (a) — nothing to tell this apart by, so assume a replay
    const amount = actualAmount;
    p.inboundEventIds = [...seen, eventId];
    const note = amount != null
      ? `duplicate inbound: ${amount} ${p.payInstruction.asset} received after this payment already settled — refund owed to the sender`
      : `duplicate inbound received after this payment already settled (amount unverified) — refund owed to the sender`;
    // The payment itself STAYS as it is: the order really was delivered. What is new is a
    // debt, so it is recorded as one rather than by rewriting history.
    p.events.push({ at: new Date().toISOString(), state: p.state, note });
    p.updatedAt = new Date().toISOString();
    await store().putPayment(p);
    if (amount != null && amount > 0) {
      await store().recordTxn(p.id, [
        { account: "inbound_clearing", direction: "debit", amount, currency: p.payInstruction.asset },
        { account: "refund_payable", direction: "credit", amount, currency: p.payInstruction.asset },
      ]);
    }
    console.error(`[settle] ${p.ref} DUPLICATE INBOUND — ${note}`);
    return;
  }
  // Compare against the amount LOCKED at quote time (carried on the instruction),
  // never a freshly-recomputed rate — spot drifts, and the customer paid the locked
  // invoice amount. Recomputing here would falsely trip the guard on a good payment.
  // WHICH LEG WAS PAID. A unified BIP-21 QR offers two ways to pay one payment, and they
  // settle under different rules — Lightning is full-or-nothing and keeps its lock, on-chain
  // can be partial and is re-priced on confirmation. Keying any of that off
  // payInstruction.method would apply the on-chain rules to a Lightning payment (and hold
  // it for a "stale FX feed" it never needed). The ref the webhook matched is what actually
  // says which leg the money came in on.
  const leg = matchedRef && p.payInstruction.alt?.providerRef === matchedRef
    ? p.payInstruction.alt
    : p.payInstruction;
  const paidMethod = leg.method;
  const asset = leg.asset;
  const expected = leg.amount;

  // Remember which deposit this was, so a redelivery is recognised and a genuinely NEW
  // deposit is not. When the caller has no deposit id — the reconcile backstop and the
  // on-demand poll both settle from an authoritative re-query rather than a webhook — fall
  // back to the PAID LEG'S providerRef. For Lightning, the only method either of those
  // paths handles, providerRef IS the rail's transaction id, so the webhook that arrives
  // later for the same payment matches and is correctly ignored.
  //
  // Seeding this matters: leaving the list empty meant a payment settled by the backstop
  // had nothing to compare against, so a later REAL second deposit looked indistinguishable
  // from a replay and was silently kept — the exact hole this guard exists to close.
  p.inboundEventIds = [...seen, eventId ?? leg.providerRef ?? p.payInstruction.providerRef ?? "settled"];

  // Lightning invoices settle in full or not at all — a confirmed LN webhook
  // means the locked amount arrived, so we credit the locked amount and never
  // depend on the webhook's amount/units. On-chain can be partial, so verify
  // the (correctly-scaled) received amount against the lock.
  let received: number;
  if (paidMethod === "LIGHTNING") {
    received = expected;
  } else {
    // A confirmed inbound with no verified amount is untrusted — hold for review.
    if (actualAmount == null) {
      await transition(p, "MANUAL_REVIEW", "inbound amount unverified");
      return;
    }
    received = actualAmount;
    // Underpayment guard: never auto-pay a short inbound (BACKEND_DESIGN §1).
    if (received < expected * 0.999) {
      await transition(p, "MANUAL_REVIEW", `underpaid: got ${received}, expected ${expected}`);
      return;
    }
    // Overpayment guard (symmetry): a materially larger inbound than invoiced isn't
    // the quoted deal — it's backed by received crypto so it's not a platform loss,
    // but auto-delivering a windfall (or an unexpected large deposit) must be reviewed,
    // not settled silently. Holds a 2× fat-finger; passes normal wallet rounding.
    if (received > expected * OVERPAY_TOLERANCE) {
      await transition(p, "MANUAL_REVIEW", `overpaid: got ${received}, expected ${expected}`);
      return;
    }
  }

  await transition(p, "INBOUND_CONFIRMED");
  await store().recordTxn(p.id, [
    { account: "inbound_clearing", direction: "debit", amount: received, currency: asset },
    { account: "customer_wallet", direction: "credit", amount: received, currency: asset },
  ]);

  // RE-PRICE (on-chain only). The quote was issued `estimateOnly` precisely because a
  // 10–60 minute confirmation window can't honour a locked rate — BACKEND_DESIGN §3's
  // re-quote model. Convert what ACTUALLY arrived at the CURRENT rate, and keep the
  // fee as the same proportion of the total the customer agreed to. Fast rails
  // (Lightning / USDT) keep their lock: their exposure is seconds, which is what the
  // tighter 150bp spread already pays for.
  if (paidMethod === "ONCHAIN") {
    // PULL a rate before judging the feed stale. Settlement happens 10-60 minutes after the
    // quote, and on serverless nothing refreshes FX in between (no poller; Hobby cron is
    // daily) — so this check used to be false essentially always, holding every on-chain
    // payment for review AFTER the customer's crypto had been booked.
    await ensureRatesFresh();
    // No fresh rate = no honest price. Holding is the only safe move: booking the
    // stale lock is the bug we're fixing, and guessing is worse. (ratesFresh() is also
    // false on a divergent two-source feed — see F4 — so a manipulated feed holds too.)
    if (!ratesFresh()) {
      await transition(p, "MANUAL_REVIEW", "on-chain re-price blocked — FX feed not fresh");
      return;
    }
    const rq = rateFor(p.method);
    const grossXaf = Math.round(received * rq.customerXafPerUnit);
    // Preserve the agreed fee RATIO rather than re-deriving from settings — the
    // customer accepted this proportion at quote time, and settings may have moved.
    const feeRatio = p.totalXaf > 0 ? p.feeXaf / p.totalXaf : 0;
    const feeXaf = Math.round(grossXaf * feeRatio);
    const xaf = grossXaf - feeXaf;
    if (xaf <= 0) {
      await transition(p, "MANUAL_REVIEW", `re-price left nothing deliverable (gross ${grossXaf} XAF)`);
      return;
    }
    if (xaf !== p.xaf) {
      await transition(p, "FX_LOCKED", `re-priced on confirmation: ${p.xaf} → ${xaf} XAF (rate ${Math.round(rq.customerXafPerUnit)})`);
      p.repricedFromXaf = p.xaf; // the originally-quoted amount, for a "Quoted → Delivered" receipt line
      p.xaf = xaf; p.feeXaf = feeXaf; p.totalXaf = grossXaf;
      await store().putPayment(p);
    }
  }

  // FX lock: asset → XAF, reserve float, take fee.
  await transition(p, "FX_LOCKED");
  await store().recordTxn(p.id, [
    { account: "customer_wallet", direction: "debit", amount: received, currency: asset },
    { account: "fx_position", direction: "credit", amount: received, currency: asset },
  ]);
  await store().recordTxn(p.id, [
    { account: "fx_position", direction: "debit", amount: p.totalXaf, currency: "XAF" },
    { account: "payout_float_XAF", direction: "credit", amount: p.xaf, currency: "XAF" },
    { account: "fee_revenue", direction: "credit", amount: p.feeXaf, currency: "XAF" },
  ]);

  // Pre-payout guards: corridor limit + available float.
  if (p.xaf > PROVIDER_PAYOUT_MAX[p.recipient.provider]) {
    await transition(p, "MANUAL_REVIEW", `exceeds ${p.recipient.provider} payout limit`);
    return;
  }
  // availableFloatXaf() already includes THIS payment's FX-lock reservation, so a
  // negative result means the treasury is over-committed across all delivered +
  // in-flight payouts — hold this marginal payment rather than over-draw real money.
  if ((await availableFloatXaf()) < 0) {
    await transition(p, "MANUAL_REVIEW", "insufficient XAF float");
    return;
  }
  // Operator approval threshold: large payouts hold for manual sign-off.
  if (p.xaf >= getSettings().ops.payoutApprovalXaf) {
    await transition(p, "MANUAL_REVIEW", `above approval threshold (${getSettings().ops.payoutApprovalXaf.toLocaleString()} XAF)`);
    return;
  }
  // Trust gate: a flagged / very-low-trust merchant needs manual confirmation.
  if (payoutBlocked(p.recipient.phone)) {
    await transition(p, "MANUAL_REVIEW", "low-trust merchant — manual confirmation required");
    return;
  }

  // Is THIS payment's crypto inbound real money? Real = a settled IBEX inbound
  // (production, or sandbox when IBEX_ALLOW_SANDBOX_PAYOUT is set — sandbox LN
  // invoices take real mainnet sats). A simulated inbound (provider "sandbox",
  // e.g. USDT) is not.
  const cryptoReal = railTrusted(p.payInstruction.provider);

  // Route to a FUNDED aggregator (PawaPay / Peexit) — the API with wallet balance
  // picks up the payout. For real money, require a LIVE rail so a sandbox-configured
  // aggregator can never simulate a payout and falsely "deliver" a real payment.
  const agg = await selectFundedAggregator(p.recipient.provider, p.recipient.country, p.xaf, cryptoReal);
  if (!agg) {
    await transition(p, "MANUAL_REVIEW", cryptoReal
      ? "no funded LIVE payout rail — real settlement held for review"
      : "no payout aggregator with sufficient balance");
    return;
  }
  // SAFETY: never move REAL Mobile Money funds for a simulated inbound (a live rail
  // paired with non-real crypto). The selection above already guarantees the
  // converse — real crypto only ever routes to a live rail.
  if (aggregatorLive(agg.name) && !cryptoReal) {
    await transition(p, "MANUAL_REVIEW", "live payout blocked — crypto inbound is not real");
    return;
  }
  p.aggregator = agg.name;

  // SUBMIT the payout — exactly once, keyed on the payment ref. Transient failures
  // auto-retry; a HARD provider block (e.g. PAYOUTS_NOT_ALLOWED) takes the rail out
  // of rotation and goes straight to refund — retrying a config block is futile.
  await transition(p, "PAYOUT_REQUESTED");
  let res;
  try {
    res = await submitWithRetry(agg, p);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    if (HARD_PAYOUT_FAIL.test(msg)) markRailHardDown(agg.name, msg);
    await beginRefund(p, `payout failed${HARD_PAYOUT_FAIL.test(msg) ? " (rail blocked)" : ""}: ${msg}`);
    return;
  }
  if (res.status === "duplicate") {
    await transition(p, "MANUAL_REVIEW", "duplicate payout key");
    return;
  }
  p.payoutRef = res.providerRef;
  await store().putPayment(p);

  // CONFIRMATION is async. Real payout: settle on the FIRST of — the provider's
  // /webhooks/{aggregator} callback, this active status poll, or the slower
  // reconcile backstop. All idempotent. Simulated: fake the callback inline.
  if (!res.simulated) { void pollPayout(p.ref); return; }
  await wait(900);
  await onPayoutResultLocked(p.ref, "COMPLETED", res.providerRef); // lock already held
}

/** Actively poll a real payout's status for fast settlement when the dashboard
 *  callback isn't (yet) configured. Stops the moment the payment leaves
 *  PAYOUT_REQUESTED (e.g. a callback already settled it). Idempotent. */
async function pollPayout(ref: string): Promise<void> {
  for (const delay of [3000, 5000, 8000, 15000, 30000]) {
    await wait(delay);
    const p = await store().findPaymentByRef(ref);
    if (!p || p.state !== "PAYOUT_REQUESTED") return; // already resolved
    try {
      const status = await aggregatorByName(p.aggregator ?? "peexit").queryStatus(ref);
      if (status === "COMPLETED" || status === "FAILED") { await onPayoutResult(ref, status, p.payoutRef); return; }
    } catch (e) { console.error("poll payout", ref, e); }
  }
}

/**
 * Async payout result (from the PawaPay callback, the reconciliation backstop,
 * or the sandbox simulation). Completes delivery, or refunds on failure.
 * Idempotent: only acts on a payment still awaiting its payout result.
 */
export async function onPayoutResult(ref: string, status: PayoutStatus, providerRef?: string): Promise<void> {
  const p0 = await store().findPaymentByRef(ref);
  if (!p0) return;
  // Per-payment lock: the callback, the status poll AND the reconcile backstop can all
  // fire for one payout — serialize so the delivery leg + identity provisioning run once.
  return store().lockPayment(p0.id, () => onPayoutResultLocked(ref, status, providerRef));
}
async function onPayoutResultLocked(ref: string, status: PayoutStatus, providerRef?: string): Promise<void> {
  const p = await store().findPaymentByRef(ref); // fresh read under the lock
  if (!p || p.state !== "PAYOUT_REQUESTED") return; // already resolved / unknown

  // Feed the route-selection engine: success rate, latency, availability.
  if (status === "COMPLETED" || status === "FAILED") {
    const reqAt = [...p.events].reverse().find((e) => e.state === "PAYOUT_REQUESTED")?.at;
    recordExecution({
      at: new Date().toISOString(), aggregator: p.aggregator ?? "peexit", ref: p.ref,
      provider: p.recipient.provider, status, latencyMs: reqAt ? Math.max(0, Date.now() - Date.parse(reqAt)) : 0,
    });
  }

  if (status === "COMPLETED") {
    await transition(p, "PAYOUT_CONFIRMED", providerRef ?? p.payoutRef);
    await store().recordTxn(p.id, [
      { account: "payout_float_XAF", direction: "debit", amount: p.xaf, currency: "XAF" },
      { account: "external_recipient", direction: "credit", amount: p.xaf, currency: "XAF" },
    ]);
    await transition(p, "DELIVERED");
    // First successful delivery → the number becomes an account: provision the
    // recipient's custodial identity + phone-derived Lightning address. Idempotent.
    ensureIdentity(p.recipient, p.ref);
    // Learning loop: a successful payout teaches/strengthens the merchant identity.
    recordSuccessfulPayout({
      phone: p.recipient.phone, name: p.recipient.name, provider: p.recipient.provider,
      country: p.recipient.country, aggregatorRef: p.aggregator ? `${p.aggregator}:${p.payoutRef ?? ""}` : null,
    });
  } else if (status === "FAILED") {
    // The provider rejected the payout after accepting it → the inbound crypto must go
    // back to the sender. Enter the refund-claim flow (sender supplies an invoice); the
    // ledger is unwound only when the refund actually pays out (finalizeRefund).
    await beginRefund(p, "payout failed at provider");
  }
  // PENDING → leave as-is; reconciliation will re-check.
}

/** Backstop for lost callbacks: re-query payouts stuck in PAYOUT_REQUESTED. */
export async function reconcileStuckPayouts(maxAgeMs = 60_000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const p of await store().listPayments()) {
    if (p.state !== "PAYOUT_REQUESTED" || Date.parse(p.updatedAt) > cutoff) continue;
    const status = await aggregatorByName(p.aggregator ?? "peexit").queryStatus(p.ref);
    if (status === "COMPLETED" || status === "FAILED") await onPayoutResult(p.ref, status);
  }
}

/** Backstop for a lost inbound webhook: poll the issuing rail for Lightning payments
 *  still awaiting inbound and settle any the rail reports paid. Works for any rail
 *  exposing confirmSettlement. Idempotent — only ever advances a
 *  genuinely-settled payment. (On-chain settles by address via the account webhook;
 *  it isn't pollable by transaction id here.) */
/** Authoritative re-query + settle/expire for ONE Lightning inbound. Shared by the
 *  reconcile backstop loop AND the on-demand poll path (GET /payments/:id), so a paid
 *  invoice settles in seconds even when the webhook is missed — WITHOUT depending on
 *  the reconcile cron cadence (which on Vercel Hobby is only daily). Idempotent:
 *  confirmInbound no-ops once booked; a non-pollable/settled/ancient payment returns fast. */
export async function reconcileOneInbound(p: Payment): Promise<void> {
  // Only Lightning on a rail that supports authoritative re-query is pollable here.
  const adapter = adapterByName(p.payInstruction.provider ?? "");
  if (!adapter?.confirmSettlement || p.payInstruction.method !== "LIGHTNING") return;
  // AWAITING/DETECTED settle; FAILED is re-checked to RECOVER an invoice that
  // was really paid but wrongly expired (a lost webhook we couldn't reconcile).
  const recoverable = p.state === "AWAITING_INBOUND" || p.state === "INBOUND_DETECTED" || p.state === "FAILED";
  if (!recoverable || !p.payInstruction.providerRef) return;
  if (p.state === "FAILED" && Date.now() - Date.parse(p.createdAt) > 72 * 3600_000) return; // don't re-check ancient failures
  try {
    const s = await confirmSettlement(p.payInstruction.provider, p.payInstruction.providerRef);
    if (s?.settled) { await confirmInbound(p, p.payInstruction.amount); return; } // settle / recover (LN = full lock)
    // Genuinely unpaid + past expiry → expire so it doesn't sit on "Waiting…"
    // forever. Only when NOT paid (settled check above ran first). No funds moved.
    const expiredAt = Date.parse(p.payInstruction.expiresAt);
    if ((s?.failed || (expiredAt && expiredAt < Date.now() - 120_000)) && p.state === "AWAITING_INBOUND") {
      // Lock + fresh state re-check before failing it: a settlement webhook may have
      // booked/delivered this invoice concurrently. Failing the STALE copy would
      // putPayment-overwrite (erase) its INBOUND_CONFIRMED/DELIVERED events → inboundBooked()
      // false → a later reconcile tick re-books the ledger and pays out a SECOND time.
      await store().lockPayment(p.id, async () => {
        const fresh = await store().getPayment(p.id);
        if (fresh && fresh.state === "AWAITING_INBOUND") await transition(fresh, "FAILED", "invoice expired — not paid");
      });
    }
  } catch (e) { console.error("reconcile inbound", p.id, e); }
}

export async function reconcileStuckInbounds(maxAgeMs = 90_000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const p of await store().listPayments()) {
    if (Date.parse(p.updatedAt) > cutoff) continue; // only payments idle for maxAgeMs
    await reconcileOneInbound(p);
  }
}

/** Backstop for a refund whose outbound Lightning payment was submitted (refundTxId
 *  set) but not confirmed before a restart or after pollRefund's window elapsed —
 *  without this it strands in REFUND_PENDING with the ledger un-reversed even though
 *  the sats went out. Re-query the pay transaction and finalize any that settled.
 *  Idempotent (finalizeRefund no-ops once REFUNDED). */
export async function reconcileStuckRefunds(maxAgeMs = 60_000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const p of await store().listPayments()) {
    if (p.state !== "REFUND_PENDING" || !p.refundTxId || p.refundNeedsDestination) continue;
    if (Date.parse(p.updatedAt) > cutoff) continue;
    try {
      const s = await refundStatus(p.refundProvider, p.refundTxId);
      if (s?.settled) await finalizeRefund(p);
      else if (s?.failed) await reopenRefund(p); // failed outbound → reopen for a new invoice
    } catch (e) { console.error("reconcile refund", p.id, e); }
  }
}

/** Re-verify a payout that was marked FAILED (→ refund) BEFORE the sender has claimed
 *  the refund. A transient/incorrect FAILED that actually settled would otherwise pay
 *  MoMo AND refund the crypto (double-loss). If the rail now authoritatively reports
 *  COMPLETED, hold for an operator instead of refunding. Only touches un-claimed
 *  Lightning refunds (refundNeedsDestination still true → no refund has gone out). */
export async function reconcileFailedPayouts(maxAgeMs = 120_000): Promise<void> {
  const cutoff = Date.now() - maxAgeMs;
  for (const p of await store().listPayments()) {
    if (p.state !== "REFUND_PENDING" || !p.refundNeedsDestination || !p.aggregator) continue;
    if (Date.parse(p.updatedAt) > cutoff) continue;
    try {
      const status = await aggregatorByName(p.aggregator).queryStatus(p.ref);
      if (status === "COMPLETED") await transition(p, "MANUAL_REVIEW", "payout re-verified COMPLETED after a FAILED verdict — do NOT refund");
    } catch (e) { console.error("reconcile failed-payout", p.id, e); }
  }
}

/** Admin: re-attempt delivery of a stuck payment. Exactly-once: reuses the
 *  ORIGINAL idempotency key (a prior payout returns "duplicate" — no second pay).
 *  Honours the same real-money safety as the settle path and only marks DELIVERED
 *  on an authoritative payout confirmation (never eagerly on "accepted"). */
export async function adminRetry(pIn: Payment): Promise<boolean> {
  // Serialize with every other money path (mirrors adminRefund / onPayoutResult): without
  // the lock + fresh read, an operator double-click, or a retry racing reconcile / a payout
  // callback, could both observe "not in flight" and submit TWO real disbursements — the
  // adapter's per-instance in-memory idempotency map cannot be the sole double-pay guard.
  return store().lockPayment(pIn.id, () => adminRetryLocked(pIn.id));
}
async function adminRetryLocked(paymentId: string): Promise<boolean> {
  const p = await store().getPayment(paymentId); // fresh read under the lock
  if (!p) return false;
  if (p.displayStatus === "Completed") return false;
  if (p.state === "REFUNDED" || p.state === "REFUND_PENDING") return false; // never re-pay a refunded inbound
  // Never re-disburse a payout that is already in flight (PAYOUT_REQUESTED). It looks
  // "stuck/Pending" but the async confirmation (callback/poll/reconcile) is still
  // running; a second disburse would double-pay if the adapter's in-memory idempotency
  // map is cold (e.g. after a restart before the snapshot flush).
  if (p.state === "PAYOUT_REQUESTED") return false;

  // Retry is an override of the LATE holds (approval threshold, transient float,
  // low-trust) — all of which happen AFTER FX-lock. It must NEVER resurrect a
  // payment held BEFORE FX-lock, i.e. one whose inbound was never confirmed
  // (on-chain "unverified"/"underpaid"): those have no ledger posting and no float
  // reservation, so paying out would disburse real XAF for crypto that never (fully)
  // arrived. Such a hold must be re-verified via confirmInbound, not blind-retried.
  if (!p.events.some((e) => e.state === "FX_LOCKED")) return false;

  // Re-apply the money-safety guards that confirmInbound enforces (retry is a manual
  // operator OVERRIDE of the approval-threshold hold, but it must NOT be able to
  // breach the corridor cap or over-draw the treasury float — those aren't approvals).
  if (p.xaf > PROVIDER_PAYOUT_MAX[p.recipient.provider]) return false;
  if ((await availableFloatXaf()) < 0) return false;

  // Is THIS payment's crypto inbound real money? (Same test as confirmInbound.)
  const cryptoReal = railTrusted(p.payInstruction.provider);
  // Reuse the original aggregator (idempotent on the ref); else pick a funded one,
  // requiring a LIVE rail when real money is involved.
  const agg = p.aggregator
    ? aggregatorByName(p.aggregator)
    : await selectFundedAggregator(p.recipient.provider, p.recipient.country, p.xaf, cryptoReal);
  if (!agg) return false;
  // SAFETY: never move REAL Mobile Money for a non-real (simulated) crypto inbound.
  if (aggregatorLive(agg.name) && !cryptoReal) return false;
  p.aggregator = agg.name;

  let res;
  try {
    res = await agg.disburse({ idempotencyKey: p.ref, provider: p.recipient.provider, country: p.recipient.country, phone: p.recipient.phone, xaf: p.xaf, name: p.recipient.name });
  } catch {
    return false;
  }
  // The adapter already had this ref in flight — do NOT re-enter PAYOUT_REQUESTED (that
  // would blindly overwrite payoutRef and re-arm confirmation on an existing payout).
  // Mirror confirmInbound: hold for review so an operator confirms the original.
  if (res.status === "duplicate") {
    await transition(p, "MANUAL_REVIEW", "duplicate payout key on retry");
    return false;
  }
  p.payoutRef = res.providerRef;
  // Hand off to the confirmation path: onPayoutResult posts the delivery legs and
  // transitions to DELIVERED — only once the payout actually COMPLETED.
  await transition(p, "PAYOUT_REQUESTED", "retried by admin");
  // The per-payment lock is HELD here — call onPayoutResultLocked (not onPayoutResult,
  // which re-acquires the same lock → re-entrant deadlock), mirroring confirmInboundLocked.
  if (res.simulated) { await onPayoutResultLocked(p.ref, "COMPLETED", res.providerRef); return true; }
  // Real rail: confirm via status query; settle on COMPLETED/FAILED, else keep polling.
  let status: PayoutStatus = "PENDING";
  try { status = (await agg.queryStatus(p.ref)) ?? "PENDING"; } catch { /* keep PENDING */ }
  if (status === "COMPLETED" || status === "FAILED") await onPayoutResultLocked(p.ref, status, res.providerRef);
  else void pollPayout(p.ref); // fire-and-forget: acquires the lock AFTER this one releases
  return true;
}

/** Admin: refund a payment that did not deliver — reverses its ledger entries so
 *  the books stay balanced and the customer's inbound is returned. */
export async function adminRefund(pIn: Payment): Promise<boolean> {
  return store().lockPayment(pIn.id, () => adminRefundLocked(pIn.id));
}
async function adminRefundLocked(paymentId: string): Promise<boolean> {
  const p = await store().getPayment(paymentId); // fresh read under the lock
  if (!p) return false;
  if (p.displayStatus === "Completed") return false;
  // Idempotent: never reverse an already-refunded payment again — reversePayment
  // posts the inverse of EVERY existing entry, so a second refund would double-
  // reverse and unbalance the ledger.
  if (p.state === "REFUNDED" || p.state === "REFUND_PENDING") return false;
  // adminRefund only REVERSES the ledger — it assumes the crypto was returned
  // out-of-band (the on-chain/USDT case, where beginRefund routes to MANUAL_REVIEW for
  // exactly this). A LIGHTNING inbound holds real sats with an AUTOMATED return path
  // (the sender-invoice claim → completeRefund actually pays a bolt11). Reversing its
  // ledger here would mark it REFUNDED while the sats stay put, converting them into
  // sweepable treasury without ever returning them. Force the claim flow instead.
  if (p.payInstruction.method === "LIGHTNING" && inboundBooked(p)) return false;
  await store().reversePayment(p.id);
  await transition(p, "REFUND_PENDING", "refund initiated by admin");
  await transition(p, "REFUNDED", "refunded by admin");
  return true;
}

/* ============================================================
   Refund-claim flow — when a payout can't land, the inbound crypto is returned to
   the sender via an outbound Lightning payment to an invoice THEY supply. Guarded:
   Lightning-only, amount-bounded (never over-pay), idempotent (the needs-destination
   flag claims it). Settlement is confirmed by polling the pay transaction.
   ============================================================ */
export async function completeRefund(pIn: Payment, bolt11: string): Promise<{ ok: boolean; error?: string }> {
  // Lock so two racing claims can't both pass the refundNeedsDestination gate below and
  // both pay the sender (double refund if they carry different invoices).
  return store().lockPayment(pIn.id, () => completeRefundLocked(pIn.id, bolt11));
}
async function completeRefundLocked(paymentId: string, bolt11: string): Promise<{ ok: boolean; error?: string }> {
  const p = await store().getPayment(paymentId); // fresh read under the lock
  if (!p || p.state !== "REFUND_PENDING" || !p.refundNeedsDestination) return { ok: false, error: "not_refundable" };
  if (p.payInstruction.method !== "LIGHTNING") return { ok: false, error: "refund_lightning_only" };
  const inboundMsat = btcToMsat(p.payInstruction.amount);
  const invMsat = bolt11AmountMsat(bolt11);
  if (invMsat == null) return { ok: false, error: "bad_invoice" };
  // Over/under-refund guard: accept an amount-less invoice (we set the amount) or one
  // that matches the inbound within 1%. Never pay an invoice for MORE than was received.
  if (invMsat !== 0 && (invMsat > inboundMsat || invMsat < inboundMsat * 0.99)) return { ok: false, error: "amount_mismatch" };
  // Double-loss backstop AT CLAIM TIME: a payout marked FAILED can later read
  // COMPLETED (a transient rail failure that actually settled). reconcileFailedPayouts
  // catches this, but only on a 120s timer — a sender who pastes a bolt11 within seconds
  // beats it, and once we clear refundNeedsDestination below the backstop no longer
  // fires. So re-query the payout authoritatively here (queryStatus itself re-checks the
  // rail): if it now reports COMPLETED, hold for an operator instead of paying the refund
  // — otherwise MoMo was paid AND the crypto is returned (full double-loss).
  if (p.aggregator) {
    let payoutStatus: PayoutStatus | null = null;
    try { payoutStatus = await aggregatorByName(p.aggregator).queryStatus(p.ref); } catch { /* unverifiable → fall through; a genuine FAILED still refunds */ }
    if (payoutStatus === "COMPLETED") {
      await transition(p, "MANUAL_REVIEW", "payout re-verified COMPLETED at refund-claim — do NOT refund");
      return { ok: false, error: "payout_completed" };
    }
  }
  // Claim the refund — idempotent: a second submit while in flight is rejected above.
  p.refundNeedsDestination = false;
  await store().putPayment(p);
  try {
    const r = await payRefund(bolt11, invMsat === 0 ? inboundMsat : undefined);
    p.refundTxId = r.transactionId;
    p.refundProvider = r.provider; // re-query the SAME rail that paid it
    await store().putPayment(p);
    if (r.settled) await finalizeRefundLocked(p.id); // lock already held
    else void pollRefund(p.ref);
    return { ok: true };
  } catch (e) {
    // AMBIGUOUS failure. The invoice already passed local validation, so a throw here
    // means we asked IBEX to pay and CANNOT be sure the sats didn't leave (a read
    // timeout can throw AFTER the payment began). Reopening would let the sender submit
    // a SECOND invoice → double refund / real loss. Hold for an operator to verify
    // whether the outbound actually went out (refundNeedsDestination stays false).
    await transition(p, "MANUAL_REVIEW", `refund payout ambiguous — verify before retry: ${e instanceof Error ? e.message : "error"}`);
    return { ok: false, error: "refund_needs_review" };
  }
}

/** The outbound refund settled — unwind the ledger (we no longer hold the inbound) and
 *  mark REFUNDED. Idempotent. */
async function finalizeRefund(p: Payment): Promise<void> {
  return store().lockPayment(p.id, () => finalizeRefundLocked(p.id));
}
async function finalizeRefundLocked(paymentId: string): Promise<void> {
  const p = await store().getPayment(paymentId); // fresh read under the lock
  if (!p || p.state === "REFUNDED") return; // already reversed — never double-reverse (inverts the ledger)
  await store().reversePayment(p.id);
  await transition(p, "REFUNDED", "crypto refunded to sender");
}

/** The outbound refund Lightning payment DEFINITIVELY failed (no route / expired) —
 *  the sats did NOT leave, so we still hold the inbound. Reopen the claim so the
 *  sender can supply a fresh invoice. Safe (no double-pay: the prior attempt failed). */
async function reopenRefund(pIn: Payment): Promise<void> {
  return store().lockPayment(pIn.id, () => reopenRefundLocked(pIn.id));
}
async function reopenRefundLocked(paymentId: string): Promise<void> {
  const p = await store().getPayment(paymentId); // fresh read under the lock (mirrors finalizeRefund)
  // Fresh state re-check: if a concurrent finalizeRefund already settled this to REFUNDED,
  // do NOT resurrect it to REFUND_PENDING + null refundTxId — that stale-copy clobber
  // (putPayment overwrites the whole record) would let the sender submit a SECOND invoice
  // → double refund.
  if (!p || p.state !== "REFUND_PENDING") return;
  p.refundNeedsDestination = true;
  p.refundTxId = undefined; // void the failed attempt — a new invoice starts clean
  await transition(p, "REFUND_PENDING", "refund payout failed — awaiting a new invoice");
}

/** Poll the outbound refund payment to settlement (Lightning settles in seconds). */
async function pollRefund(ref: string): Promise<void> {
  for (const delay of [3000, 5000, 8000, 15000, 30000]) {
    await wait(delay);
    const p = await store().findPaymentByRef(ref);
    if (!p || p.state !== "REFUND_PENDING" || !p.refundTxId) return; // resolved / unknown
    const s = await refundStatus(p.refundProvider, p.refundTxId).catch(() => null);
    if (s?.settled) { await finalizeRefund(p); return; }
    if (s?.failed) { await reopenRefund(p); return; } // failed → let the sender retry (was: stranded)
  }
}

/** Sandbox driver: simulate rail confirmation latency, then settle. */
export async function settle(p: Payment): Promise<void> {
  if (p.state !== "AWAITING_INBOUND") return;
  const confirmMs = p.method === "ONCHAIN" ? 2600 : 1400;
  await markDetected(p);
  await wait(confirmMs);
  // Sandbox: the simulated inbound matches the locked invoice amount.
  await confirmInbound(p, p.payInstruction.amount);
}
