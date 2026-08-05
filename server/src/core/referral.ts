/* ============================================================
   Referrals + ambassadors — the viral loop primitive (Growth Engine §3–4).

   Every device/account gets a short shareable referral code. A new device that
   arrives via ?ref=<code> is attributed to the referrer (once, immutably). The
   ambassador view joins these attributions with the merchant layer: a referrer's
   value is the MERCHANTS they brought that actually take payments. Reuses the
   device-account identity — no separate ambassador login. See docs/growth-engine.md.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "./persist.js";

const codeByOwner = new Map<string, string>();   // owner -> referral code
const ownerByCode = new Map<string, string>();   // referral code -> owner
const referrerOf = new Map<string, string>();    // referred owner -> referrer owner
const referredList = new Map<string, string[]>();// referrer owner -> [referred owners]

register(
  "referral",
  () => ({ codes: [...codeByOwner], refs: [...referrerOf] }),
  (d: { codes: [string, string][]; refs: [string, string][] }) => {
    for (const [owner, code] of d.codes ?? []) { codeByOwner.set(owner, code); ownerByCode.set(code, owner); }
    for (const [ref, by] of d.refs ?? []) {
      referrerOf.set(ref, by);
      const l = referredList.get(by) ?? []; l.push(ref); referredList.set(by, l);
    }
  },
);

// 7-char uppercase base32-ish code (no ambiguous chars), unique.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const bytes = crypto.randomBytes(7);
    let c = "";
    for (let i = 0; i < 7; i++) c += ALPHABET[bytes[i] % ALPHABET.length];
    if (!ownerByCode.has(c)) return c;
  }
  return crypto.randomBytes(6).toString("hex").toUpperCase();
}

/** Get (or mint) this owner's referral code. */
export function refCodeFor(owner: string): string {
  let c = codeByOwner.get(owner);
  if (!c) { c = genCode(); codeByOwner.set(owner, c); ownerByCode.set(c, owner); touch("referral"); }
  return c;
}

export function ownerForCode(code: string): string | undefined { return ownerByCode.get(code.toUpperCase().trim()); }

/** Attribute `newOwner` to the owner behind `refCode`. Once, immutably; never
 *  self-referral; never overrides an existing attribution. Returns true if set. */
export function recordReferral(newOwner: string, refCode: string): boolean {
  const referrer = ownerForCode(refCode);
  if (!referrer || referrer === newOwner) return false;
  if (referrerOf.has(newOwner)) return false;
  referrerOf.set(newOwner, referrer);
  const l = referredList.get(referrer) ?? []; l.push(newOwner); referredList.set(referrer, l);
  touch("referral");
  return true;
}

export function referralsOf(owner: string): string[] { return referredList.get(owner) ?? []; }
export function referrerOfOwner(owner: string): string | undefined { return referrerOf.get(owner); }
