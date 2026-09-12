/* ============================================================
   Payment events — every provider callback, normalised and written down.

   The rails already verify signatures and the settlement engine already dedupes deposits
   by provider event id (Payment.inboundEventIds). What was missing is the RECORD: which
   provider said what, when, whether we accepted it, and which payment it touched — with
   the raw payload reduced to a hash so an operator can prove "we received this" without a
   store full of provider bodies. Duplicates are recognised by (provider, payload hash).
   ============================================================ */
import { createHash } from "node:crypto";
import type { PaymentEvent } from "../../../../shared/interop.js";
import { register, touch } from "../persist.js";
import { id } from "../ids.js";

const CAP = 2000;
const events: PaymentEvent[] = [];
const seen = new Map<string, string>(); // `${provider}:${hash}` → event id
register("interop_events", () => events.slice(0, CAP), (d: PaymentEvent[]) => { events.length = 0; events.push(...(d ?? [])); for (const e of events) seen.set(`${e.provider}:${e.payloadHash}`, e.id); });

export const payloadHash = (raw: string): string => createHash("sha256").update(raw).digest("hex");

/** Record an inbound event. Returns the record and whether this exact payload was seen before. */
export function recordEvent(input: { provider: string; eventType: string; rawBody: string; providerReference?: string | null; paymentId?: string | null; status: PaymentEvent["status"]; detail?: string }): { event: PaymentEvent; duplicate: boolean } {
  const hash = payloadHash(input.rawBody);
  const key = `${input.provider}:${hash}`;
  const duplicate = seen.has(key) && input.status !== "rejected";
  const ev: PaymentEvent = {
    id: id("evt"), provider: input.provider, eventType: input.eventType, providerReference: input.providerReference ?? null,
    paymentId: input.paymentId ?? null, payloadHash: hash, receivedAt: new Date().toISOString(), processedAt: null,
    status: duplicate ? "duplicate" : input.status, detail: input.detail,
  };
  events.unshift(ev);
  if (events.length > CAP) events.length = CAP;
  if (!duplicate) seen.set(key, ev.id);
  touch("interop_events");
  return { event: ev, duplicate };
}
export function markProcessed(eventId: string, paymentId?: string | null, detail?: string): void {
  const e = events.find((x) => x.id === eventId);
  if (!e) return;
  e.processedAt = new Date().toISOString(); e.status = "processed";
  if (paymentId) e.paymentId = paymentId;
  if (detail) e.detail = detail;
  touch("interop_events");
}
export function listEvents(limit = 200, provider?: string): PaymentEvent[] {
  return (provider ? events.filter((e) => e.provider === provider) : events).slice(0, limit);
}
export function eventStats(): { total: number; byStatus: Record<string, number>; byProvider: Record<string, number>; last24hRejected: number } {
  const byStatus: Record<string, number> = {}; const byProvider: Record<string, number> = {};
  const dayAgo = Date.now() - 24 * 3600_000;
  let rejected = 0;
  for (const e of events) {
    byStatus[e.status] = (byStatus[e.status] ?? 0) + 1;
    byProvider[e.provider] = (byProvider[e.provider] ?? 0) + 1;
    if (e.status === "rejected" && Date.parse(e.receivedAt) > dayAgo) rejected++;
  }
  return { total: events.length, byStatus, byProvider, last24hRejected: rejected };
}
