/* ============================================================
   API v1 — what follows an engine transition for a payment created through /v1:
     • the liquidity reservation is consumed at COMPLETED, released at any other end;
     • usage is metered (completed / failed, volume, fees);
     • the typed webhook event is projected (outbound.ts announces it once per state).
   Registered once at boot (installPlatformHooks). Read-only on the Payment.
   ============================================================ */
import type { Payment } from "../../../../shared/types.js";
import { onTransition } from "../stateMachine.js";
import { setV1Projector } from "../interop/outbound.js";
import { metaOf, updateMeta } from "./paymentMeta.js";
import { consume, release } from "./liquidity.js";
import { meterOutcome } from "./usage.js";
import { publicState, publicPayment, eventTypeFor, TERMINAL } from "./mapping.js";

let installed = false;
export function installPlatformHooks(): void {
  if (installed) return; installed = true;
  setV1Projector((p: Payment) => {
    if (!metaOf(p.id)) return null; // not an API v1 payment — the legacy payment.status event still goes out
    const state = publicState(p);
    return { state, type: eventTypeFor(state), data: publicPayment(p) };
  });
  onTransition((p: Payment) => {
    const m = metaOf(p.id); if (!m) return;
    const state = publicState(p);
    if (m.lastPublicState === state) return;
    updateMeta(p.id, { lastPublicState: state });
    if (state === "COMPLETED") { if (m.reservationId) consume(m.reservationId); meterOutcome(m.orgId, m.env, "completed", p.xaf, p.feeXaf); }
    else if (TERMINAL.includes(state)) { if (m.reservationId) release(m.reservationId, state.toLowerCase()); meterOutcome(m.orgId, m.env, "failed", p.xaf, p.feeXaf); }
  });
}
