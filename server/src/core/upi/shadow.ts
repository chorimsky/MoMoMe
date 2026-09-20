/* Shadow from V1 traffic. The routing engine has to be judged against real payments, not
   against intents nobody creates yet: every V1 payment that is minted (the sender chose a
   method on the Method step) becomes a shadow intent — identity resolved from the cache,
   quoted, routed with the sender's choice as "what V1 did" — linked to the V1 payment so
   its lifecycle is mirrored and reconciled. Fire-and-forget: it can never slow or fail a
   payment, and it executes nothing. On while UNIVERSAL_PAYMENT_IDENTITY_ENABLED; the mode
   is SHADOW by definition here. */
import type { Payment } from "../../../../shared/types.js";
import { createIntent, selectRouteFor, linkIntentToV1 } from "./intents.js";
import { flag } from "./flags.js";
import { COUNTRIES } from "../../../../shared/domain.js";

const inflight = new Set<string>();
export function shadowFromV1(p: Payment, owner: string | undefined): void {
  if (!flag("UNIVERSAL_PAYMENT_IDENTITY_ENABLED")) return;
  if (p.source === "lnurl" || p.merchantId || inflight.has(p.id)) return;
  inflight.add(p.id);
  void (async () => {
    try {
      const dial = COUNTRIES[p.recipient.country]?.dial ?? "+237";
      const i = await createIntent({ owner: owner ?? p.senderId ?? "v1", identity: `${dial}${p.recipient.phone}`, amount: p.xaf, currency: "XAF", correlationId: `v1:${p.ref}`, feePct: p.xaf > 0 ? p.feeXaf / p.xaf : null, live: false });
      if (i.state === "QUOTED") {
        const asset = p.method === "LIGHTNING" ? undefined : p.method === "ONCHAIN" ? "BTC" : p.method;
        await selectRouteFor(i, { rail: p.method === "LIGHTNING" || p.method === "ONCHAIN" ? "LIGHTNING" : "STABLECOIN", asset }).catch(() => null);
      }
      linkIntentToV1(i, p);
    } catch { /* shadow only */ } finally { inflight.delete(p.id); }
  })();
}
