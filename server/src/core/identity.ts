/* ============================================================
   Identity layer (the quiet part). On a number's first inbound, MoMo›Me
   silently provisions a custodial financial identity — no signup, no
   seed phrase. The number IS the account.

   Phase 1: provisioned + invisible. Phase 2: claimable via OTP.
   The Lightning wallet is custodial; in live mode createCustodialWallet
   would call IBEX to open an account behind the same seam.
   ============================================================ */
import crypto from "node:crypto";
import type { Identity, IdentityStats, Recipient } from "../../../shared/types.js";
import { COUNTRIES, LN_ADDRESS_DOMAIN } from "../../../shared/domain.js";
import { register, touch } from "./persist.js";

interface Otp { hash: string; expiresAt: number; attempts: number }

const byPhone = new Map<string, Identity>();
let seq = 0;
const otps = new Map<string, Otp>();
const pad = (n: number) => String(n).padStart(5, "0");
const hashCode = (code: string) => crypto.createHash("sha256").update(code).digest("hex");

register(
  "identity",
  () => ({ byPhone: [...byPhone], seq, otps: [...otps] }),
  (d: { byPhone: [string, Identity][]; seq: number; otps: [string, Otp][] }) => {
    for (const [k, v] of d.byPhone) byPhone.set(k, v);
    seq = d.seq;
    for (const [k, v] of d.otps) otps.set(k, v);
  },
);

/** SANDBOX custodial Lightning wallet. Live → IBEX create-account. */
function createCustodialWallet(): string {
  return `ibex_wal_${Math.random().toString(36).slice(2, 12)}`;
}

function ccDigits(country: Recipient["country"]): string {
  return COUNTRIES[country].dial.replace(/\D/g, "");
}

/**
 * Idempotent: returns the existing identity for a number, or provisions a
 * new one (customer + wallet + ledger + Lightning address) on first sight.
 */
export function ensureIdentity(rec: Recipient, firstPaymentRef?: string): Identity {
  const existing = byPhone.get(rec.phone);
  if (existing) return existing;

  seq += 1;
  const phoneDigits = rec.phone.replace(/\D/g, "");
  const cc = ccDigits(rec.country);
  const now = new Date().toISOString();
  const id: Identity = {
    customerId: `CUS${pad(seq)}`,
    name: rec.name,
    phone: rec.phone,
    e164: `+${cc}${phoneDigits}`,
    country: rec.country,
    walletId: `LNW${pad(seq)}`,
    lnWalletRef: createCustodialWallet(),
    ledgerId: `LED${pad(seq)}`,
    lightningAddress: `${cc}${phoneDigits}@${LN_ADDRESS_DOMAIN}`,
    status: "Active",
    claimed: false,
    balances: { XAF: 0, BTC: 0, USDT: 0 },
    createdAt: now,
    lastSeen: now,
    firstPaymentRef,
  };
  byPhone.set(rec.phone, id);
  touch("identity");
  return id;
}

/** National significant number (last 9 digits) — tolerates country-code presence. */
const nsn = (d: string) => (d.length > 9 ? d.slice(-9) : d);

/** Match an identity by digits, ignoring spacing and an optional country code. */
export function getIdentityByDigits(digits: string): Identity | undefined {
  const k = nsn(digits);
  for (const id of byPhone.values()) {
    if (nsn(id.phone.replace(/\D/g, "")) === k) return id;
  }
  return undefined;
}

export function touchLastSeen(phone: string): void {
  const id = byPhone.get(phone);
  if (id) { id.lastSeen = new Date().toISOString(); touch("identity"); }
}

/** Phase 2: mark an identity as claimed (after OTP verification). */
export function claimIdentity(customerId: string): Identity | null {
  for (const id of byPhone.values()) {
    if (id.customerId === customerId) {
      id.claimed = true;
      touch("identity");
      return id;
    }
  }
  return null;
}

export function getIdentityByPhone(phone: string): Identity | undefined {
  return byPhone.get(phone);
}

/** Maintenance: remove "phantom" identities provisioned under the old
 *  at-creation rule — those that are NOT claimed and whose number never
 *  received money (no national-significant-number in `deliveredNsn`). Safe and
 *  self-healing: a pruned number is re-provisioned on its next delivery.
 *  Returns the customerIds removed. */
export function pruneOrphanIdentities(deliveredNsn: Set<string>): string[] {
  const removed: string[] = [];
  for (const [key, id] of [...byPhone]) {
    if (id.claimed) continue; // never drop a claimed account
    if (deliveredNsn.has(nsn(id.phone.replace(/\D/g, "")))) continue; // received money → keep
    byPhone.delete(key);
    removed.push(id.customerId);
  }
  if (removed.length) touch("identity");
  return removed;
}

export function listIdentities(): Identity[] {
  return [...byPhone.values()].sort((a, b) => a.customerId.localeCompare(b.customerId));
}

export function identityStats(): IdentityStats {
  const all = [...byPhone.values()];
  const claimed = all.filter((i) => i.claimed).length;
  return { total: all.length, wallets: all.length, claimed, unclaimed: all.length - claimed };
}

/* ---------- consumer claim (Phase 2): OTP request + verify ----------
   A number can only be claimed once it has received a payment (it has an
   identity). The OTP would be sent by SMS in production; in sandbox the
   code is returned so the demo can complete. (otps map declared up top.) */
export function requestClaim(phone: string): { found: boolean; alreadyClaimed?: boolean; code?: string } {
  const digits = phone.replace(/\D/g, "");
  const id = getIdentityByDigits(digits);
  if (!id) return { found: false };
  if (id.claimed) return { found: true, alreadyClaimed: true };
  // Cryptographically random 6-digit code; only its hash is stored.
  const code = String(crypto.randomInt(100000, 1000000));
  otps.set(id.phone, { hash: hashCode(code), expiresAt: Date.now() + 5 * 60_000, attempts: 0 });
  touch("identity");
  return { found: true, code };
}

export function verifyClaim(phone: string, code: string): { ok: boolean; identity?: Identity; reason?: string } {
  const id = getIdentityByDigits(phone.replace(/\D/g, ""));
  if (!id) return { ok: false, reason: "no_account" };
  const otp = otps.get(id.phone);
  if (!otp || otp.expiresAt < Date.now()) return { ok: false, reason: "expired" };
  // Lockout after 5 wrong attempts to defeat brute force of the 10⁶ space.
  if (otp.attempts >= 5) { otps.delete(id.phone); touch("identity"); return { ok: false, reason: "expired" }; }
  if (otp.hash !== hashCode(code.trim())) {
    otp.attempts += 1;
    touch("identity");
    return { ok: false, reason: "bad_code" };
  }
  otps.delete(id.phone);
  id.claimed = true;
  id.lastSeen = new Date().toISOString();
  touch("identity");
  return { ok: true, identity: id };
}
