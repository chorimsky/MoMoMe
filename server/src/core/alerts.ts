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
import { notify, sendOtpSms, canSendSms } from "./notifications.js";
import * as whatsapp from "../adapters/whatsapp.js";
import { whatsappConfigured, liveMoney } from "../config.js";
import { reconcile as networkReconcile } from "./network/shadow.js";
import { lowLiquidity } from "./network/liquidity.js";

export interface AlertCondition { key: string; severity: "critical" | "warning"; body: string }
export interface AlertState { key: string; firstAt: string; lastSentAt: string; count: number; body: string }

const REMIND_MS = 60 * 60_000;
/** Below this much payout float the next ordinary payout is at risk (operator-tunable via env). */
const FLOAT_FLOOR_XAF = Number(process.env.ALERT_FLOAT_FLOOR_XAF ?? 250_000) || 250_000;
const STUCK_PAYOUT_MIN = 20;
const REVIEW_MIN = 60;
const active = new Map<string, AlertState>();
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
  const held = pays.filter((p) => p.state === "MANUAL_REVIEW" && now - Date.parse(p.updatedAt) > REVIEW_MIN * 60_000);
  if (held.length) out.push({ key: "payments:review", severity: "warning", body: `${held.length} payment(s) waiting for review for over ${REVIEW_MIN} min: ${held.slice(0, 3).map((p) => p.ref).join(", ")}. Admin → Payments.` });
  // Float: below the approval threshold means the next large payout cannot be honoured.
  if (liveMoney()) {
    const float = await availableFloatXaf().catch(() => null);
    const floor = FLOAT_FLOOR_XAF;
    if (float != null && float < floor) out.push({ key: "float:low", severity: "critical", body: `Payout float is ${Math.round(float).toLocaleString("en")} XAF — below ${floor.toLocaleString("en")}. Top up the aggregator wallet before payouts start failing.` });
  }
  // The network: books that do not balance, stuck sagas, dry liquidity.
  const rc = networkReconcile();
  if (rc.unmatched) out.push({ key: "network:unmatched", severity: "critical", body: `${rc.unmatched} network transaction(s) whose ledger does not balance. Admin → Interoperability → Transactions.` });
  if (rc.stuck) out.push({ key: "network:stuck", severity: "warning", body: `${rc.stuck} network transaction(s) stuck in one state for over 30 min.` });
  const low = await lowLiquidity().catch(() => []);
  for (const a of low) out.push({ key: `liquidity:${a.sourceId}`, severity: "warning", body: `Low liquidity: ${a.sourceId} has ${Math.round(a.available).toLocaleString("en")} (floor ${a.floor.toLocaleString("en")}).` });
  return out;
}

async function page(text: string): Promise<void> {
  const to = (getSettings().ops.alertPhone ?? "").replace(/\D/g, "");
  await notify({ kind: "reconciliation_mismatch", audience: "operator", body: text }).catch(() => {});
  if (!to) return;
  let sent = false;
  if (whatsappConfigured()) { try { const r = await whatsapp.sendText(to, text); sent = !!r.ok; } catch { sent = false; } }
  if (!sent && canSendSms()) await sendOtpSms(to, text.slice(0, 300), "alert").catch(() => {});
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
      raised.push(c.key);
      await page(`${c.severity === "critical" ? "🔴" : "🟠"} MoMo›Me: ${c.body}`);
    } else if (now - Date.parse(prev.lastSentAt) >= REMIND_MS) {
      prev.lastSentAt = new Date(now).toISOString(); prev.count++; prev.body = c.body;
      await page(`${c.severity === "critical" ? "🔴" : "🟠"} Still open (${prev.count}h): ${c.body}`);
    }
  }
  for (const [k, st] of [...active]) {
    if (seen.has(k)) continue;
    active.delete(k); cleared.push(k);
    await page(`✅ Cleared: ${st.body.split(".")[0]}.`);
  }
  return { raised, cleared, active: [...active.values()] };
}

export const activeAlerts = (): AlertState[] => [...active.values()];
export const lastAlertEvaluation = () => lastEvaluation;
/** Test seam. */
export function resetAlerts(): void { active.clear(); }
