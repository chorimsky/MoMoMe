/* Long-poll for a payment's next state change. A client that used to ask "anything new?"
   every 1–6 s now asks once and is answered the moment the state machine moves (or after
   the timeout with the current record). Same answer as GET /payments/:id, ten times fewer
   requests, and the sender sees "paid" the second the webhook lands rather than on the next
   tick. In-process: this service runs one API replica; a second replica would simply fall
   back to the timeout, still correct. */
import type { Payment } from "../../../shared/types.js";

type Waiter = { resolve: (p: Payment | null) => void; timer: ReturnType<typeof setTimeout> };
const waiters = new Map<string, Set<Waiter>>();

/** Called by the state machine on every transition. */
export function notifyPaymentChanged(p: Payment): void {
  const set = waiters.get(p.id);
  if (!set) return;
  waiters.delete(p.id);
  for (const w of set) { clearTimeout(w.timer); w.resolve(p); }
}
/** Resolve with the changed payment, or null when the timeout passes first. */
export function waitForPaymentChange(paymentId: string, timeoutMs: number): Promise<Payment | null> {
  return new Promise((resolve) => {
    const w: Waiter = { resolve, timer: setTimeout(() => { waiters.get(paymentId)?.delete(w); if (waiters.get(paymentId)?.size === 0) waiters.delete(paymentId); resolve(null); }, timeoutMs) };
    if (!waiters.has(paymentId)) waiters.set(paymentId, new Set());
    waiters.get(paymentId)!.add(w);
  });
}
export const waitersCount = (): number => [...waiters.values()].reduce((n, s) => n + s.size, 0);
