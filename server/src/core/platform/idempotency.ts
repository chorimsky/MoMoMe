/* ============================================================
   API v1 — Idempotency-Key.

   Required on every state-changing /v1 endpoint. Persisted per organization + endpoint +
   key: the request FINGERPRINT (sha256 of method, path and canonical body) and, once the
   handler answered, the response (status + body). Rules:
     • same key, same fingerprint, response stored → replay the stored response;
     • same key, different fingerprint → 409 idempotency_key_reused (never execute);
     • same key, in flight (no response yet) → 409 idempotency_in_progress — a retry that
       overtakes the original must not run the handler a second time.
   Records expire after 24 h (IDEMPOTENCY_TTL_H). Keys are 1–255 printable characters.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";

export interface IdemRecord { orgId: string; env: string; endpoint: string; key: string; fingerprint: string; createdAt: string; expiresAt: string; response?: { status: number; body: unknown }; requestId: string }

const TTL_MS = Number(process.env.IDEMPOTENCY_TTL_H ?? 24) * 3_600_000;
const records = new Map<string, IdemRecord>();
register("platform_idempotency", () => [...records.values()].filter((r) => Date.parse(r.expiresAt) > Date.now()), (d: IdemRecord[]) => { for (const r of d) records.set(recKey(r.orgId, r.env, r.endpoint, r.key), r); });

const recKey = (orgId: string, env: string, endpoint: string, key: string) => `${orgId}|${env}|${endpoint}|${key}`;
export const validKey = (k: unknown): k is string => typeof k === "string" && k.length >= 1 && k.length <= 255 && /^[\x21-\x7e]+$/.test(k);

const canonical = (v: unknown): string => {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v as Record<string, unknown>).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
};
export const fingerprint = (method: string, path: string, body: unknown) => crypto.createHash("sha256").update(`${method.toUpperCase()} ${path}\n${canonical(body ?? null)}`).digest("hex");

export type IdemBegin = { kind: "new" } | { kind: "replay"; response: { status: number; body: unknown } } | { kind: "mismatch" } | { kind: "in_progress" };

export function begin(orgId: string, env: string, endpoint: string, key: string, fp: string, requestId: string): IdemBegin {
  const k = recKey(orgId, env, endpoint, key);
  const ex = records.get(k);
  if (ex && Date.parse(ex.expiresAt) > Date.now()) {
    if (ex.fingerprint !== fp) return { kind: "mismatch" };
    if (!ex.response) return { kind: "in_progress" };
    return { kind: "replay", response: ex.response };
  }
  const at = Date.now();
  records.set(k, { orgId, env, endpoint, key, fingerprint: fp, createdAt: new Date(at).toISOString(), expiresAt: new Date(at + TTL_MS).toISOString(), requestId });
  touch("platform_idempotency");
  return { kind: "new" };
}
export function complete(orgId: string, env: string, endpoint: string, key: string, response: { status: number; body: unknown }): void {
  const r = records.get(recKey(orgId, env, endpoint, key)); if (!r) return;
  // A 5xx is not a durable answer — the client may retry and the handler should run again.
  if (response.status >= 500) { records.delete(recKey(orgId, env, endpoint, key)); touch("platform_idempotency"); return; }
  r.response = response; touch("platform_idempotency");
}
export function abandon(orgId: string, env: string, endpoint: string, key: string): void { if (records.delete(recKey(orgId, env, endpoint, key))) touch("platform_idempotency"); }
export function pruneIdempotency(): number { let n = 0; for (const [k, r] of records) if (Date.parse(r.expiresAt) <= Date.now()) { records.delete(k); n++; } if (n) touch("platform_idempotency"); return n; }
export function _resetIdempotency(): void { records.clear(); }
