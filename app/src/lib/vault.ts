/* ============================================================
   Encrypted contact vault (client side — the crypto seam).

   Contacts are encrypted on the device and synced to the server as
   opaque ciphertext (the server is zero-knowledge). Envelope:

     • DWK  — device wrapping key (AES-KW 256, NON-extractable, in IndexedDB).
              Never leaves the device; can't be exported even via XSS.
     • VMK  — vault master key (AES-GCM 256). Encrypts every contact record.
              Stored only as DWK-wrapped bytes at rest; unwrapped into memory
              (non-extractable) for use.
     • record = AES-256-GCM(VMK, JSON(Contact)) with a per-record 96-bit IV.

   Phase 1 = single device, scoped to today's X-MM-Sender id. Multi-device
   sync + phone-anchored recovery re-wrap the VMK later (see
   docs/device-account-and-contacts.md); nothing here needs to change for that.
   ============================================================ */
import type { Contact, VaultRecord, CountryCode, ProviderId } from "@shared/types.js";
import { idbGet, idbSet } from "./idb.js";
import { api } from "../api/client.js";

const DWK_KEY = "mm_vault_dwk"; // non-extractable AES-KW CryptoKey
const VMK_KEY = "mm_vault_vmk"; // wrapped VMK bytes (ArrayBuffer)
export const ENVELOPE_VER = 1;

let vmk: CryptoKey | null = null; // in-memory, non-extractable

/* ---- base64 helpers (records are small — no chunking needed) ---- */
function toB64(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function fromB64(s: string): ArrayBuffer {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function getDWK(): Promise<CryptoKey> {
  const existing = await idbGet<CryptoKey>(DWK_KEY);
  if (existing) return existing;
  const key = await crypto.subtle.generateKey({ name: "AES-KW", length: 256 }, false, ["wrapKey", "unwrapKey"]);
  await idbSet(DWK_KEY, key);
  return key;
}

/** Load or lazily create the vault key. Falls back to a session-only key if
 *  IndexedDB/WebCrypto is unavailable (private mode) — contacts then live only
 *  for the session rather than crashing the app. */
async function unlockVault(): Promise<CryptoKey> {
  if (vmk) return vmk;
  try {
    const dwk = await getDWK();
    const wrapped = await idbGet<ArrayBuffer>(VMK_KEY);
    if (wrapped) {
      vmk = await crypto.subtle.unwrapKey("raw", wrapped, dwk, "AES-KW", { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    } else {
      const fresh = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
      const wrappedBuf = await crypto.subtle.wrapKey("raw", fresh, dwk, "AES-KW");
      await idbSet(VMK_KEY, wrappedBuf);
      const raw = await crypto.subtle.exportKey("raw", fresh);
      vmk = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    }
  } catch {
    // No persistent storage — degrade to an ephemeral in-memory key.
    vmk = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  return vmk;
}

async function encryptContact(c: Contact): Promise<{ ciphertext: string; iv: string }> {
  const key = await unlockVault();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify(c));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, data);
  return { ciphertext: toB64(ct), iv: toB64(iv.buffer) };
}

async function decryptRecord(r: VaultRecord): Promise<Contact | null> {
  try {
    const key = await unlockVault();
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(r.iv) }, key, fromB64(r.ciphertext));
    return JSON.parse(new TextDecoder().decode(pt)) as Contact;
  } catch {
    return null; // wrong key (another device's record) or corrupt — skip it
  }
}

/** Favorites first, then most-recently-paid/updated. */
function byPriority(a: Contact, b: Contact): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  return (b.lastPaidAt ?? b.updatedAt).localeCompare(a.lastPaidAt ?? a.updatedAt);
}

/* ---------- public API ---------- */

export function newContact(input: {
  name: string; phone: string; country: CountryCode; provider: ProviderId;
  note?: string; favorite?: boolean; source?: Contact["source"];
}): Contact {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID?.() ?? `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`,
    name: input.name, phone: input.phone, country: input.country, provider: input.provider,
    note: input.note, favorite: input.favorite ?? false, source: input.source ?? "manual",
    createdAt: now, updatedAt: now,
  };
}

/** Decrypt the whole vault into a sorted contact list. */
export async function loadContacts(): Promise<Contact[]> {
  const records = await api.vaultList();
  const out: Contact[] = [];
  for (const r of records) {
    if (r.deleted) continue;
    const c = await decryptRecord(r);
    if (c) out.push(c);
  }
  return out.sort(byPriority);
}

/** Encrypt + upsert one contact (bumps updatedAt). */
export async function saveContact(c: Contact): Promise<Contact> {
  const next = { ...c, updatedAt: new Date().toISOString() };
  const { ciphertext, iv } = await encryptContact(next);
  await api.vaultPut(next.id, { ciphertext, iv, ver: ENVELOPE_VER });
  return next;
}

export async function removeContact(id: string): Promise<void> {
  await api.vaultDelete(id);
}

/* ---------- Phase 4: recovery escrow (E2E) ----------
   The vault key can be wrapped by a key derived from a user-held RECOVERY CODE
   and escrowed on the server as ciphertext. A new device fetches that blob and,
   with the code, unwraps the key — the server never sees the code or the key. */
export interface RecoveryBlob { salt: string; iterations: number; iv: string; ct: string }
const PBKDF2_ITERATIONS = 210_000;

/** Raw VMK bytes — unwrap the at-rest DWK-wrapped key as extractable, transiently. */
async function getRawVMK(): Promise<ArrayBuffer> {
  const dwk = await getDWK();
  const wrapped = await idbGet<ArrayBuffer>(VMK_KEY);
  if (!wrapped) { await unlockVault(); return getRawVMK(); } // first run → create then retry
  const ext = await crypto.subtle.unwrapKey("raw", wrapped, dwk, "AES-KW", { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  return crypto.subtle.exportKey("raw", ext);
}

/** Replace this device's VMK with raw bytes (used after a recovery). */
async function setRawVMK(raw: ArrayBuffer): Promise<void> {
  const dwk = await getDWK();
  const ext = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const wrappedBuf = await crypto.subtle.wrapKey("raw", ext, dwk, "AES-KW");
  await idbSet(VMK_KEY, wrappedBuf);
  vmk = await crypto.subtle.importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function deriveKEK(code: string, salt: BufferSource, iterations: number): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

/** A high-entropy, human-typable recovery code: XXXX-XXXX-XXXX-XXXX (~80 bits). */
export function generateRecoveryCode(): string {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"; // no ambiguous chars (0/O, 1/I/L)
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % alphabet.length];
  return (s.match(/.{1,4}/g) ?? []).join("-");
}

/** Wrap the vault key with the recovery code → escrow blob (server-opaque). */
export async function exportVaultForRecovery(recoveryCode: string): Promise<RecoveryBlob> {
  const raw = await getRawVMK();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const kek = await deriveKEK(recoveryCode.trim(), salt, PBKDF2_ITERATIONS);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, kek, raw);
  return { salt: toB64(salt.buffer), iterations: PBKDF2_ITERATIONS, iv: toB64(iv.buffer), ct: toB64(ct) };
}

/** Unwrap an escrow blob with the recovery code and adopt it as this device's
 *  vault key. Throws on a wrong code (AES-GCM authentication failure). */
export async function adoptVaultFromRecovery(blob: RecoveryBlob, recoveryCode: string): Promise<void> {
  const kek = await deriveKEK(recoveryCode.trim(), fromB64(blob.salt), blob.iterations);
  const raw = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(blob.iv) }, kek, fromB64(blob.ct));
  await setRawVMK(raw);
}

/**
 * Record a successful payment against the contact book: bump lastPaidAt on an
 * existing contact (matched by number) or create one. Best-effort — never throws
 * into the payment flow.
 */
export async function rememberPaidContact(input: {
  name: string; phone: string; country: CountryCode; provider: ProviderId;
}): Promise<void> {
  try {
    const digits = input.phone.replace(/\D/g, "");
    const existing = (await loadContacts()).find((c) => c.phone.replace(/\D/g, "") === digits);
    const now = new Date().toISOString();
    if (existing) {
      await saveContact({ ...existing, lastPaidAt: now, name: existing.name || input.name });
    } else {
      await saveContact({ ...newContact({ ...input, source: "payment" }), lastPaidAt: now });
    }
  } catch {
    /* contact-book best-effort — a payment must never fail because a save did */
  }
}
