/* ============================================================
   Device proof-of-possession — the mobile twin of the web's deviceAccount.ts.

   The account is the device. Until now the app proved that with a bare id header, which
   the server accepts only during a migration window (it ends 2026-11-01). After that an id
   with no enrolled key proves nothing. This module gives the app a P-256 key pair in the
   Keychain/Keystore, enrols the public keys once (POST /me/devices, trust on first use),
   and signs every request: METHOD, path, a fresh timestamp and a hash of the exact body,
   so a captured id — or a captured request — cannot be replayed as this device.

   Signature format is what WebCrypto verifies on the server: ECDSA P-256 over SHA-256,
   raw r||s (64 bytes), base64. @noble/curves produces exactly that.
   ============================================================ */
import * as SecureStore from 'expo-secure-store';
import { p256 } from '@noble/curves/nist.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';

const AUTH_KEY = 'momome.device.auth.p256';
const WRAP_KEY = 'momome.device.wrap.p256';
const ENROLLED_KEY = 'momome.device.enrolled'; // the sender id the keys were enrolled under

const b64 = (u8: Uint8Array): string => btoa(String.fromCharCode(...u8));
const b64url = (u8: Uint8Array): string => b64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function loadOrGen(storeKey: string): Promise<Uint8Array> {
  try {
    const hex = await SecureStore.getItemAsync(storeKey);
    if (hex && /^[0-9a-f]{64}$/.test(hex)) return hexToBytes(hex);
  } catch { /* fall through */ }
  const priv = p256.utils.randomSecretKey();
  try { await SecureStore.setItemAsync(storeKey, bytesToHex(priv)); } catch { /* no keychain: session-only key */ }
  return priv;
}

function jwkOf(priv: Uint8Array): JsonWebKey {
  const pub = p256.getPublicKey(priv, false); // 0x04 || x || y
  return { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)) };
}

let cache: { auth: Uint8Array; wrap: Uint8Array } | null = null;
async function keys(): Promise<{ auth: Uint8Array; wrap: Uint8Array }> {
  if (!cache) cache = { auth: await loadOrGen(AUTH_KEY), wrap: await loadOrGen(WRAP_KEY) };
  return cache;
}

export async function devicePublicKeys(): Promise<{ authPub: JsonWebKey; wrapPub: JsonWebKey }> {
  const k = await keys();
  return { authPub: jwkOf(k.auth), wrapPub: jwkOf(k.wrap) };
}

/** Sign one request exactly as the server's verifyDeviceSig expects. */
export async function signRequest(method: string, path: string, bodyStr: string): Promise<{ ts: string; sig: string }> {
  const { auth } = await keys();
  const ts = String(Date.now());
  const bodyHash = sha256(new TextEncoder().encode(bodyStr));
  const msg = new TextEncoder().encode(`${method.toUpperCase()}\n${path}\n${ts}\n${b64(bodyHash)}`);
  const sig = p256.sign(sha256(msg), auth, { prehash: false, lowS: true });
  return { ts, sig: b64(sig) };
}

export async function enrolledFor(): Promise<string | null> {
  try { return await SecureStore.getItemAsync(ENROLLED_KEY); } catch { return null; }
}
export async function markEnrolled(senderId: string): Promise<void> {
  try { await SecureStore.setItemAsync(ENROLLED_KEY, senderId); } catch { /* ignore */ }
}
/** Account deleted / id rotated: the keys go with it so the next id enrols fresh ones. */
export async function forgetDeviceKeys(): Promise<void> {
  cache = null;
  for (const k of [AUTH_KEY, WRAP_KEY, ENROLLED_KEY]) { try { await SecureStore.deleteItemAsync(k); } catch { /* ignore */ } }
}
