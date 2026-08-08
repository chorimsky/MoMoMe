/* ============================================================
   Account anchor + recovery escrow (Phase 4).

   A device can anchor itself to a phone number (OTP) so the account becomes
   portable: the vault re-scopes from the device id to an account id, and any
   other device that proves the same number joins the same account.

   Recovery is END-TO-END: the server stores only a `RecoveryBlob` — the vault
   key wrapped by a key derived (PBKDF2) from a recovery code the user holds.
   The OTP authorises *account access* (which records + which wrapped blob), but
   only the recovery code (or a live second device) can UNWRAP the key. The
   server never sees the code or the key. See docs/device-account-and-contacts.md §6.4.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "./persist.js";

/** VMK wrapped by a recovery-code-derived key. Opaque to the server. */
export interface RecoveryBlob {
  salt: string;        // base64 (PBKDF2 salt)
  iterations: number;  // PBKDF2 iterations
  iv: string;          // base64 (AES-GCM iv)
  ct: string;          // base64 (AES-GCM(KEK, raw VMK))
  updatedAt: string;
}

interface Otp { hash: string; expiresAt: number; attempts: number }

const otps = new Map<string, Otp>();                 // phoneDigits -> OTP
const accountByDevice = new Map<string, string>();   // deviceId -> accountId
const recoveryByAccount = new Map<string, RecoveryBlob>(); // accountId -> blob

register(
  "account",
  () => ({ accounts: [...accountByDevice], recovery: [...recoveryByAccount] }),
  (d: { accounts: [string, string][]; recovery: [string, RecoveryBlob][] }) => {
    for (const [k, v] of d.accounts ?? []) accountByDevice.set(k, v);
    for (const [k, v] of d.recovery ?? []) recoveryByAccount.set(k, v);
  },
);

const digitsOf = (phone: string) => phone.replace(/\D/g, "");
const hashCode = (code: string) => crypto.createHash("sha256").update(code).digest("hex");
export const accountIdForPhone = (phone: string) => `acct:${digitsOf(phone)}`;

/** A phone is anchorable if it looks like a real number (≥ 8 national digits). */
export function requestAnchor(phone: string): { ok: boolean; code?: string } {
  const d = digitsOf(phone);
  if (d.length < 8) return { ok: false };
  const code = String(crypto.randomInt(100000, 1000000)); // 6-digit
  otps.set(d, { hash: hashCode(code), expiresAt: Date.now() + 5 * 60_000, attempts: 0 });
  touch("account");
  return { ok: true, code };
}

/** Verify the OTP for a phone (5-try lockout). Does NOT link a device by itself. */
export function verifyAnchorCode(phone: string, code: string): { ok: boolean; reason?: string } {
  const d = digitsOf(phone);
  const otp = otps.get(d);
  if (!otp || otp.expiresAt < Date.now()) return { ok: false, reason: "expired" };
  if (otp.attempts >= 5) { otps.delete(d); touch("account"); return { ok: false, reason: "expired" }; }
  if (otp.hash !== hashCode(code.trim())) { otp.attempts += 1; touch("account"); return { ok: false, reason: "bad_code" }; }
  otps.delete(d);
  touch("account");
  return { ok: true };
}

export function linkDevice(deviceId: string, phone: string): string {
  const accountId = accountIdForPhone(phone);
  accountByDevice.set(deviceId, accountId);
  touch("account");
  return accountId;
}

/** The account id a device belongs to, or undefined if it hasn't anchored. */
export function accountOf(deviceId: string): string | undefined {
  return accountByDevice.get(deviceId);
}

export function putRecovery(accountId: string, blob: Omit<RecoveryBlob, "updatedAt">): void {
  recoveryByAccount.set(accountId, { ...blob, updatedAt: new Date().toISOString() });
  touch("account");
}

export function getRecovery(accountId: string): RecoveryBlob | undefined {
  return recoveryByAccount.get(accountId);
}
