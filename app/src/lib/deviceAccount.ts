/* ============================================================
   Device account (client) — proof-of-possession keys.

   On first use the device generates two non-extractable keypairs in
   IndexedDB and enrolls their public keys with the server (trust-on-first-
   use). Thereafter every request is SIGNED with the auth key, so a stolen
   device id is useless without the private key (which never leaves the
   device). See docs/device-account-and-contacts.md §5.
   ============================================================ */
import { idbGet, idbSet } from "./idb.js";

const AUTH_IDB = "mm_dev_authkey"; // ECDSA P-256 — signs requests
const WRAP_IDB = "mm_dev_wrapkey"; // ECDH P-256 — receives the wrapped vault key (future)

interface StoredPair { priv: CryptoKey; pubJwk: JsonWebKey; }
interface DeviceKeys { authPriv: CryptoKey; authPubJwk: JsonWebKey; wrapPubJwk: JsonWebKey; }

function b64(buf: ArrayBuffer): string {
  let s = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

async function loadOrGen(idbKey: string, algo: EcKeyGenParams, usages: KeyUsage[]): Promise<StoredPair> {
  const existing = await idbGet<StoredPair>(idbKey);
  if (existing?.priv && existing.pubJwk) return existing;
  const kp = (await crypto.subtle.generateKey(algo, false, usages)) as CryptoKeyPair; // priv non-extractable
  const pubJwk = (await crypto.subtle.exportKey("jwk", kp.publicKey)) as JsonWebKey;
  const stored: StoredPair = { priv: kp.privateKey, pubJwk };
  await idbSet(idbKey, stored);
  return stored;
}

let keysP: Promise<DeviceKeys> | null = null;
function keys(): Promise<DeviceKeys> {
  if (!keysP) {
    const p = (async () => {
      const auth = await loadOrGen(AUTH_IDB, { name: "ECDSA", namedCurve: "P-256" }, ["sign", "verify"]);
      const wrap = await loadOrGen(WRAP_IDB, { name: "ECDH", namedCurve: "P-256" }, ["deriveBits"]);
      return { authPriv: auth.priv, authPubJwk: auth.pubJwk, wrapPubJwk: wrap.pubJwk };
    })();
    // Don't cache a REJECTED promise for the whole session — a transient IDB failure
    // would otherwise permanently disable signing. Clear it so the next call retries.
    p.catch(() => { if (keysP === p) keysP = null; });
    keysP = p;
  }
  return keysP;
}

/** The device's public keys, for enrollment. */
export async function devicePublicKeys(): Promise<{ authPubJwk: JsonWebKey; wrapPubJwk: JsonWebKey }> {
  const k = await keys();
  return { authPubJwk: k.authPubJwk, wrapPubJwk: k.wrapPubJwk };
}

/**
 * Sign one request. The signed message binds the method, the API path (incl.
 * query), a fresh timestamp, and a hash of the exact body bytes — so the
 * signature can't be replayed against a different request. Matches the server's
 * verifyDeviceSig.
 */
export async function signRequest(method: string, path: string, bodyStr: string): Promise<{ ts: string; sig: string }> {
  const { authPriv } = await keys();
  const ts = String(Date.now());
  const bodyHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(bodyStr));
  const msg = new TextEncoder().encode(`${method.toUpperCase()}\n${path}\n${ts}\n${b64(bodyHash)}`);
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, authPriv, msg);
  return { ts, sig: b64(sig) };
}
