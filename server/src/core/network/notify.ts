/* ============================================================
   Network notifications (§49) — the same outbox, kinds and channels as the live engine
   (core/notifications): the sender is reachable by push (the account IS the device), the
   operator in the console. Each message is sent once per transaction and state.
   ============================================================ */
import type { NetworkTransaction } from "../../../../shared/network.js";
import { notify } from "../notifications.js";
import { pushTokenFor } from "../pushTokens.js";
import { getIntent } from "./saga.js";

const sent = new Set<string>();
const once = (t: NetworkTransaction, what: string): boolean => { const k = `${t.id}:${what}`; if (sent.has(k)) return false; sent.add(k); return true; };
const nf = (n: number) => Math.round(n).toLocaleString("fr-FR").replace(/ |,/g, " ");
const owner = (t: NetworkTransaction) => getIntent(t.intentId)?.owner;
const lang = (t: NetworkTransaction): "en" | "fr" => { const o = owner(t); return (o && pushTokenFor(o)?.lang) || "en"; };
const who = (t: NetworkTransaction) => t.destination.name || `${t.destination.provider} +${t.destination.phone}`;

/** Delivered — the one message that most needs to exist. */
export async function networkDelivered(t: NetworkTransaction): Promise<void> {
  if (t.shadow || !once(t, "delivered")) return;
  const o = owner(t); if (!o) return;
  const fr = lang(t) === "fr";
  await notify({ kind: "transfer_delivered", audience: "sender", to: o, paymentRef: t.ref,
    body: fr ? `Livré ✓\n${nf(t.destination.amount)} ${t.destination.currency} livrés à ${who(t)} · Réf ${t.ref}` : `Delivered ✓\n${nf(t.destination.amount)} ${t.destination.currency} delivered to ${who(t)} · Ref ${t.ref}` }).catch(() => {});
}

/** Nothing reached the recipient and the payer's money is coming back. */
export async function networkRefunding(t: NetworkTransaction, reason: string): Promise<void> {
  if (t.shadow || !once(t, "refunding")) return;
  await notify({ kind: "transfer_failed", audience: "operator", paymentRef: t.ref,
    body: `${t.ref}: ${t.corridor} ${nf(t.source.amount)} ${t.source.currency} → ${who(t)} not delivered — ${reason}. Refund of ${nf(t.source.amount)} ${t.source.currency} owed to +${t.source.phone}${t.refs.refundPayoutId ? " (automatic refund submitted)" : " — Admin → Interoperability → Transactions"}.` }).catch(() => {});
  const o = owner(t); if (!o) return;
  const fr = lang(t) === "fr";
  await notify({ kind: "transfer_failed", audience: "sender", to: o, paymentRef: t.ref,
    body: fr ? `Non livré — remboursement\n${nf(t.source.amount)} XAF pour ${who(t)} n'a pas pu être livré. Vous êtes remboursé sur votre Mobile Money · Réf ${t.ref}` : `Not delivered — refunding you\n${nf(t.source.amount)} XAF for ${who(t)} could not be delivered. It is being returned to your Mobile Money · Ref ${t.ref}` }).catch(() => {});
}

/** Refunded — closed, and the payer should hear it. */
export async function networkRefunded(t: NetworkTransaction): Promise<void> {
  if (t.shadow || !once(t, "refunded")) return;
  const o = owner(t); if (!o) return;
  const fr = lang(t) === "fr";
  await notify({ kind: "transfer_failed", audience: "sender", to: o, paymentRef: t.ref,
    body: fr ? `Remboursé ✓\n${nf(t.source.amount)} XAF sont revenus sur votre Mobile Money · Réf ${t.ref}` : `Refunded ✓\n${nf(t.source.amount)} XAF is back on your Mobile Money · Ref ${t.ref}` }).catch(() => {});
}

/** Money moved and a person must decide — the operator, at once; the sender, gently. */
export async function networkNeedsPerson(t: NetworkTransaction, reason: string): Promise<void> {
  if (t.shadow || !once(t, `person:${t.state}`)) return;
  await notify({ kind: "manual_review", audience: "operator", paymentRef: t.ref,
    body: `${t.ref}: ${t.corridor} ${nf(t.source.amount)} ${t.source.currency} → ${who(t)} is in ${t.state} — ${reason}. Admin → Interoperability → Transactions (retry / alternate provider / manual / refund).` }).catch(() => {});
  const o = owner(t); if (!o) return;
  const fr = lang(t) === "fr";
  await notify({ kind: "manual_review", audience: "sender", to: o, paymentRef: t.ref,
    body: fr ? `Livraison en cours de vérification\n${nf(t.destination.amount)} ${t.destination.currency} pour ${who(t)} est vérifié par notre équipe · Réf ${t.ref}` : `Delivery being checked\n${nf(t.destination.amount)} ${t.destination.currency} for ${who(t)} is being checked by our team · Ref ${t.ref}` }).catch(() => {});
}

/** Liquidity at or under the floor — before it stops payments, not after. */
const lowSent = new Map<string, number>();
export async function networkLowLiquidity(alerts: Array<{ sourceId: string; available: number; floor: number }>): Promise<void> {
  const now = Date.now();
  for (const a of alerts) {
    const last = lowSent.get(a.sourceId) ?? 0;
    if (now - last < 6 * 60 * 60_000) continue; // once per six hours per source
    lowSent.set(a.sourceId, now);
    await notify({ kind: "reconciliation_mismatch", audience: "operator",
      body: `Low liquidity: ${a.sourceId} has ${nf(a.available)} available (floor ${nf(a.floor)}). Top up before the corridor starts refusing payments — Admin → Interoperability → Liquidity.` }).catch(() => {});
  }
}
