/* ============================================================
   API v1 — sandbox scenarios (test environment only; docs/api-v1/SANDBOX.md).

   A developer rehearses every outcome by paying a RESERVED recipient number; everything
   else behaves like production against simulated rails. `POST /v1/sandbox/payments/:id/pay`
   stands in for the customer's wallet.

     +237 670 000 001  PAYMENT_FAILED         payout rejected → REFUNDED (refund.status awaiting_destination)
     +237 670 100 002  MANUAL_REVIEW          held for an operator after the inbound
     +237 670 200 003  INSUFFICIENT_LIQUIDITY 503 at creation
     +237 670 300 004  PROVIDER_UNAVAILABLE   503 at creation
     +237 670 400 005  PAYMENT_TIMEOUT        the instruction expires in 60 s → EXPIRED
     +237 670 500 006  PAYMENT_DELAYED        completes ~20 s after payment (slow rail)
   (The numbers are two digits apart on purpose: numbers one digit apart trip the
   wrong-person guard, which is a different rehearsal — see recipient_unverified.)
     any other valid number  PAYMENT_SUCCESS
   QUOTE_EXPIRED, DUPLICATE_PAYMENT and INVALID_RECIPIENT need no number: use an expired
   quote, a reused Idempotency-Key, an invalid phone.
   ============================================================ */
import type { Payment } from "../../../../shared/types.js";
import { simulatePayoutOutcome } from "../../adapters/peexit.js";
import { store } from "../../db/store.js";

export type Scenario = "PAYMENT_SUCCESS" | "PAYMENT_FAILED" | "MANUAL_REVIEW" | "INSUFFICIENT_LIQUIDITY" | "PROVIDER_UNAVAILABLE" | "PAYMENT_TIMEOUT" | "PAYMENT_DELAYED";
const BY_NUMBER: Record<string, Scenario> = { "670000001": "PAYMENT_FAILED", "670100002": "MANUAL_REVIEW", "670200003": "INSUFFICIENT_LIQUIDITY", "670300004": "PROVIDER_UNAVAILABLE", "670400005": "PAYMENT_TIMEOUT", "670500006": "PAYMENT_DELAYED" };
export const SCENARIO_NUMBERS = Object.entries(BY_NUMBER).map(([local, scenario]) => ({ phone: `+237${local}`, scenario }));
export function scenarioOf(local: string): Scenario { return BY_NUMBER[local] ?? "PAYMENT_SUCCESS"; }

const delayed = new Set<string>();
export const isDelayed = (paymentId: string) => delayed.has(paymentId);

/** Apply the scenario to a freshly created payment (test environment only). */
export async function applyScenario(p: Payment, scenario: Scenario): Promise<void> {
  switch (scenario) {
    case "PAYMENT_FAILED": simulatePayoutOutcome(p.ref, "reject"); simulatePayoutOutcome(`${p.ref}:r2`, "reject"); simulatePayoutOutcome(`${p.ref}:r3`, "reject"); break;
    case "MANUAL_REVIEW": p.complianceFlags = [...(p.complianceFlags ?? []), "sandbox scenario: manual review"]; await store().putPayment(p); break;
    case "PAYMENT_TIMEOUT": p.payInstruction.expiresAt = new Date(Date.now() + 60_000).toISOString(); await store().putPayment(p); break;
    case "PAYMENT_DELAYED": delayed.add(p.id); break;
    default: break;
  }
}
