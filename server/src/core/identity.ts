/* ============================================================
   Identity layer (the quiet part). On a number's first inbound, MoMo›Me
   silently provisions a custodial financial identity — no signup, no
   seed phrase. The number IS the account.

   Phase 1: provisioned + invisible. Phase 2: claimable via OTP.

   The Lightning wallet is REAL when a rail can open custodial accounts (IBEX opens one
   account per end user — its own documented model). Provisioning happens OFF the
   critical path: ensureIdentity() stays synchronous and always succeeds with a
   placeholder ref, then the rail account is opened in the background and swapped in.
   That ordering is deliberate — a payment has just been DELIVERED when this runs, and a
   settlement must never fail, block, or slow down because a wallet-provisioning call to
   an external API was slow or down.
   ============================================================ */
import crypto from "node:crypto";
import type { Identity, IdentityStats, Recipient } from "../../../shared/types.js";
import { COUNTRIES, LN_ADDRESS_DOMAIN } from "../../../shared/domain.js";
import { register, touch } from "./persist.js";
import { background } from "./background.js";
import { createCustodialAccount, custodialBalance, walletRail } from "../adapters/index.js";

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

/** Placeholder wallet ref, used until (or unless) a real rail account is opened. The
 *  `sim_` prefix is load-bearing: it is how walletIsReal() tells a placeholder from a
 *  real rail account id, so nothing ever shows a customer a balance for a wallet that
 *  does not exist. (The old prefix was `ibex_wal_`, which was indistinguishable from a
 *  real IBEX id at a glance — exactly the confusion this avoids.) */
function placeholderWalletRef(): string {
  return `sim_wal_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** Is this identity's Lightning wallet a REAL rail account (vs. a placeholder)? */
export function walletIsReal(id: Identity): boolean {
  return !!id.lnWalletRef && !id.lnWalletRef.startsWith("sim_wal_");
}

/** In-flight provisioning, so concurrent deliveries to the same number can't open two
 *  rail accounts for it. Per-instance: the idempotency that actually matters is the
 *  walletIsReal() check below, which is re-read from the (persisted) identity. */
const provisioning = new Set<string>();

/** Open the REAL custodial wallet for an identity, in the background. Idempotent and
 *  fail-safe: no wallet rail, or a failed/unverified call, simply leaves the placeholder
 *  in place — the identity, its Lightning Address and every payment keep working, and the
 *  next delivery to that number retries. Nothing here can fail a settlement. */
export function provisionWallet(identity: Identity): void {
  if (walletIsReal(identity) || !walletRail() || provisioning.has(identity.customerId)) return;
  provisioning.add(identity.customerId);
  background(
    createCustodialAccount(identity.customerId)
      .then(({ provider, accountId }) => {
        // Re-read: the identity object may have been replaced by a restore() since.
        const live = byPhone.get(identity.phone) ?? identity;
        if (walletIsReal(live)) return; // another instance won the race
        live.lnWalletRef = accountId;
        live.lnWalletProvider = provider;
        touch("identity");
        console.log(`[identity] ${live.customerId} → custodial wallet opened on ${provider} (${accountId})`);
      })
      .catch((e) => {
        console.error(`[identity] custodial wallet for ${identity.customerId} not opened (keeping placeholder):`, e instanceof Error ? e.message : e);
      })
      .finally(() => provisioning.delete(identity.customerId)),
  );
}

/** Live balance of an identity's custodial wallet, in the rail account's smallest unit
 *  (msat for BTC). null when the wallet is still a placeholder or the rail can't say —
 *  callers must render "unavailable", never 0, because 0 is a claim about someone's money. */
export async function walletBalance(id: Identity): Promise<{ currencyId: number; balance: number } | null> {
  if (!walletIsReal(id)) return null;
  return custodialBalance(id.lnWalletProvider, id.lnWalletRef);
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
  if (existing) {
    // Retry provisioning for a number provisioned before a wallet rail existed (or whose
    // earlier attempt failed). No-op once the wallet is real.
    provisionWallet(existing);
    return existing;
  }

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
    lnWalletRef: placeholderWalletRef(),
    ledgerId: `LED${pad(seq)}`,
    lightningAddress: `${cc}${phoneDigits}@${LN_ADDRESS_DOMAIN}`,
    status: "Active",
    claimed: false,
    balances: { XAF: 0, BTC: 0, USDT: 0, USDC: 0 },
    createdAt: now,
    lastSeen: now,
    firstPaymentRef,
  };
  byPhone.set(rec.phone, id);
  touch("identity");
  provisionWallet(id); // background; never blocks the settlement that triggered this
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
