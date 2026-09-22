/* ============================================================
   Merchant accounts — self-onboarded businesses that ACCEPT payments.

   A merchant is owned by a device/partner id (the same `ownerOf` identity used
   everywhere else — zero separate login). Its sales are ordinary payments whose
   recipient is the merchant's settlement Mobile Money number, tagged with the
   merchant id when paid through a link/QR. See docs/merchant-ecosystem.md.
   ============================================================ */
import crypto from "node:crypto";
import type {
  CountryCode, ProviderId, MerchantAccount, MerchantTier, MerchantLink, MerchantLinkKind, MerchantSale, Payment,
} from "../../../shared/types.js";
import { register, touch } from "./persist.js";
import { lightningAddress, samePhone } from "../../../shared/domain.js";
import { store } from "../db/store.js";

/** Stored shape = public account + the owning id (never returned to clients). */
export interface StoredMerchant extends MerchantAccount { owner: string }

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

/* ---------- change hook ----------
   Anything that mirrors a merchant elsewhere (the Connect payment identity: aliases,
   verification, settlement destination, suspension) subscribes here rather than being
   called from every route. Fired after verify / edit / suspend / reactivate / forget. */
type MerchantChange = "verified" | "updated" | "suspended" | "reactivated" | "forgotten";
const listeners: Array<(m: StoredMerchant, change: MerchantChange) => void> = [];
export function onMerchantChange(fn: (m: StoredMerchant, change: MerchantChange) => void): void { listeners.push(fn); }
function emit(m: StoredMerchant, change: MerchantChange): void { for (const fn of listeners) { try { fn(m, change); } catch (e) { console.error("merchant change listener", e); } } }

/** The merchant whose settlement number is this Mobile Money number, if any — the join the
 *  Lightning Address surface uses to show a BUSINESS to a payer instead of a masked person. */
export function merchantBySettlementPhone(phone: string, country: CountryCode): StoredMerchant | undefined {
  for (const m of merchants.values()) if (m.country === country && samePhone(m.settlementPhone, phone, country)) return m;
  return undefined;
}
/** The merchant's Lightning identity: its settlement number as a Lightning Address (never the
 *  code — the code cannot receive funds). `enabled` = a wallet resolving it is shown the
 *  business by name and the sale lands on the dashboard: that needs an active account and a
 *  proven number. The address itself is reachable for any valid number; what verification
 *  turns on is the identity behind it. */
export function lightningIdentity(m: MerchantAccount): { address: string; enabled: boolean; reason?: "unverified" | "suspended" | "pending" } {
  const address = lightningAddress(m.settlementPhone, m.country);
  if (m.status === "suspended") return { address, enabled: false, reason: "suspended" };
  if (!m.verifiedPhone) return { address, enabled: false, reason: "unverified" };
  if (m.status !== "active") return { address, enabled: false, reason: "pending" };
  return { address, enabled: true };
}
/** Public projection — strip the internal `owner`; add the derived Lightning identity. */
export function publicMerchant({ owner: _o, ...m }: StoredMerchant): MerchantAccount { return { ...m, lightning: lightningIdentity(m) }; }

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
    emit(m, "updated");
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
  emit(m, "verified");
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

/** Operator: suspend an acceptance account. Its links stop paying (getLink callers check
 *  status), it leaves the directory, and the owner sees why in the app. */
export function suspendMerchant(id: string, reason?: string): StoredMerchant | undefined {
  const m = merchants.get(id); if (!m) return undefined;
  m.status = "suspended"; m.suspendedReason = reason?.slice(0, 200); m.updatedAt = new Date().toISOString();
  touch("merchants2"); emit(m, "suspended"); return m;
}
export function reactivateMerchant(id: string): StoredMerchant | undefined {
  const m = merchants.get(id); if (!m || m.status !== "suspended") return undefined;
  m.status = "active"; delete m.suspendedReason; m.updatedAt = new Date().toISOString();
  touch("merchants2"); emit(m, "reactivated"); return m;
}
export function listMerchantAccounts(): StoredMerchant[] { return [...merchants.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
export function linkStats(merchantId: string): { total: number; active: number; invoices: number } {
  const ls = [...links.values()].filter((l) => l.merchantId === merchantId);
  return { total: ls.length, active: ls.filter((l) => !l.disabledAt).length, invoices: ls.filter((l) => l.kind === "invoice").length };
}

/** Opt a merchant into (or out of) the public "Pay with MoMo›Me" directory. */
/** Who pays the fee on this merchant's checkouts. */
export function setFeeMode(id: string, mode: "customer" | "merchant"): StoredMerchant | undefined {
  const m = merchants.get(id);
  if (!m) return undefined;
  m.feeMode = mode; m.updatedAt = new Date().toISOString();
  touch("merchants2");
  return m;
}

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

/** Account deletion: the merchant profile (business name, settlement number, location) is
 *  personal data tied to the device, so it goes with the device; its pay links stop
 *  resolving. Sales are payments and are retained under the same rule as every payment.
 *  Returns what was removed so the person can be told. */
export function forgetMerchant(owner: string): { merchant: boolean; links: number } {
  const id = ownerIndex.get(owner);
  if (!id) return { merchant: false, links: 0 };
  const m = merchants.get(id);
  let n = 0;
  for (const [code, l] of links) if (l.merchantId === id) { links.delete(code); n++; }
  merchants.delete(id); ownerIndex.delete(owner);
  if (m) codeIndex.delete(m.code);
  touch("merchants2");
  if (m) emit(m, "forgotten");
  return { merchant: true, links: n };
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

/* ---------- merchant-safe sale projection ---------- */
/** What a merchant may see of a payment made to them. The engine `Payment` carries the
 *  payer's device id, coarse location, the inbound pay instruction and payout ids — none of
 *  that is the merchant's to see; this is the only shape the merchant surfaces return. */
export function merchantSaleView(p: Payment, link?: MerchantLink): MerchantSale {
  const delivered = p.events.find((e) => e.state === "DELIVERED");
  return {
    id: p.id, ref: p.ref, state: p.state, displayStatus: p.displayStatus, method: p.method, source: p.source,
    xaf: p.xaf, feeXaf: p.feeXaf, totalXaf: p.totalXaf, feeBy: p.feeBy,
    linkCode: p.merchantLinkCode, label: link?.label, linkKind: link?.kind, clientName: link?.clientName,
    recipient: { name: p.recipient.name, phone: p.recipient.phone },
    createdAt: p.createdAt, deliveredAt: delivered?.at,
  };
}
/** Completed sales of a merchant as merchant-safe rows, newest first (link labels attached). */
export async function salesViewFor(m: MerchantAccount, opts: { completedOnly?: boolean; limit?: number } = {}): Promise<MerchantSale[]> {
  const all = await salesFor(m);
  const rows = (opts.completedOnly ? all.filter((p) => p.displayStatus === "Completed") : all).slice(0, opts.limit ?? all.length);
  return rows.map((p) => merchantSaleView(p, p.merchantLinkCode ? links.get(p.merchantLinkCode) : undefined));
}
/** Sales as a CSV the merchant can open in a spreadsheet (accounting, reconciliation). */
export function salesCsv(rows: MerchantSale[]): string {
  const esc = (v: unknown) => { const s = v === undefined || v === null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const head = ["date", "reference", "status", "received_xaf", "fee_xaf", "customer_paid_xaf", "fee_paid_by", "method", "link", "label", "client", "delivered_at"];
  const lines = rows.map((r) => [r.createdAt, r.ref, r.displayStatus, r.xaf, r.feeXaf, r.totalXaf, r.feeBy ?? "customer", r.method, r.linkCode ?? "", r.label ?? "", r.clientName ?? "", r.deliveredAt ?? ""].map(esc).join(","));
  return [head.join(","), ...lines].join("\n") + "\n";
}
