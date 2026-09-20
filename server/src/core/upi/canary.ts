/* Canary for UPI execution (Phase 18). EXECUTE mode is never all-or-nothing: a device
   allowlist, a rollout share (stable hash bucket — the same device is always in or out),
   a per-payment cap and a rolling 24 h cap in XAF, all from variables, all read at call
   time. Outside the canary an intent is routed and recorded (shadow) but not executed —
   the sender pays through V1 exactly as before. */
import { rolloutBucket } from "../network/saga.js";
import { allIntents } from "./intents.js";

export interface CanaryConfig { devices: string[]; rolloutPct: number; maxPerTxXaf: number; maxPerDayXaf: number }
export function canaryConfig(): CanaryConfig {
  const n = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 ? v : d; };
  return { devices: (process.env.UPI_CANARY_DEVICES ?? "").split(",").map((s) => s.trim()).filter(Boolean), rolloutPct: Math.min(100, n("UPI_ROLLOUT_PCT", 0)), maxPerTxXaf: n("UPI_MAX_PER_TX_XAF", 50_000), maxPerDayXaf: n("UPI_MAX_PER_DAY_XAF", 500_000) };
}
/** Executed (not shadow, not failed before money moved) volume in the last 24 h. */
export function executedVolume24h(now = Date.now()): number {
  const since = now - 86_400_000;
  return allIntents(5_000).filter((i) => i.request && Date.parse(i.createdAt) >= since && !["CANCELLED", "EXPIRED", "PAYMENT_FAILED"].includes(i.state)).reduce((s, i) => s + (i.amount.currency === "XAF" ? i.amount.value : 0), 0);
}
export function canaryGate(owner: string, amountXaf: number, now = Date.now()): { ok: boolean; reason?: string } {
  const c = canaryConfig();
  const listed = c.devices.includes(owner);
  if (!listed && c.rolloutPct <= 0) return { ok: false, reason: "canary: no rollout (UPI_ROLLOUT_PCT=0 and this device is not listed)" };
  if (!listed && rolloutBucket(owner) >= c.rolloutPct) return { ok: false, reason: `canary: this device is outside the ${c.rolloutPct} % rollout` };
  if (amountXaf > c.maxPerTxXaf) return { ok: false, reason: `canary: ${amountXaf} XAF is above the per-payment cap of ${c.maxPerTxXaf} XAF` };
  if (executedVolume24h(now) + amountXaf > c.maxPerDayXaf) return { ok: false, reason: `canary: the rolling 24 h cap of ${c.maxPerDayXaf} XAF would be exceeded` };
  return { ok: true };
}
