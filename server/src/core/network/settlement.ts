/* ============================================================
   Lightning settlement abstraction (§12, §13, §25, §38, §39, PHASE 5).

   One interface over every way the settlement leg can be carried, using open standards
   only (Lightning Address / LNURL-pay, BOLT11; BOLT12 when the rails support it):

   · partner_address  — a destination partner's Lightning Address (Model B, DIRECT_PARTNER):
                        paid through the production IBEX adapter's payLightningAddress —
                        the same code the MoMo↔MoMo product uses to pay foreign addresses.
   · pool_internal    — the network's own position (Model A, MOMOME_LIQUIDITY): value moves
                        between the source pool and the destination pool on the network
                        ledger; when both pools run their own nodes an on-Lightning hop is
                        added here without touching anything else.
   · simulated        — sandbox rehearsal, never touches a rail.

   The saga calls settle() once per transaction with an idempotency key and treats the
   result as durable; a retry with the same key returns the recorded result.
   ============================================================ */
import type { LiquiditySource } from "../../../../shared/network.js";
import * as ibex from "../../adapters/ibex.js";
import { ibexConfigured } from "../../config.js";
import { getSettings } from "../settings.js";

export interface SettlementRequest { idempotencyKey: string; sats: number; lightningSource: LiquiditySource; destination: LiquiditySource; memo: string }
export interface SettlementResult { ok: boolean; settlementId: string; method: "partner_address" | "pool_internal" | "simulated"; feesSats: number; latencyMs: number; error?: string }

const done = new Map<string, SettlementResult>();
/** Test seam: fail the next settlement with this key (§50 "Lightning failure"). */
const failNext = new Set<string>();
export function simulateLightningFailure(key: string): void { failNext.add(key); }

export async function settle(req: SettlementRequest): Promise<SettlementResult> {
  const prior = done.get(req.idempotencyKey);
  if (prior) return prior;
  const t0 = Date.now();
  const n = getSettings().network;
  let out: SettlementResult;
  if (failNext.delete(req.idempotencyKey)) {
    out = { ok: false, settlementId: "", method: "simulated", feesSats: 0, latencyMs: 0, error: "simulated Lightning failure" };
  } else if (req.destination.kind === "partner") {
    const p = n.partners.find((x) => `${x.market.toLowerCase()}:partner:${x.id}` === req.destination.id);
    if (!p) out = { ok: false, settlementId: "", method: "partner_address", feesSats: 0, latencyMs: 0, error: "partner not found" };
    else if (!ibexConfigured() || !n.flags.LIGHTNING_SETTLEMENT_V2) {
      // Rehearsal: the leg is recorded, no sats leave.
      out = { ok: true, settlementId: `sim_ln_${req.idempotencyKey}`, method: "simulated", feesSats: Math.ceil(req.sats * 0.0005), latencyMs: Date.now() - t0 };
    } else {
      try {
        const r = await ibex.payLightningAddress(p.lightningAddress, req.sats * 1000);
        out = { ok: true, settlementId: r.transactionId, method: "partner_address", feesSats: Math.round((r.feesMsat ?? 0) / 1000), latencyMs: Date.now() - t0 };
      } catch (e) { out = { ok: false, settlementId: "", method: "partner_address", feesSats: 0, latencyMs: Date.now() - t0, error: e instanceof Error ? e.message : "lightning failed" }; }
    }
  } else {
    // The network's own position: a ledger movement between pools. A real hop between two
    // MomoMe nodes would be added here (payInvoice against the destination node's invoice).
    out = { ok: true, settlementId: `pool_${req.idempotencyKey}`, method: ibexConfigured() && n.flags.LIGHTNING_SETTLEMENT_V2 ? "pool_internal" : "simulated", feesSats: 0, latencyMs: Date.now() - t0 };
  }
  done.set(req.idempotencyKey, out);
  return out;
}
