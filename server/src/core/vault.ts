/* ============================================================
   Encrypted contact vault (server side — zero-knowledge).

   The server stores opaque ciphertext blobs and NEVER sees contact
   contents. Each record is owned by an anonymous sender/device id
   (X-MM-Sender today; a device-account id later) and carries only the
   fields needed for delta sync + tombstoning. All encryption/decryption
   happens on the device. See docs/device-account-and-contacts.md.
   ============================================================ */
import type { VaultRecord } from "../../../shared/types.js";
import { register, touch } from "./persist.js";

/** Server row = the shared VaultRecord plus the owning device/sender id. */
interface Row extends VaultRecord {
  owner: string;
}

// owner -> (recordId -> Row)
const byOwner = new Map<string, Map<string, Row>>();

register(
  "vault",
  () => {
    const out: Array<[string, Row[]]> = [];
    for (const [owner, recs] of byOwner) out.push([owner, [...recs.values()]]);
    return out;
  },
  (data: Array<[string, Row[]]>) => {
    for (const [owner, recs] of data) {
      const m = new Map<string, Row>();
      for (const r of recs) m.set(r.recordId, r);
      byOwner.set(owner, m);
    }
  },
);

function ownerMap(owner: string): Map<string, Row> {
  let m = byOwner.get(owner);
  if (!m) { m = new Map(); byOwner.set(owner, m); }
  return m;
}

/** Public projection (drop the internal `owner`). */
function toRecord({ owner: _owner, ...rec }: Row): VaultRecord {
  return rec;
}

/**
 * List an owner's records changed since an ISO cursor (inclusive of tombstones,
 * so other devices learn about deletes). Omit `since` for a full pull.
 */
export function listVault(owner: string, since?: string): VaultRecord[] {
  const m = byOwner.get(owner);
  if (!m) return [];
  const out: VaultRecord[] = [];
  for (const row of m.values()) {
    if (since && row.updatedAt <= since) continue;
    out.push(toRecord(row));
  }
  return out.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

/**
 * Upsert one ciphertext record. The server assigns `updatedAt` (authoritative
 * clock for sync) and never trusts the client's timestamp. Returns the stored
 * record so the client can reconcile its sync cursor.
 */
export function upsertVault(
  owner: string,
  input: { recordId: string; ciphertext: string; iv: string; ver: number },
): VaultRecord {
  const m = ownerMap(owner);
  const row: Row = {
    owner,
    recordId: input.recordId,
    ciphertext: input.ciphertext,
    iv: input.iv,
    ver: input.ver,
    updatedAt: new Date().toISOString(),
    deleted: false,
  };
  m.set(row.recordId, row);
  touch("vault");
  return toRecord(row);
}

/**
 * Tombstone a record (keep the id + a fresh updatedAt so peer devices sync the
 * delete). The ciphertext is cleared — nothing sensitive lingers server-side.
 */
export function deleteVault(owner: string, recordId: string): VaultRecord | null {
  const m = byOwner.get(owner);
  const existing = m?.get(recordId);
  if (!m || !existing) return null;
  const row: Row = { ...existing, ciphertext: "", iv: "", deleted: true, updatedAt: new Date().toISOString() };
  m.set(recordId, row);
  touch("vault");
  return toRecord(row);
}

/** Re-attribute a device's vault to a new owner id (used by identity migration). */
export function reassignVault(fromOwner: string, toOwner: string): void {
  const from = byOwner.get(fromOwner);
  if (!from || fromOwner === toOwner) return;
  const to = ownerMap(toOwner);
  for (const [id, row] of from) to.set(id, { ...row, owner: toOwner });
  byOwner.delete(fromOwner);
  touch("vault");
}
