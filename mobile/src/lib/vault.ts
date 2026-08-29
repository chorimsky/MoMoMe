/**
 * Encrypted contact vault (native) — parity with the web app's zero-knowledge
 * contact book (app/src/lib/vault.ts). Contacts are AES-256-GCM encrypted on the
 * device; the server only ever stores opaque ciphertext (VaultRecord).
 *
 * Crypto is pure-JS (@noble) so it runs in Expo Go, and byte-for-byte compatible
 * with the web's WebCrypto scheme:
 *   • record   = base64( AES-256-GCM(VMK, JSON(Contact)) )  + base64 96-bit IV
 *   • recovery = PBKDF2-SHA256(code, salt, 210k) → KEK; escrow = AES-GCM(KEK, VMK)
 * so a vault backed up on the web restores on mobile and vice-versa.
 *
 * The 256-bit Vault Master Key (VMK) lives in SecureStore (Keychain/Keystore —
 * hardware-backed), which replaces the web's IndexedDB + AES-KW wrapping.
 */

import { gcm } from '@noble/ciphers/aes.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import * as ExpoCrypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

// Randomness from expo-crypto (Hermes has no WebCrypto). noble only ever
// consumes bytes we pass it explicitly (IVs, salt, keys), so this is the only
// source of entropy the vault needs.
const randomBytes = (n: number): Uint8Array => ExpoCrypto.getRandomValues(new Uint8Array(n));

import { api } from '@/api/client';
import type { Contact, CountryCode, ProviderId, VaultRecord } from '@shared/types';

const VMK_KEY = 'mm_vault_vmk'; // base64 of the 32-byte vault master key
export const ENVELOPE_VER = 1;
const PBKDF2_ITERATIONS = 210_000;

/* ---- standard base64 (matches the web's btoa/atob, so envelopes interop) ---- */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function toB64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}
function fromB64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let val = 0;
  let p = 0;
  for (const ch of clean) {
    val = (val << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[p++] = (val >> bits) & 0xff;
    }
  }
  return out;
}

function uuid(): string {
  const b = randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/* ---- vault master key (SecureStore-backed, created on first use) ---- */
let vmkCache: Uint8Array | null = null;
async function getVMK(): Promise<Uint8Array> {
  if (vmkCache) return vmkCache;
  let stored: string | null;
  try {
    stored = await SecureStore.getItemAsync(VMK_KEY);
  } catch {
    // A TRANSIENT read failure (e.g. device locked) must NOT overwrite the real
    // key — that would orphan every existing record. Use an ephemeral key for
    // this session and never persist it.
    return randomBytes(32);
  }
  if (stored) return (vmkCache = fromB64(stored));
  // First run only (read succeeded, returned null): mint + persist the VMK.
  const fresh = randomBytes(32);
  try {
    await SecureStore.setItemAsync(VMK_KEY, toB64(fresh));
    vmkCache = fresh;
  } catch {
    /* couldn't persist — ephemeral for this session, not cached */
  }
  return fresh;
}
async function setVMK(raw: Uint8Array): Promise<void> {
  vmkCache = raw;
  await SecureStore.setItemAsync(VMK_KEY, toB64(raw)).catch(() => {});
}

async function encryptContact(c: Contact): Promise<{ ciphertext: string; iv: string }> {
  const key = await getVMK();
  const iv = randomBytes(12);
  const ct = gcm(key, iv).encrypt(enc(JSON.stringify(c)));
  return { ciphertext: toB64(ct), iv: toB64(iv) };
}
async function decryptRecord(r: VaultRecord): Promise<Contact | null> {
  try {
    const key = await getVMK();
    const pt = gcm(key, fromB64(r.iv)).decrypt(fromB64(r.ciphertext));
    return JSON.parse(dec(pt)) as Contact;
  } catch {
    return null; // wrong key (another device) or corrupt — skip
  }
}

/** Favorites first, then most-recently-paid/updated. */
function byPriority(a: Contact, b: Contact): number {
  if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
  return (b.lastPaidAt ?? b.updatedAt).localeCompare(a.lastPaidAt ?? a.updatedAt);
}

/* ---------- public API ---------- */
export function newContact(input: {
  name: string;
  phone: string;
  country: CountryCode;
  provider: ProviderId;
  note?: string;
  favorite?: boolean;
  source?: Contact['source'];
}): Contact {
  const now = new Date().toISOString();
  return {
    id: uuid(),
    name: input.name,
    phone: input.phone,
    country: input.country,
    provider: input.provider,
    note: input.note,
    favorite: input.favorite ?? false,
    source: input.source ?? 'manual',
    createdAt: now,
    updatedAt: now,
  };
}

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

export async function saveContact(c: Contact): Promise<Contact> {
  const next = { ...c, updatedAt: new Date().toISOString() };
  const { ciphertext, iv } = await encryptContact(next);
  await api.vaultPut(next.id, { ciphertext, iv, ver: ENVELOPE_VER });
  return next;
}

export async function removeContact(id: string): Promise<void> {
  await api.vaultDelete(id);
}

/* ---------- E2E recovery (recovery-code-wrapped VMK, server-opaque) ---------- */
export interface RecoveryBlob {
  salt: string;
  iterations: number;
  iv: string;
  ct: string;
}

/** High-entropy, human-typable recovery code: XXXX-XXXX-XXXX-XXXX (~80 bits). */
export function generateRecoveryCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no ambiguous chars
  const bytes = randomBytes(16);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += alphabet[bytes[i] % alphabet.length];
  return (s.match(/.{1,4}/g) ?? []).join('-');
}

function deriveKEK(code: string, salt: Uint8Array, iterations: number): Uint8Array {
  return pbkdf2(sha256, enc(code.trim()), salt, { c: iterations, dkLen: 32 });
}

/** Wrap the vault key with the recovery code → escrow blob (server-opaque). */
export async function exportVaultForRecovery(recoveryCode: string): Promise<RecoveryBlob> {
  const raw = await getVMK();
  const salt = randomBytes(16);
  const kek = deriveKEK(recoveryCode, salt, PBKDF2_ITERATIONS);
  const iv = randomBytes(12);
  const ct = gcm(kek, iv).encrypt(raw);
  return { salt: toB64(salt), iterations: PBKDF2_ITERATIONS, iv: toB64(iv), ct: toB64(ct) };
}

/** Unwrap an escrow blob with the recovery code and adopt it as this device's
 *  vault key. Throws on a wrong code (AES-GCM authentication failure). */
export async function adoptVaultFromRecovery(blob: RecoveryBlob, recoveryCode: string): Promise<void> {
  const kek = deriveKEK(recoveryCode, fromB64(blob.salt), blob.iterations);
  const raw = gcm(kek, fromB64(blob.iv)).decrypt(fromB64(blob.ct));
  await setVMK(raw);
}

/**
 * Record a successful payment against the contact book: bump lastPaidAt on an
 * existing contact (matched by number) or create one. Best-effort — never throws
 * into the payment flow.
 */
export async function rememberPaidContact(input: {
  name: string;
  phone: string;
  country: CountryCode;
  provider: ProviderId;
}): Promise<void> {
  try {
    const digits = input.phone.replace(/\D/g, '');
    const existing = (await loadContacts()).find((c) => c.phone.replace(/\D/g, '') === digits);
    const now = new Date().toISOString();
    if (existing) {
      await saveContact({ ...existing, lastPaidAt: now, name: existing.name || input.name });
    } else {
      await saveContact({ ...newContact({ ...input, source: 'payment' }), lastPaidAt: now });
    }
  } catch {
    /* best-effort — a payment must never fail because a save did */
  }
}
