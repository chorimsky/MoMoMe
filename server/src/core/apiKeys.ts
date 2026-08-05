/* ============================================================
   Developer / partner API keys (settlement-as-a-service).

   A partner authenticates with a secret key (`Authorization: Bearer mk_…` or
   `X-API-Key`). Only a SHA-256 hash is stored — the plaintext is shown once at
   creation and never again. A valid key resolves the request "owner" to
   `key:<id>`, so a partner's payments are attributed to and visible only to them
   (same isolation the device-sender model gives app users). See the /developers
   docs + GET /api/openapi.json.
   ============================================================ */
import crypto from "node:crypto";
import type { ApiKey } from "../../../shared/types.js";
import { register, touch } from "./persist.js";

interface StoredKey extends ApiKey { hash: string }

const keys = new Map<string, StoredKey>(); // id -> key

register(
  "apikeys",
  () => [...keys.values()],
  (data: StoredKey[]) => { for (const k of data) keys.set(k.id, k); },
);

const hash = (plain: string) => crypto.createHash("sha256").update(plain).digest("hex");
const publicView = ({ hash: _h, ...k }: StoredKey): ApiKey => k;

/** Mint a new key. Returns the record + the ONE-TIME plaintext (never stored). */
export function createApiKey(label: string): { key: ApiKey; secret: string } {
  const id = `key_${crypto.randomBytes(8).toString("hex")}`;
  const secret = `mk_${crypto.randomBytes(24).toString("hex")}`; // 48 hex chars of entropy
  const rec: StoredKey = {
    id, label: label.slice(0, 80) || "Untitled key",
    prefix: secret.slice(0, 11), // "mk_" + 8
    createdAt: new Date().toISOString(),
    hash: hash(secret),
  };
  keys.set(id, rec);
  touch("apikeys");
  return { key: publicView(rec), secret };
}

export function listApiKeys(): ApiKey[] {
  return [...keys.values()].map(publicView).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function revokeApiKey(id: string): boolean {
  const k = keys.get(id);
  if (!k || k.revokedAt) return false;
  k.revokedAt = new Date().toISOString();
  touch("apikeys");
  return true;
}

/** Validate a presented secret. Returns the owning key id (`key:<id>`) or null.
 *  Constant-time compare against each active key's hash; stamps lastUsedAt. */
export function verifyApiKey(secret: string | undefined): string | null {
  if (!secret || !secret.startsWith("mk_")) return null;
  const h = Buffer.from(hash(secret), "hex");
  for (const k of keys.values()) {
    if (k.revokedAt) continue;
    const kh = Buffer.from(k.hash, "hex");
    if (kh.length === h.length && crypto.timingSafeEqual(kh, h)) {
      k.lastUsedAt = new Date().toISOString();
      touch("apikeys");
      return `key:${k.id}`;
    }
  }
  return null;
}
