/* ============================================================
   API v1 — per-organization audit trail.
   Every credential use that changes state, every dashboard action and every operator
   action on an organization is one immutable event: actor, ip, request id, what, on
   which object. Kept to the last 5 000 per deployment in the snapshot (older rows are
   exported by the usage/billing jobs before they age out).
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";

export interface AuditEvent {
  id: string; at: string; orgId?: string;
  actor: { type: "credential" | "user" | "operator" | "system"; id: string; label?: string };
  action: string;            // "credential.created", "payment.created", "webhook.replayed" …
  target?: { type: string; id: string };
  ip?: string; requestId?: string;
  details?: Record<string, unknown>;
}

const events: AuditEvent[] = [];
const CAP = 5000;
register("platform_audit", () => events.slice(-CAP), (d: AuditEvent[]) => { events.length = 0; events.push(...d); });

export function audit(e: Omit<AuditEvent, "id" | "at">): AuditEvent {
  const ev: AuditEvent = { id: `aud_${crypto.randomBytes(6).toString("hex")}`, at: new Date().toISOString(), ...e };
  events.push(ev);
  if (events.length > CAP * 1.2) events.splice(0, events.length - CAP);
  touch("platform_audit");
  return ev;
}
export function auditOf(orgId: string, limit = 100): AuditEvent[] { return events.filter((e) => e.orgId === orgId).slice(-limit).reverse(); }
export function auditAll(limit = 200): AuditEvent[] { return events.slice(-limit).reverse(); }
