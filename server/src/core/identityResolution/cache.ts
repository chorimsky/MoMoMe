/* Verification cache + the verified-identity record. Keyed by the identifier HASH; the
   raw number is never a key. TTL from IDENTITY_CACHE_TTL (seconds, default 300). Records
   are pruned past expiry + IDENTITY_RECORD_RETENTION_DAYS (default 30). Only VERIFIED /
   NOT_FOUND / INACTIVE answers are cached — never a provider outage. */
import type { IdentityResolution } from "../../../../shared/identity.js";
import { register, touch } from "../persist.js";

export interface IdentityRecord {
  id: string; identifierHash: string; identifierLast4: string; country: string; operator: string | null; currency: string | null;
  displayName?: string; verificationStatus: IdentityResolution["status"]; accountStatus: IdentityResolution["accountStatus"];
  provider: string; providerReference?: string; verifiedAt?: string; expiresAt: string; createdAt: string; updatedAt: string;
}
const TTL_SEC = () => Math.max(30, Number(process.env.IDENTITY_CACHE_TTL ?? 300) || 300);
const RETENTION_MS = () => Math.max(1, Number(process.env.IDENTITY_RECORD_RETENTION_DAYS ?? 30) || 30) * 86_400_000;

const records = new Map<string, IdentityRecord>();
register("identity_resolutions", () => [...records.values()].slice(-20_000), (d: IdentityRecord[]) => { for (const r of d ?? []) records.set(r.identifierHash, r); });

export const cacheTtlSec = TTL_SEC;
export function cached(hash: string, now = Date.now()): IdentityRecord | null {
  const r = records.get(hash);
  if (!r) return null;
  if (Date.parse(r.expiresAt) <= now) return null;
  return r;
}
export function remember(hash: string, last4: string, res: IdentityResolution, now = Date.now()): IdentityRecord {
  const prev = records.get(hash);
  const r: IdentityRecord = {
    id: prev?.id ?? `idr_${hash.slice(0, 12)}`, identifierHash: hash, identifierLast4: last4, country: res.country, operator: res.operator, currency: res.currency,
    displayName: res.displayName, verificationStatus: res.status, accountStatus: res.accountStatus, provider: res.provider.name, providerReference: res.provider.reference,
    verifiedAt: res.provider.verifiedAt, expiresAt: new Date(now + TTL_SEC() * 1000).toISOString(), createdAt: prev?.createdAt ?? new Date(now).toISOString(), updatedAt: new Date(now).toISOString(),
  };
  records.set(hash, r); touch("identity_resolutions");
  return r;
}
export function forget(hash: string): void { if (records.delete(hash)) touch("identity_resolutions"); }
/** Data minimisation: names do not live forever. */
export function pruneIdentityRecords(now = Date.now()): number {
  let n = 0;
  for (const [k, r] of records) if (Date.parse(r.expiresAt) + RETENTION_MS() < now) { records.delete(k); n++; }
  if (n) touch("identity_resolutions");
  return n;
}
export const recordCount = () => records.size;
