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
import { notify } from "./notifications.js";
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
    if (!h.eligible) out.push({ key: `rail:${p.name}`, severity: "critical", body: `Payout rail ${p.name} is DOWN (success ${Math.round(h.successRate * 100)} %). Payouts route around it; if it is the only rail for an operator, payouts wait.` });
  }
  // Payments: stuck payouts and long-held reviews.
  const pays = await store().listPayments();
  const stuck = pays.filter((p) => p.state === "PAYOUT_REQUESTED" && now - Date.parse(p.updatedAt) > STUCK_PAYOUT_MIN * 60_000);
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
