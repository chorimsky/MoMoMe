/* Audit trail + metrics. One row per request: who, why, which hash, which provider, what
   came back, how long. No raw number, no name. Bounded, persisted. */
import { register, touch } from "../persist.js";
import type { IdentityPurpose, IdentityStatus, IdentityErrorCode } from "../../../../shared/identity.js";

export interface IdentityAuditRow { requestId: string; correlationId?: string; actor: string; purpose: IdentityPurpose; identifierHash: string; country: string; operator: string | null; provider: string; status: IdentityStatus | "ERROR"; error?: IdentityErrorCode; latencyMs: number; cache: "hit" | "miss" | "bypass"; at: string }
const rows: IdentityAuditRow[] = [];
register("identity_audit", () => rows.slice(-5_000), (d: IdentityAuditRow[]) => { rows.length = 0; rows.push(...(d ?? [])); });

export const metrics = { total: 0, success: 0, failure: 0, provider_timeout: 0, not_found: 0, cache_hit: 0, cache_miss: 0, latencyMs: [] as number[], rate_limited: 0, unauthorized: 0 };
export function record(row: IdentityAuditRow): void {
  rows.push(row); if (rows.length > 5_000) rows.shift(); touch("identity_audit");
  metrics.total++;
  if (row.status === "VERIFIED") metrics.success++; else if (row.status === "ERROR" || row.status === "PROVIDER_UNAVAILABLE" || row.status === "VERIFICATION_FAILED") metrics.failure++;
  if (row.error === "IDENTITY_PROVIDER_TIMEOUT") metrics.provider_timeout++;
  if (row.status === "NOT_FOUND") metrics.not_found++;
  if (row.cache === "hit") metrics.cache_hit++; else if (row.cache === "miss") metrics.cache_miss++;
  metrics.latencyMs.push(row.latencyMs); if (metrics.latencyMs.length > 1_000) metrics.latencyMs.shift();
}
export const auditRows = (limit = 200) => rows.slice(-limit).reverse();
export function metricsSnapshot() {
  const l = [...metrics.latencyMs].sort((a, b) => a - b);
  return { identity_resolution_total: metrics.total, identity_resolution_success: metrics.success, identity_resolution_failure: metrics.failure, identity_resolution_provider_timeout: metrics.provider_timeout, identity_resolution_not_found: metrics.not_found, identity_resolution_cache_hit: metrics.cache_hit, identity_resolution_cache_miss: metrics.cache_miss, identity_resolution_rate_limited: metrics.rate_limited, identity_resolution_unauthorized: metrics.unauthorized, identity_resolution_latency: { p50: l[Math.floor(l.length / 2)] ?? null, p95: l[Math.floor(l.length * 0.95)] ?? null, n: l.length } };
}
/** One rule for every name-disclosing surface (V1 /recipients/resolve, /v2/identity): a
 *  device may look up IDENTITY_MAX_DISTINCT_PER_HOUR different numbers an hour, an address
 *  IDENTITY_MAX_DISTINCT_PER_HOUR_IP (default 4×, several people share a mobile IP). Devices
 *  are free to enrol, so the per-IP ceiling is what stops a script farming names. */
export function identityEnumerationExceeded(actor: string, ip: string | undefined, hash: string, now = Date.now()): boolean {
  const perActor = Math.max(5, Number(process.env.IDENTITY_MAX_DISTINCT_PER_HOUR ?? 60) || 60);
  const perIp = Math.max(perActor, Number(process.env.IDENTITY_MAX_DISTINCT_PER_HOUR_IP ?? perActor * 4) || perActor * 4);
  const a = distinctPerHour(actor, hash, now) > perActor;
  const i = ip ? distinctPerHour(`ip:${ip}`, hash, now) > perIp : false;
  if (a || i) metrics.rate_limited++;
  return a || i;
}
/** Abuse detection: distinct identifiers per actor per hour. */
const seen = new Map<string, { hashes: Set<string>; since: number }>();
export function distinctPerHour(actor: string, hash: string, now = Date.now()): number {
  let e = seen.get(actor);
  if (!e || now - e.since > 3_600_000) { e = { hashes: new Set(), since: now }; seen.set(actor, e); }
  e.hashes.add(hash);
  if (seen.size > 50_000) seen.clear();
  return e.hashes.size;
}

/** What the last `hours` looked like, from the PERSISTED rows — the process counters above
 *  reset on every deploy, which made the console read "0 lookups" after a restart. */
export function windowStats(hours = 24, now = Date.now()) {
  const since = now - hours * 3_600_000;
  const w = rows.filter((r) => Date.parse(r.at) >= since);
  const lat = w.map((r) => r.latencyMs).sort((a, b) => a - b);
  const count = (f: (r: IdentityAuditRow) => boolean) => w.filter(f).length;
  const byProvider: Record<string, { total: number; verified: number; failed: number }> = {};
  for (const r of w) {
    const b = (byProvider[r.provider] ??= { total: 0, verified: 0, failed: 0 });
    b.total++; if (r.status === "VERIFIED") b.verified++; if (r.status === "PROVIDER_UNAVAILABLE" || r.status === "ERROR") b.failed++;
  }
  return {
    hours, total: w.length, verified: count((r) => r.status === "VERIFIED"), notFound: count((r) => r.status === "NOT_FOUND"), inactive: count((r) => r.status === "INACTIVE"),
    unavailable: count((r) => r.status === "PROVIDER_UNAVAILABLE" || r.status === "ERROR"), timeouts: count((r) => r.error === "IDENTITY_PROVIDER_TIMEOUT"),
    unknown: count((r) => r.status === "UNKNOWN" || r.status === "UNSUPPORTED"), cacheHits: count((r) => r.cache === "hit"),
    latency: { p50: lat[Math.floor(lat.length / 2)] ?? null, p95: lat[Math.floor(lat.length * 0.95)] ?? null }, byProvider,
  };
}
