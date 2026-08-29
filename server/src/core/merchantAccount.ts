/* ============================================================
   Merchant accounts — self-onboarded businesses that ACCEPT payments.

   A merchant is owned by a device/partner id (the same `ownerOf` identity used
   everywhere else — zero separate login). Its sales are ordinary payments whose
   recipient is the merchant's settlement Mobile Money number, tagged with the
   merchant id when paid through a link/QR. See docs/merchant-ecosystem.md.
   ============================================================ */
import crypto from "node:crypto";
import type {
  CountryCode, ProviderId, MerchantAccount, MerchantTier, MerchantLink, MerchantLinkKind, Payment,
} from "../../../shared/types.js";
import { register, touch } from "./persist.js";
import { store } from "../db/store.js";

/** Stored shape = public account + the owning id (never returned to clients). */
interface StoredMerchant extends MerchantAccount { owner: string }

const merchants = new Map<string, StoredMerchant>();  // id -> account
const ownerIndex = new Map<string, string>();         // owner -> merchant id
const codeIndex = new Map<string, string>();          // public code -> merchant id
const links = new Map<string, MerchantLink>();        // link code -> link
let seq = 4520;                                        // public code counter (starts pretty)

register(
  "merchants2",
  () => ({ merchants: [...merchants.values()], links: [...links.values()], seq }),
  (d: { merchants: StoredMerchant[]; links: MerchantLink[]; seq: number }) => {
    for (const m of d.merchants ?? []) { merchants.set(m.id, m); ownerIndex.set(m.owner, m.id); codeIndex.set(m.code, m.id); }
    for (const l of d.links ?? []) links.set(l.code, l);
    if (typeof d.seq === "number") seq = d.seq;
  },
);

const digits = (s: string) => s.replace(/\D/g, "");
/** Public projection — strip the internal `owner`. */
export function publicMerchant({ owner: _o, ...m }: StoredMerchant): MerchantAccount { return m; }

/** Create (or, if the owner already has one, update) a merchant account. */
export function createMerchant(owner: string, input: {
  businessName: string; category: string; country: CountryCode; settlementPhone: string;
  provider: ProviderId; tier: MerchantTier; location?: MerchantAccount["location"];
}): StoredMerchant {
  const fields = {
    businessName: input.businessName.slice(0, 80), category: input.category.slice(0, 40),
    country: input.country, settlementPhone: digits(input.settlementPhone), provider: input.provider,
    tier: input.tier, location: input.location, updatedAt: new Date().toISOString(),
  };
  const existingId = ownerIndex.get(owner);
  if (existingId) {
    const m = merchants.get(existingId)!;
    // Changing the settlement number invalidates phone verification: the new
    // number's ownership hasn't been proven, so drop the Verified state until it's
    // (re-)verified. `directory()` already gates on verifiedPhone, so we leave the
    // merchant's own `listed` preference intact — clearing it would silently drop a
    // merchant from the directory on a legitimate edit (and it re-lists as soon as
    // the number verifies again; SMS-bypass re-verifies immediately via the caller).
    const phoneChanged = fields.settlementPhone !== m.settlementPhone;
    Object.assign(m, fields);
    if (phoneChanged && m.verifiedPhone) { m.verifiedPhone = false; m.status = "pending"; }
    touch("merchants2");
    return m;
  }
  const id = `mrc_${crypto.randomBytes(8).toString("hex")}`;
  const code = `MOM-${input.country}-${String(++seq).padStart(6, "0")}`;
  const now = new Date().toISOString();
  const m: StoredMerchant = { id, code, owner, status: "pending", verifiedPhone: false, createdAt: now, ...fields };
  merchants.set(id, m); ownerIndex.set(owner, id); codeIndex.set(code, id);
  touch("merchants2");
  return m;
}

export function merchantByOwner(owner: string): StoredMerchant | undefined {
  const id = ownerIndex.get(owner);
  return id ? merchants.get(id) : undefined;
}
export function merchantById(id: string): StoredMerchant | undefined { return merchants.get(id); }
export function merchantByCode(code: string): StoredMerchant | undefined {
  const id = codeIndex.get(code);
  return id ? merchants.get(id) : undefined;
}

/** Mark the settlement phone verified → the account goes live. ONLY call after a
 *  real ownership proof (the OTP verify flow) — verifiedPhone gates the public
 *  directory, pay-link creation, and the "Verified" badge shown to buyers. */
export function activateMerchant(id: string): StoredMerchant | undefined {
  const m = merchants.get(id);
  if (!m) return undefined;
  m.verifiedPhone = true;
  if (m.status === "pending") m.status = "active";
  m.updatedAt = new Date().toISOString();
  touch("merchants2");
  return m;
}

/** Bring an account to "active" WITHOUT proving phone ownership — used when no SMS
 *  provider is wired up so the dashboard is usable, but verifiedPhone stays false so
 *  the trust-gated features (directory listing, pay-link creation, Verified badge)
 *  remain blocked until a real ownership proof exists. Never marks the phone verified. */
export function activateUnverified(id: string): StoredMerchant | undefined {
  const m = merchants.get(id);
  if (!m) return undefined;
  if (m.status === "pending") m.status = "active";
  m.updatedAt = new Date().toISOString();
  touch("merchants2");
  return m;
}

/** Opt a merchant into (or out of) the public "Pay with MoMo›Me" directory. */
export function setListed(id: string, listed: boolean): StoredMerchant | undefined {
  const m = merchants.get(id);
  if (!m) return undefined;
  m.listed = listed;
  m.updatedAt = new Date().toISOString();
  touch("merchants2");
  return m;
}

/** Public directory: active, verified, opted-in merchants, filtered + newest first.
 *  Never exposes the settlement number (that's revealed only at the pay step). */
export function directory(opts: { country?: string; category?: string; q?: string } = {}): MerchantAccount[] {
  const q = (opts.q ?? "").trim().toLowerCase();
  return [...merchants.values()]
    .filter((m) => m.listed && m.status === "active" && m.verifiedPhone)
    .filter((m) => (!opts.country || m.country === opts.country))
    .filter((m) => (!opts.category || m.category === opts.category))
    .filter((m) => (!q || m.businessName.toLowerCase().includes(q) || m.category.toLowerCase().includes(q) || (m.location?.label ?? "").toLowerCase().includes(q)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(publicMerchant);
}

/* ---------- payment links / QR ---------- */
export function createLink(merchantId: string, input: { amountXaf?: number; label?: string; kind?: MerchantLinkKind; clientName?: string; dueDate?: string }): MerchantLink {
  const code = crypto.randomBytes(6).toString("base64url").slice(0, 8);
  const link: MerchantLink = {
    code, merchantId,
    amountXaf: input.amountXaf && input.amountXaf > 0 ? Math.round(input.amountXaf) : undefined,
    label: input.label?.slice(0, 60) || undefined,
    kind: input.kind ?? "link",
    clientName: input.clientName?.slice(0, 60) || undefined,
    dueDate: /^\d{4}-\d{2}-\d{2}$/.test(input.dueDate ?? "") ? input.dueDate : undefined,
    createdAt: new Date().toISOString(),
  };
  links.set(code, link);
  touch("merchants2");
  return link;
}
export function getLink(code: string): MerchantLink | undefined { return links.get(code); }
export function linksForMerchant(merchantId: string): MerchantLink[] {
  return [...links.values()].filter((l) => l.merchantId === merchantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export function disableLink(code: string, merchantId: string): boolean {
  const l = links.get(code);
  if (!l || l.merchantId !== merchantId || l.disabledAt) return false;
  l.disabledAt = new Date().toISOString();
  touch("merchants2");
  return true;
}

/* ---------- sales (a merchant's incoming payments) ---------- */
/** Payments that settle to this merchant — STRICTLY those explicitly tagged with
 *  this merchant's id (set only when a payment went through the merchant's own
 *  link / QR / by-code AND the recipient matched their settlement number). We do
 *  NOT fall back to "any payment addressed to the settlement number": that let
 *  anyone create a merchant pointing at a victim's public MoMo number and read
 *  every payment (and payer PII) sent to it. Newest first. */
export async function salesFor(m: MerchantAccount): Promise<Payment[]> {
  return (await store().listPayments())
    .filter((p) => p.merchantId === m.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
