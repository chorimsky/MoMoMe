/* MoMo›Me Connect — wiring to the engine: an engine transition drives the intent that minted
   the payment, which drives its invoice. Registered once at boot. */
import { onTransition } from "../stateMachine.js";
import { onEnginePayment, intentOfPayment, expireIntents, syncCollections, getIntent } from "./intents.js";
import { syncInvoice } from "./invoices.js";
import { reconcilePayouts } from "./payouts.js";
let installed = false;
export function installConnectHooks(): void {
  if (installed) return; installed = true;
  onTransition((p) => { onEnginePayment(p); const i = intentOfPayment(p.id); if (i) syncInvoice(i); });
}
/** Job tick: expire unfunded intents, re-query processing payouts. */
export async function connectTick(): Promise<void> { expireIntents(); syncCollections(); await reconcilePayouts(); }
export { getIntent };
