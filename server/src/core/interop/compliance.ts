/* ============================================================
   Compliance engine — ONE interface, rules behind it, provider-pluggable later.

   Everything here decides BEFORE money moves. It composes what already exists (the
   settings watchlist and its matcher, identity claims, merchant verification, the
   approval and CDD thresholds) with velocity limits over the payment store. Three
   verdicts, and only three:
     blocked → the payment is refused at creation (watchlist hit, velocity exceeded)
     review  → the payment is created, the pay-in accepted, and settlement HOLDS for an
               operator (CDD trigger, near a limit) — money is never lost, never auto-paid
     clear   → straight through
   A screening/KYB provider slots in by implementing ComplianceEngine and replacing
   `engine`; routing and payment creation do not change.
   ============================================================ */
import type { CountryCode, Payment } from "../../../../shared/types.js";
import { store } from "../../db/store.js";
import { getSettings } from "../settings.js";
import { sanctionsHit } from "../compliance.js";
import { getIdentityByDigits } from "../identity.js";
import { merchantByCode } from "../merchantAccount.js";

export type Verdict = "clear" | "review" | "blocked";
export interface ScreenInput { owner: string; recipientPhone: string; recipientName?: string; country: CountryCode; xaf: number; merchantCode?: string | null }
export interface ScreenResult { verdict: Verdict; flags: string[]; risk: number /* 0..100 */ }

export interface ComplianceEngine {
  verifyIdentity(phone: string, country: CountryCode): { verified: boolean; source: string };
  verifyBusiness(merchantCode: string): { verified: boolean };
  checkLimits(input: ScreenInput): Promise<{ ok: boolean; flags: string[] }>;
  screenTransaction(input: ScreenInput): Promise<ScreenResult>;
  calculateRisk(input: ScreenInput, flags: string[]): number;
}

const LIVE_STATES = new Set<Payment["state"]>(["AWAITING_INBOUND", "INBOUND_DETECTED", "INBOUND_CONFIRMED", "FX_LOCKED", "PAYOUT_REQUESTED", "PAYOUT_CONFIRMED", "DELIVERED", "MANUAL_REVIEW"]);

async function recent(windowMs: number): Promise<Payment[]> {
  const since = Date.now() - windowMs;
  return (await store().listPayments()).filter((p) => LIVE_STATES.has(p.state) && Date.parse(p.createdAt) >= since);
}

export const rulesEngine: ComplianceEngine = {
  verifyIdentity(phone, country) {
    const id = getIdentityByDigits(phone, country);
    return { verified: !!id?.claimed, source: id?.claimed ? "otp_claim" : id ? "latent" : "none" };
  },
  verifyBusiness(code) {
    const m = merchantByCode(code);
    return { verified: !!m?.verifiedPhone };
  },
  async checkLimits(input) {
    const v = getSettings().compliance.velocity;
    const flags: string[] = [];
    const day = await recent(24 * 3600_000);
    const digits = input.recipientPhone.replace(/\D/g, "");
    const senderDay = day.filter((p) => p.senderId === input.owner).reduce((a, p) => a + p.xaf, 0) + input.xaf;
    const recipientDay = day.filter((p) => p.recipient.phone.replace(/\D/g, "").endsWith(digits.slice(-9))).reduce((a, p) => a + p.xaf, 0) + input.xaf;
    const senderHour = (await recent(3600_000)).filter((p) => p.senderId === input.owner).length + 1;
    let ok = true;
    if (v.senderDayXaf > 0 && senderDay > v.senderDayXaf) { ok = false; flags.push(`velocity: sender 24h total ${senderDay} XAF exceeds ${v.senderDayXaf}`); }
    else if (v.senderDayXaf > 0 && senderDay > v.senderDayXaf * 0.8) flags.push(`near limit: sender 24h total ${senderDay} XAF (limit ${v.senderDayXaf})`);
    if (v.recipientDayXaf > 0 && recipientDay > v.recipientDayXaf) { ok = false; flags.push(`velocity: recipient 24h total ${recipientDay} XAF exceeds ${v.recipientDayXaf}`); }
    if (v.senderHourCount > 0 && senderHour > v.senderHourCount) { ok = false; flags.push(`velocity: ${senderHour} payments in an hour exceeds ${v.senderHourCount}`); }
    return { ok, flags };
  },
  calculateRisk(input, flags) {
    let r = 10;
    if (flags.some((f) => f.startsWith("watchlist"))) r += 90;
    if (flags.some((f) => f.startsWith("velocity"))) r += 50;
    if (flags.some((f) => f.startsWith("near limit"))) r += 15;
    if (flags.some((f) => f.startsWith("cdd"))) r += 20;
    if (!this.verifyIdentity(input.recipientPhone, input.country).verified) r += 5;
    return Math.min(100, r);
  },
  async screenTransaction(input) {
    const s = getSettings().compliance;
    const flags: string[] = [];
    const hit = sanctionsHit(input.recipientPhone, input.recipientName, s.sanctionsList);
    if (hit) flags.push(`watchlist: recipient matches "${hit}"`);
    const lim = await this.checkLimits(input);
    flags.push(...lim.flags);
    if (input.xaf >= s.cddThresholdXaf) flags.push(`cdd: ${input.xaf} XAF at or above the CDD trigger (${s.cddThresholdXaf})`);
    const blocked = !!hit || !lim.ok;
    const verdict: Verdict = blocked ? "blocked" : flags.length ? "review" : "clear";
    return { verdict, flags, risk: this.calculateRisk(input, flags) };
  },
};

/** The engine in force. Swap for a provider-backed implementation without touching callers. */
export let engine: ComplianceEngine = rulesEngine;
export function setComplianceEngine(e: ComplianceEngine): void { engine = e; }
