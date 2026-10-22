/* ============================================================
   Alerts that PAGE (Tier-1 item 4 of the infrastructure audit).

   Until now a stuck payout, a rail going down or an empty float surfaced as a console log
   and an operator notification INSIDE the admin console — noticed at the next login.
   This evaluates the money-critical conditions on every reconcile tick and sends the
   first occurrence (and a reminder every hour while it persists) to the operator's phone:
   WhatsApp first, SMS fallback, always recorded in the outbox. A condition that clears
   sends an all-clear once. Nothing here changes money state.

   Conditions: a payout rail marked ineligible · payments stuck in PAYOUT_REQUESTED or
   held in MANUAL_REVIEW for too long · payout float under the floor · network
   reconciliation unmatched/stuck · low network liquidity · the deep health probe failing.
   ============================================================ */
import { getSettings } from "./settings.js";
import { store } from "../db/store.js";
import { PAYOUTS } from "../adapters/payouts.js";
import { payoutHealth } from "./routing.js";
import { availableFloatXaf } from "./stateMachine.js";
import { notify, otpChannels, otpSmsSender, smsProviderRejecting } from "./notifications.js";
import { identityEnabled, providersHealth } from "./identityResolution/resolver.js";
import { DEFERRED, isDeferredRail } from "../adapters/deferred.js";
import type { IdentityProviderHealth } from "../../../shared/identity.js";
import * as whatsapp from "../adapters/whatsapp.js";
import { smsChannel } from "../adapters/notify.js";
import { inReplyWindow } from "./whatsapp.js";
import { config, whatsappConfigured, liveMoney } from "../config.js";
import { reconcile as networkReconcile } from "./network/shadow.js";
import { lowLiquidity } from "./network/liquidity.js";
import { floatPlan } from "./floatPlan.js";
import { register, touch } from "./persist.js";

export interface AlertCondition { key: string; severity: "critical" | "warning"; body: string }
export interface AlertState { key: string; firstAt: string; lastSentAt: string; count: number; body: string }

const REMIND_MS = 60 * 60_000;
/** Below this much payout float the next ordinary payout is at risk (operator-tunable via env). */
const FLOAT_FLOOR_XAF = Number(process.env.ALERT_FLOAT_FLOOR_XAF ?? 250_000) || 250_000;
const STUCK_PAYOUT_MIN = 20;
const REVIEW_MIN = 60;
const active = new Map<string, AlertState>();
// Survives a restart: an open condition is not re-paged as "new" every deploy, and the
// hourly reminder count keeps counting.
register("alerts", () => [...active.values()], (d: AlertState[]) => { for (const a of d ?? []) active.set(a.key, a); });
let lastEvaluation: { at: string; conditions: AlertCondition[] } = { at: new Date(0).toISOString(), conditions: [] };

/** Everything that is wrong right now, as one list. Pure read. */
export async function conditions(now = Date.now()): Promise<AlertCondition[]> {
  const out: AlertCondition[] = [];
  // Rails: a configured payout rail the router will not use.
  for (const p of PAYOUTS) {
    if (!p.configured()) continue;
    const h = payoutHealth(p.name);
    if (!h.eligible) out.push({ key: `rail:${p.name}`, severity: "critical", body: `Payout rail ${p.name} is DOWN (${h.samples ? `success ${Math.round(h.successRate * 100)} % over ${h.samples} call(s)` : "not one call has ever reached it — check the base URL resolves"}). Payouts route around it; if it is the only rail for an operator, payouts wait.` });
  }
  // Payments: stuck payouts and long-held reviews.
  const pays = await store().listPayments();
  // 20 minutes is a Mobile Money threshold: those rails answer in seconds, so twenty is
  // already pathological. A BANK rail is different in kind — PAYOUT_REQUESTED for a day is
  // normal there, because settlement waits for a cut-off. Paging at 20 minutes on every
  // deferred payout would be a false alarm per payment, which is how an operator learns to
  // skim the one alarm that matters. Deferred rails have their own, slower alarm
  // (deferred:*:unsettled) that watches for DEBITED-and-unproven instead.
  const stuck = pays.filter((p) => p.state === "PAYOUT_REQUESTED" && !isDeferredRail(p.aggregator) && now - Date.parse(p.updatedAt) > STUCK_PAYOUT_MIN * 60_000);
  if (stuck.length) out.push({ key: "payments:stuck", severity: "critical", body: `${stuck.length} payout(s) in PAYOUT_REQUESTED for over ${STUCK_PAYOUT_MIN} min: ${stuck.slice(0, 3).map((p) => p.ref).join(", ")}${stuck.length > 3 ? "…" : ""}. Admin → Payments.` });
  // A refund the sender has not claimed is money we owe and still hold: page after an hour.
  const unclaimed = pays.filter((p) => p.state === "REFUND_PENDING" && p.refundNeedsDestination && now - Date.parse(p.updatedAt) > 60 * 60_000);
  if (unclaimed.length) out.push({ key: "payments:refund_unclaimed", severity: "warning", body: `${unclaimed.length} refund(s) unclaimed for over 1 h: ${unclaimed.slice(0, 3).map((p) => p.ref).join(", ")}. The sender can retry delivery or paste an invoice; Admin → Payments can retry on another rail.` });
  const held = pays.filter((p) => p.state === "MANUAL_REVIEW" && now - Date.parse(p.updatedAt) > REVIEW_MIN * 60_000);
  if (held.length) out.push({ key: "payments:review", severity: "warning", body: `${held.length} payment(s) waiting for review for over ${REVIEW_MIN} min: ${held.slice(0, 3).map((p) => p.ref).join(", ")}. Admin → Payments.` });
  // Float: below the approval threshold means the next large payout cannot be honoured.
  if (liveMoney()) {
    const float = await availableFloatXaf().catch(() => null);
    const floor = FLOAT_FLOOR_XAF;
    if (float != null && float < floor) out.push({ key: "float:low", severity: "critical", body: `Payout float is ${Math.round(float).toLocaleString("en")} XAF — below ${floor.toLocaleString("en")}. Top up the aggregator wallet before payouts start failing.` });
  }
  // Float plan: a live aggregator wallet with real daily volume and under two days left.
  if (liveMoney()) {
    const plan = await floatPlan(now).catch(() => null);
    for (const a of plan?.aggregators ?? []) if (a.live && a.avgDailyXaf > 0 && a.daysOfFloat != null && a.daysOfFloat < 2) out.push({ key: `float:days:${a.name}`, severity: "warning", body: `${a.name} wallet holds ${a.daysOfFloat} day(s) of payouts (${Math.round(a.balanceXaf ?? 0).toLocaleString("en")} XAF vs ${a.avgDailyXaf.toLocaleString("en")} XAF/day). Top up ${a.topUpXaf.toLocaleString("en")} XAF to reach ${plan!.targetDays} days.` });
  }
  // The network: books that do not balance, stuck sagas, dry liquidity.
  const rc = networkReconcile();
  if (rc.unmatched) out.push({ key: "network:unmatched", severity: "critical", body: `${rc.unmatched} network transaction(s) whose ledger does not balance. Admin → Interoperability → Transactions.` });
  if (rc.stuck) out.push({ key: "network:stuck", severity: "warning", body: `${rc.stuck} network transaction(s) stuck in one state for over 30 min.` });
  const low = await lowLiquidity().catch(() => []);
  /* NOBODY CAN VERIFY A NUMBER.
     Verification is not a background nicety: merchant onboarding, "own your number" and
     account claim all dead-end at a code that never arrives, and the customer is told
     "we could not send a text message right now, please try again shortly" — which invites
     a retry that will also fail, for ever. That state was visible only in a log line and a
     console tile nobody had reason to open. It pages now, like an empty float does. */
  out.push(...otpConditions(liveMoney(), otpChannels(), otpSmsSender() === "nexah" && smsProviderRejecting()));

  /* NOBODY CAN CHECK WHO OWNS A NUMBER.
     The same shape of silence as the OTP outage above. Recipient verification is the one
     guard on a payment that cannot be reversed, and when the provider that answers "who
     owns this number" is misconfigured the resolver rests it, drops the reason, and every
     sender is told the soft, true-sounding "this number can't be verified yet" instead.
     Senders keep paying — unverified — and nothing anywhere says the verifier is off. */
  out.push(...identityConditions(liveMoney(), identityEnabled(), await providersHealth().catch(() => [])));

  // Deferred rails (banks / MFIs): debited and unproven. DEFERRED is empty until a real
  // counterparty exists, so this contributes nothing today and starts working the day one
  // is registered — rather than being remembered then.
  out.push(...deferredConditions(liveMoney(), DEFERRED.map((d) => ({ name: d.name, rows: d.allRows(), unattributed: 0 }))));

  for (const a of low) out.push({ key: `liquidity:${a.sourceId}`, severity: "warning", body: `Low liquidity: ${a.sourceId} has ${Math.round(a.available).toLocaleString("en")} (floor ${a.floor.toLocaleString("en")}).` });
  return out;
}

/** Deliver one page: outbox (always) → WhatsApp (free text inside the 24 h reply window,
 *  the WHATSAPP_TEMPLATE_ALERT utility template outside it) → SMS gateway as the fallback. */
export async function page(text: string): Promise<{ via: "whatsapp" | "sms" | "console"; detail?: string }> {
  const to = (getSettings().ops.alertPhone ?? "").replace(/\D/g, "");
  await notify({ kind: "ops_alert", audience: "operator", body: text }).catch(() => {});
  if (!to) return { via: "console" };
  let detail = "";
  if (whatsappConfigured()) {
    try {
      const r = inReplyWindow(to) ? await whatsapp.sendText(to, text)
        : config.whatsapp.templateAlert ? await whatsapp.sendTemplate(to, config.whatsapp.templateAlert, config.whatsapp.templateLang, [text.slice(0, 1000)])
        : { ok: false as const, detail: "outside the 24 h window and WHATSAPP_TEMPLATE_ALERT is not set" };
      if (r.ok) return { via: "whatsapp" };
      detail = r.detail ?? "whatsapp failed";
    } catch (e) { detail = e instanceof Error ? e.message : "whatsapp failed"; }
  }
  if (smsChannel.configured()) {
    const r = await smsChannel.send({ audience: "recipient", kind: "ops_alert", to, body: text.slice(0, 300) }).catch((e) => ({ ok: false, detail: e instanceof Error ? e.message : "sms failed" }));
    if (r.ok) return { via: "sms" };
    detail = `${detail ? detail + "; " : ""}${r.detail ?? "sms failed"}`;
  }
  await notify({ kind: "ops_alert", audience: "operator", body: `Could not page ${to}: ${detail || "no channel configured"}. The alert above is only in the console.` }).catch(() => {});
  return { via: "console", detail };
}

/** Evaluate, page new/persisting conditions, all-clear the ones that vanished. */
/** CAN ANYBODY VERIFY A NUMBER? Pure, so it can be asserted without a live-money deployment.
 *
 *  Only where a real code has to reach a real handset: on a sandbox the OTP endpoints hand
 *  back a devCode instead of sending, so verification works with no channel at all, and
 *  paging about it there is a false alarm — which is worse than no alarm, because it
 *  teaches an operator to skim the feed. */
/** Recipient verification, under live money, with nobody able to answer.
 *
 *  "Can answer" means configured, able to RESOLVE a name (the aggregator confirms a number
 *  is reachable and nothing more — it can never name anybody), and not currently down or
 *  resting on a breaker. When that set is empty the product still works: it just stops
 *  checking recipients, quietly, which is the dangerous way for a safety feature to fail. */
export function identityConditions(live: boolean, enabled: boolean, health: IdentityProviderHealth[]): AlertCondition[] {
  if (!live || !enabled) return [];
  const namers = health.filter((h) => h.configured && h.supports.resolve);
  // UNKNOWN counts as answering ON PURPOSE. A provider's counters reset on restart, so
  // treating "not yet called" as an outage would page on every single deploy and teach the
  // operator to skim. The first real resolve sets it to DOWN and this fires then.
  const answering = namers.filter((h) => h.status !== "DOWN" && h.status !== "NOT_CONFIGURED");
  if (answering.length) return [];
  const why = namers.length
    ? namers.map((h) => `${h.name} (${h.lastError ?? h.status})`).join(", ")
    : "no configured provider can resolve a name";
  return [{ key: "identity:unverifiable", severity: "critical", body: `Recipient verification is OFF: no provider can say who owns a number, so every sender is told the recipient "can't be verified" and pays unchecked. Mobile Money does not reverse. Cause: ${why}. Admin → Identity shows each provider.` }];
}

/** Deferred rails: money that LEFT us and cannot be shown to have arrived.
 *
 *  On a Mobile Money rail a payout is answered in seconds and a stuck one is already paged
 *  by payments:stuck. A bank rail is different in a way that defeats that alarm: DEBITED is
 *  a perfectly normal state to sit in for hours, so nothing looks wrong until it has been
 *  wrong for a day — and by then the statement that would have proved delivery is one we
 *  have already read and filed.
 *
 *  `hours` is deliberately generous (a working day by default). The point is not to notice
 *  quickly; it is to notice AT ALL, before a reconciliation at month end finds it.
 *
 *  Unattributed lines are a WARNING, not a page: a bank's own fee is an unattributed line
 *  and is not an incident. A line we cannot explain still has to be seen by somebody. */
export function deferredConditions(
  live: boolean,
  rails: Array<{ name: string; rows: Array<{ key: string; state: string; amount: number; currency: string; submittedAt?: string }>; unattributed?: number }>,
  now = Date.now(),
  hours = 24,
): AlertCondition[] {
  if (!live) return [];
  const out: AlertCondition[] = [];
  for (const rail of rails) {
    const overdue = rail.rows.filter((r) => r.state === "DEBITED" && r.submittedAt && now - Date.parse(r.submittedAt) > hours * 3_600_000);
    if (overdue.length) {
      const total = overdue.reduce((t, r) => t + r.amount, 0);
      out.push({
        key: `deferred:${rail.name}:unsettled`,
        severity: "critical",
        body: `${overdue.length} payment(s) on ${rail.name} were DEBITED over ${hours}h ago and no statement shows them arriving — ${total.toLocaleString("en")} ${overdue[0].currency} left our account with nothing proving it reached anybody. Refs: ${overdue.slice(0, 3).map((r) => r.key).join(", ")}${overdue.length > 3 ? "…" : ""}. This is not a stuck payout: the bank says it paid us out. Ask the bank for the entries, then Admin → Reconciliation.`,
      });
    }
    if (rail.unattributed) {
      out.push({
        key: `deferred:${rail.name}:unattributed`,
        severity: "warning",
        body: `${rail.unattributed} line(s) on ${rail.name}'s statement match nothing we instructed. A bank fee looks exactly like this and is fine; a credit or a reversal is not. Admin → Reconciliation lists them.`,
      });
    }
  }
  return out;
}

export function otpConditions(live: boolean, otp: { sms: boolean; whatsapp: boolean }, providerRejecting: boolean): AlertCondition[] {
  if (!live) return [];
  if (!otp.sms && !otp.whatsapp) {
    return [{ key: "otp:undeliverable", severity: "critical", body: `No channel can deliver a one-time code, so NOBODY can verify a number: merchant onboarding, "own your number" and account claim are all blocked. Admin → Notifications → Check credentials says which of the provider and the Settings → Channels switch is missing.` }];
  }
  if (providerRejecting) {
    // Configured, switched on, and the provider is refusing us — the worst of the three,
    // because every check short of actually calling the provider says it is fine.
    return [{ key: "otp:provider_rejected", severity: "critical", body: `The SMS provider is REFUSING our credentials, so one-time codes are not being delivered. Verification is blocked until it is fixed. Admin → Notifications → Check credentials shows what the provider said.` }];
  }
  return [];
}

export async function evaluateAlerts(now = Date.now()): Promise<{ raised: string[]; cleared: string[]; active: AlertState[] }> {
  const list = await conditions(now);
  lastEvaluation = { at: new Date(now).toISOString(), conditions: list };
  const raised: string[] = [], cleared: string[] = [];
  const seen = new Set<string>();
  for (const c of list) {
    seen.add(c.key);
    const prev = active.get(c.key);
    if (!prev) {
      active.set(c.key, { key: c.key, firstAt: new Date(now).toISOString(), lastSentAt: new Date(now).toISOString(), count: 1, body: c.body });
      raised.push(c.key); touch("alerts");
      await page(`${c.severity === "critical" ? "🔴" : "🟠"} MoMo›Me: ${c.body}`);
    } else if (now - Date.parse(prev.lastSentAt) >= REMIND_MS) {
      prev.lastSentAt = new Date(now).toISOString(); prev.count++; prev.body = c.body; touch("alerts");
      await page(`${c.severity === "critical" ? "🔴" : "🟠"} Still open (${prev.count}h): ${c.body}`);
    }
  }
  for (const [k, st] of [...active]) {
    if (seen.has(k)) continue;
    active.delete(k); cleared.push(k); touch("alerts");
    await page(`✅ Cleared: ${st.body.split(".")[0]}.`);
  }
  return { raised, cleared, active: [...active.values()] };
}

export const activeAlerts = (): AlertState[] => [...active.values()];
export const lastAlertEvaluation = () => lastEvaluation;
/** Test seam. */
export function resetAlerts(): void { active.clear(); touch("alerts"); }
