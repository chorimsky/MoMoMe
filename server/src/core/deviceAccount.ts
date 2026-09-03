/* ============================================================
   Device accounts (proof-of-possession identity).

   A device enrolls a public keypair for its anonymous id (the same
   X-MM-Sender value it already uses). Once enrolled, the server REQUIRES
   a valid signature on that id's requests — so a stolen/guessed id is no
   longer enough to act as the account (fixes the bearer-token weakness).

   Trust-on-first-use: the first key wins; re-enrolling a DIFFERENT key for
   an already-registered id is refused (409). A device that loses its
   private key simply rotates to a fresh id (its old data is unrecoverable —
   the accepted end-to-end tradeoff). See docs/device-account-and-contacts.md.
   ============================================================ */
import type { JsonWebKey } from "node:crypto";
import { register, touch } from "./persist.js";

export interface DeviceAccount {
  deviceId: string;
  authPub: JsonWebKey; // ECDSA P-256 (verify request signatures)
  wrapPub: JsonWebKey;  // ECDH P-256 (receive the wrapped vault key — future)
  createdAt: string;
}

const byId = new Map<string, DeviceAccount>();

register(
  "deviceAccounts",
  () => [...byId.values()],
  (data: DeviceAccount[]) => { for (const d of data) byId.set(d.deviceId, d); },
);

export function getDevice(deviceId: string): DeviceAccount | undefined {
  return byId.get(deviceId);
}

export type EnrollResult = { ok: true; device: DeviceAccount } | { ok: false; reason: "conflict" };

/**
 * Trust-on-first-use enrollment. Idempotent for the same key; a different key
 * for an existing id is a conflict (someone else can't hijack a known id).
 */
/** Drop this device's enrolment and its public keys. Part of account deletion: the device
 *  IS the account here, so forgetting the enrolment is what ends it. Returns whether one
 *  existed, so the caller can report honestly rather than claim a deletion that no-op'd. */
export function forgetDevice(deviceId: string): boolean {
  const existed = byId.delete(deviceId);
  if (existed) touch("deviceAccount");
  return existed;
}

export function enrollDevice(deviceId: string, authPub: JsonWebKey, wrapPub: JsonWebKey): EnrollResult {
  const existing = byId.get(deviceId);
  if (existing) {
    // Same public key re-sent (page reload before the client cached its flag) → OK.
    if (existing.authPub.x === authPub.x && existing.authPub.y === authPub.y) return { ok: true, device: existing };
    return { ok: false, reason: "conflict" };
  }
  const device: DeviceAccount = { deviceId, authPub, wrapPub, createdAt: new Date().toISOString() };
  byId.set(deviceId, device);
  touch("deviceAccounts");
  return { ok: true, device };
}
