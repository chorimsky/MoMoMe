/* ============================================================
   Merchant Identity Graph (MIG) — MOMOMI's core differentiator.

   MTN/Orange don't let you decode a merchant CODE into a name/number, so MOMOMI
   builds its own persistent graph: it classifies any input (phone / merchant code
   / QR / alias), resolves it, falls back to an aggregator lookup, and otherwise
   creates a PENDING identity for confirmation. Every successful transaction LEARNS
   the code↔phone mapping and raises trust, so the second payment skips resolution.
   ============================================================ */
import type {
  Merchant, MerchantInputType, MerchantStatus, ResolveMerchantResult, ResolutionLogEntry,
  CountryCode, ProviderId, VerificationSource,
} from "../../../shared/types.js";
import { COUNTRIES } from "../../../shared/domain.js";
import { id } from "./ids.js";
import { register, touch } from "./persist.js";
import * as pawapay from "../adapters/pawapay.js";

const byId = new Map<string, Merchant>();
let counter = 0;
const resolutionLog: ResolutionLogEntry[] = [];

register(
  "merchants",
  () => ({ list: [...byId.values()], counter, log: resolutionLog.slice(0, 50) }),
  (d: { list: Merchant[]; counter: number; log?: ResolutionLogEntry[] }) => {
    for (const m of d.list) {
      // Migrate any legacy code-based Lightning address to the phone-based identity.
      m.lightningAddresses = lightningAddresses(m.phone);
      byId.set(m.internalId, m);
    }
    counter = d.counter;
    if (d.log) resolutionLog.push(...d.log);
  },
);

function logResolve(input: string, type: MerchantInputType, outcome: ResolutionLogEntry["outcome"]) {
  resolutionLog.unshift({ at: new Date().toISOString(), input, type, outcome });
  if (resolutionLog.length > 50) resolutionLog.pop();
  touch("merchants");
}
export function getResolutionLog(): ResolutionLogEntry[] {
  return resolutionLog.slice(0, 20);
}

/** Trust/fraud gate: should a payout to this number be held for manual review? */
export function payoutBlocked(phone: string): boolean {
  const m = findByPhone(phone);
  return !!m && (m.status === "flagged" || m.trustScore < 0.2);
}

// Function declarations (hoisted): the persistence restore() runs synchronously
// at module load — before const initializers — and calls digits() via
// lightningAddresses(). A const arrow here would be in the temporal dead zone
// then (ReferenceError → merchants fail to restore). Keep these hoisted.
function digits(s: string): string { return s.replace(/\D/g, ""); }
function nsn(d: string): string { return d.length > 9 ? d.slice(-9) : d; } // national significant number

/* ---------- classifier: what kind of input is this? ---------- */
export function classify(raw: string): { type: MerchantInputType; value: string } {
  const s = raw.trim();
  // QR: a momomi: URI or a JSON blob with a code/phone inside.
  if (/^momomi:/i.test(s) || (s.startsWith("{") && s.endsWith("}"))) {
    let inner = s.replace(/^momomi:/i, "");
    try { const o = JSON.parse(inner) as { code?: string; phone?: string }; inner = o.code ?? o.phone ?? inner; } catch { /* uri form */ }
    return classify(inner);
  }
  // Merchant code: MOMO-xxxx, a USSD/POS code (*126*…#), or an uppercase alnum tag.
  if (/^MOMO-/i.test(s) || /^[*#]\d/.test(s) || /^[A-Z0-9]{4,}$/.test(s.replace(/[\s-]/g, "")) && /[A-Z]/.test(s)) {
    return { type: "merchant_code", value: s.toUpperCase().replace(/\s/g, "") };
  }
  // Phone: 8–12 digits once stripped.
  const d = digits(s);
  if (d.length >= 8 && d.length <= 12) return { type: "phone", value: s };
  // Otherwise treat as a saved alias / merchant name.
  return { type: "alias", value: s };
}

/* ---------- lookups ---------- */
function findByCode(code: string): Merchant | undefined {
  const c = code.toUpperCase();
  return [...byId.values()].find((m) => m.merchantCode?.toUpperCase() === c);
}
function findByPhone(phone: string): Merchant | undefined {
  const k = nsn(digits(phone));
  return [...byId.values()].find((m) => m.phone && nsn(digits(m.phone)) === k);
}
function findByAlias(alias: string): Merchant | undefined {
  const a = alias.toLowerCase();
  return [...byId.values()].find((m) => m.displayName.toLowerCase() === a);
}

export function getMerchant(internalId: string): Merchant | undefined {
  return byId.get(internalId);
}
export function listMerchants(): Merchant[] {
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/* ---------- create / upsert ---------- */
/** A merchant's Lightning identity is its PHONE NUMBER — the routable Mobile Money
 *  account it settles to — NEVER its merchant code, which is only a lookup label
 *  (a POS/MOMO code can't receive funds). Empty until a phone is known. */
function lightningAddresses(phone: string | null): string[] {
  return phone ? [`${digits(phone)}@momomi.io`] : [];
}

interface NewMerchant {
  merchantCode?: string | null;
  phone?: string | null;
  country?: CountryCode | null;
  displayName: string;
  provider?: ProviderId | null;
  aggregatorRef?: string | null;
  trustScore: number;
  verificationSource: VerificationSource;
  status: MerchantStatus;
}
function create(m: NewMerchant): Merchant {
  counter += 1;
  const now = new Date().toISOString();
  const merchant: Merchant = {
    internalId: id("mer"),
    merchantCode: m.merchantCode ?? null,
    phone: m.phone ?? null,
    country: m.country ?? null,
    displayName: m.displayName,
    provider: m.provider ?? null,
    aggregatorRef: m.aggregatorRef ?? null,
    lightningAddresses: lightningAddresses(m.phone ?? null),
    trustScore: m.trustScore,
    verificationSource: m.verificationSource,
    status: m.status,
    txCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  byId.set(merchant.internalId, merchant);
  touch("merchants");
  return merchant;
}

/* ---------- the resolution engine ---------- */
export async function resolveMerchant(
  rawInput: string,
  hint?: { country?: CountryCode; provider?: ProviderId },
  createIfMissing = true,
): Promise<ResolveMerchantResult> {
  const { type, value } = classify(rawInput);

  // 1. Identity-graph lookup.
  let merchant =
    type === "merchant_code" ? findByCode(value)
    : type === "phone" ? findByPhone(value)
    : findByAlias(value);

  if (merchant) {
    const resolved = merchant.status === "active" && merchant.trustScore >= 0.3;
    logResolve(rawInput, type, resolved ? "resolved" : "pending");
    return { inputType: type, merchant, resolved, needsConfirmation: !resolved };
  }

  // Lookup-only (e.g. as-you-type): never create graph entries on a miss.
  if (!createIfMissing) {
    logResolve(rawInput, type, "miss");
    return { inputType: type, merchant: null, resolved: false, needsConfirmation: true };
  }

  // 2. Aggregator lookup (only a phone can be name-resolved by the operator).
  if (type === "phone") {
    const hit = await pawapay.lookupName(value);
    if (hit?.name) {
      merchant = create({
        phone: value, country: hint?.country ?? null, provider: hint?.provider ?? null,
        displayName: hit.name, aggregatorRef: `pawapay:${digits(value)}`,
        trustScore: 0.6, verificationSource: "aggregator", status: "active",
      });
      logResolve(rawInput, type, "resolved");
      return { inputType: type, merchant, resolved: true, needsConfirmation: false };
    }
  }

  // 3. Nothing found → create a PENDING identity that needs confirmation.
  merchant = create({
    merchantCode: type === "merchant_code" ? value : null,
    phone: type === "phone" ? value : null,
    country: hint?.country ?? null, provider: hint?.provider ?? null,
    displayName: type === "alias" ? value : "Unconfirmed merchant",
    trustScore: 0.1, verificationSource: "unverified", status: "pending",
  });
  logResolve(rawInput, type, "pending");
  return { inputType: type, merchant, resolved: false, needsConfirmation: true };
}

/* ---------- the learning loop (called on a successful payout) ---------- */
export function recordSuccessfulPayout(opts: { phone: string; name: string; provider: ProviderId; country: CountryCode; merchantCode?: string | null; aggregatorRef?: string | null }): Merchant {
  let merchant = findByPhone(opts.phone) ?? (opts.merchantCode ? findByCode(opts.merchantCode) : undefined);
  if (!merchant) {
    merchant = create({
      phone: opts.phone, merchantCode: opts.merchantCode ?? null, country: opts.country,
      displayName: opts.name, provider: opts.provider, aggregatorRef: opts.aggregatorRef ?? null,
      trustScore: 0.6, verificationSource: "aggregator", status: "active",
    });
  }
  // Learn: attach the code↔phone mapping, fill gaps, raise trust, activate.
  if (opts.merchantCode && !merchant.merchantCode) merchant.merchantCode = opts.merchantCode;
  if (!merchant.phone) merchant.phone = opts.phone;
  if (!merchant.provider) merchant.provider = opts.provider;
  if (!merchant.country) merchant.country = opts.country;
  if (opts.aggregatorRef) merchant.aggregatorRef = opts.aggregatorRef;
  merchant.lightningAddresses = lightningAddresses(merchant.phone);
  merchant.txCount += 1;
  merchant.trustScore = Math.min(1, merchant.trustScore + 0.1); // each success raises trust
  merchant.status = "active";
  merchant.updatedAt = new Date().toISOString();
  byId.set(merchant.internalId, merchant);
  touch("merchants");
  return merchant;
}

/* ---------- admin actions ---------- */
export function validateMerchant(internalId: string, displayName?: string): Merchant | null {
  const m = byId.get(internalId);
  if (!m) return null;
  if (displayName) m.displayName = displayName;
  m.verificationSource = "admin";
  m.status = "active";
  m.trustScore = Math.max(m.trustScore, 0.9);
  m.updatedAt = new Date().toISOString();
  touch("merchants");
  return m;
}
export function flagMerchant(internalId: string): Merchant | null {
  const m = byId.get(internalId);
  if (!m) return null;
  m.status = "flagged";
  m.trustScore = Math.min(m.trustScore, 0.1);
  m.updatedAt = new Date().toISOString();
  touch("merchants");
  return m;
}
/** Merge `dupeId` into `keepId`, combining code/phone/aggregator and tx counts. */
export function mergeMerchants(keepId: string, dupeId: string): Merchant | null {
  const keep = byId.get(keepId);
  const dupe = byId.get(dupeId);
  if (!keep || !dupe || keepId === dupeId) return null;
  keep.merchantCode ??= dupe.merchantCode;
  keep.phone ??= dupe.phone;
  keep.provider ??= dupe.provider;
  keep.country ??= dupe.country;
  keep.aggregatorRef ??= dupe.aggregatorRef;
  keep.txCount += dupe.txCount;
  keep.trustScore = Math.max(keep.trustScore, dupe.trustScore);
  keep.lightningAddresses = lightningAddresses(keep.phone);
  keep.updatedAt = new Date().toISOString();
  byId.delete(dupeId);
  touch("merchants");
  return keep;
}

export function merchantStats() {
  const all = [...byId.values()];
  return {
    total: all.length,
    active: all.filter((m) => m.status === "active").length,
    pending: all.filter((m) => m.status === "pending").length,
    flagged: all.filter((m) => m.status === "flagged").length,
    withCode: all.filter((m) => m.merchantCode).length,
  };
}

/** Seed a few merchants so the graph isn't empty on first boot. */
export function seedMerchants() {
  if (byId.size > 0) return;
  const seeds: NewMerchant[] = [
    { merchantCode: "MOMO-4821", phone: "6 82 41 09 33", country: "CM" as CountryCode, provider: "MTN" as ProviderId, displayName: "ALIMENTATION MBARGA", trustScore: 0.9, verificationSource: "admin", status: "active" },
    { merchantCode: "MOMO-7710", phone: "6 90 55 18 72", country: "CM" as CountryCode, provider: "ORANGE" as ProviderId, displayName: "PHARMACIE FOTSO", trustScore: 0.7, verificationSource: "aggregator", status: "active" },
    { phone: "0 74 22 88 10", country: "GA" as CountryCode, provider: "AIRTEL" as ProviderId, displayName: "OWONA QUINCAILLERIE", trustScore: 0.5, verificationSource: "aggregator", status: "active" },
    { merchantCode: "POS-CM-2299", country: "CM" as CountryCode, provider: "MTN" as ProviderId, displayName: "Unconfirmed merchant", trustScore: 0.1, verificationSource: "unverified", status: "pending" },
  ];
  for (const s of seeds) create(s);
}

export { COUNTRIES };
