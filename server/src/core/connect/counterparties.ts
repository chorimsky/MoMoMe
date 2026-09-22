/* ============================================================
   MoMo›Me Connect — Counterparties (§32).
   Company A can invoice or pay Company B before B has any MoMo›Me presence: a counterparty is
   A's own record of B (name + how to reach it). When B later joins, `linkToMpi` attaches the
   counterparty to B's verified MPI; historical intents keep their counterparty id, so nothing
   is rewritten.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { findByAlias, normalizeAlias, type AliasType, type Mpi } from "./identities.js";
import type { CountryCode } from "../../../../shared/types.js";

export interface Counterparty {
  id: string; orgId: string; name: string; createdAt: string; updatedAt: string;
  contacts: Array<{ type: AliasType; value: string }>;
  linkedMpi?: string; linkedAt?: string; metadata?: Record<string, string>;
}
const rows = new Map<string, Counterparty>();
register("connect_counterparties", () => [...rows.values()], (d: Counterparty[]) => { for (const r of d) rows.set(r.id, r); });
const now = () => new Date().toISOString();

export function createCounterparty(orgId: string, input: { name: string; contacts: Array<{ type: AliasType; value: string }>; country?: CountryCode; metadata?: Record<string, string> }): { ok: true; counterparty: Counterparty } | { ok: false; error: string } {
  const contacts: Counterparty["contacts"] = [];
  for (const c of input.contacts) { const n = normalizeAlias(c.type, c.value, input.country ?? "CM"); if (!n) return { ok: false, error: `contact_invalid:${c.type}` }; contacts.push({ type: c.type, value: n }); }
  if (!input.name.trim()) return { ok: false, error: "name_required" };
  const cp: Counterparty = { id: `cp_${crypto.randomBytes(8).toString("hex")}`, orgId, name: input.name.trim().slice(0, 120), createdAt: now(), updatedAt: now(), contacts, metadata: input.metadata };
  // If one of the contacts already resolves to an MPI, link at once.
  const hit = resolveContacts(contacts, input.country); if (hit) { cp.linkedMpi = hit.id; cp.linkedAt = now(); }
  rows.set(cp.id, cp); touch("connect_counterparties");
  return { ok: true, counterparty: cp };
}
function resolveContacts(contacts: Counterparty["contacts"], country?: CountryCode): Mpi | undefined {
  for (const c of contacts) { const m = findByAlias(c.type, c.type === "phone" ? `+${c.value}` : c.value, country); if (m) return m; }
  return undefined;
}
export const getCounterparty = (id: string) => rows.get(id);
export const counterpartiesAll = () => [...rows.values()];
export const counterpartiesOf = (orgId: string) => [...rows.values()].filter((c) => c.orgId === orgId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
/** Attach a counterparty to a verified MPI (when the counterparty joins MoMo›Me). Idempotent. */
export function linkToMpi(id: string, mpi: Mpi): Counterparty | undefined { const cp = rows.get(id); if (!cp) return undefined; if (cp.linkedMpi !== mpi.id) { cp.linkedMpi = mpi.id; cp.linkedAt = now(); cp.updatedAt = now(); touch("connect_counterparties"); } return cp; }
/** Re-try linking every unlinked counterparty whose contacts now resolve (run when an MPI gains an alias). */
export function relinkCounterparties(): number { let n = 0; for (const cp of rows.values()) { if (cp.linkedMpi) continue; const m = resolveContacts(cp.contacts); if (m) { linkToMpi(cp.id, m); n++; } } return n; }
export function publicCounterparty(c: Counterparty) { return { id: c.id, object: "counterparty", name: c.name, contacts: c.contacts.map((x) => ({ type: x.type, value: x.type === "phone" ? `+${x.value}` : x.value })), linked_identity: c.linkedMpi ?? null, linked_at: c.linkedAt ?? null, metadata: c.metadata ?? {}, created_at: c.createdAt }; }
export function _resetCounterparties(): void { rows.clear(); }
