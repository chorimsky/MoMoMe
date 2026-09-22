/* MoMo›Me Connect — wiring to the engine: an engine transition drives the intent that minted
   the payment, which drives its invoice. Registered once at boot. */
import { onTransition } from "../stateMachine.js";
import { onEnginePayment, intentOfPayment, expireIntents, syncCollections, getIntent } from "./intents.js";
import { syncInvoice } from "./invoices.js";
import { reconcilePayouts, getPayout } from "./payouts.js";
import { settlementTick, onSettlementChange } from "./settlements.js";
import { setSettlement } from "./intents.js";
let installed = false;
export function installConnectHooks(): void {
  if (installed) return; installed = true;
  onTransition((p) => { onEnginePayment(p); const i = intentOfPayment(p.id); if (i) syncInvoice(i); });
  onSettlementChange((s) => { const i = getIntent(s.intentId); if (!i) return; const map = { pending: "pending", processing: "processing", submitted: "processing", settled: "settled", failed: "failed", reversed: "reversed" } as const; setSettlement(i, map[s.status]); });
}
/** Job tick: expire unfunded intents, re-query processing payouts. */
export async function connectTick(): Promise<void> { expireIntents(); syncCollections(); await reconcilePayouts(); await settlementTick((id) => { const p = getPayout(id); return p ? { status: p.status, providerRef: p.providerRef, failureReason: p.failureReason } : undefined; }); }
export { getIntent };
