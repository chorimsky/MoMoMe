/* ============================================================
   MoMo›Me Connect — Payment Identity (MPI).

   One identity per person / company / institution, with ALIASES (phone, email, MoMo›Me id,
   merchant code, Lightning address, API recipient id) and a PAYMENT PROFILE (how value can
   reach it) + SETTLEMENT PROFILE (how it wants to be paid). The MPI is the addressability
   layer; the phone number is one alias among several — never the key.

   Bridging, not rewriting (docs/connect/ARCHITECTURE_ASSESSMENT "Conflicts"): the existing
   phone-keyed recipient identities, merchant accounts and API organizations are NOT
   changed. An MPI is created lazily the first time one of them is addressed through
   Connect and their identifiers become its aliases. Nothing that works today changes key.
   ============================================================ */
import crypto from "node:crypto";
import { register, touch } from "../persist.js";
import { COUNTRIES, checkPhone, splitDialed, lightningAddress } from "../../../../shared/domain.js";
import type { CountryCode, ProviderId } from "../../../../shared/types.js";
import { getOrganization } from "../platform/orgs.js";
import { merchantByCode, merchantById } from "../merchantAccount.js";
import { enqueueEvent } from "../interop/outbound.js";

export type MpiType = "individual" | "business" | "merchant" | "institution" | "mfi" | "bank" | "fintech" | "marketplace" | "branch" | "application" | "government";
export type AliasType = "phone" | "email" | "momome_id" | "merchant_code" | "lightning_address" | "api_recipient_id" | "organization" | "external_id";
export type PaymentMethodId = "momo_me" | "mobile_money" | "bank_transfer" | "lightning" | "stablecoin";
export type SettlementMethodId = "momo_me" | "mobile_money" | "bank_transfer" | "lightning" | "stablecoin";
export type Capability = "receive" | "send" | "lightning_receive" | "lightning_send" | "lightning_invoice" | "lightning_address" | "lightning_qr" | "lightning_payout" | "invoice" | "checkout" | "payout";

export interface Alias { type: AliasType; value: string; verified: boolean; addedAt: string; primary?: boolean }
export interface SettlementProfile {
  currency: string; preferred: SettlementMethodId; fallback: SettlementMethodId[];
  destination?: { phone?: string; country?: CountryCode; operator?: ProviderId; bank?: string; account?: string; lightning_address?: string; stablecoin?: { asset: string; network: string; address: string } };
  allowLightning: boolean; allowStablecoin: boolean; autoConvert: boolean; frequency: "instant" | "daily" | "weekly" | "manual";
}
export interface PaymentProfile {
  methods: PaymentMethodId[]; preferred: PaymentMethodId[]; currencies: string[]; capabilities: Capability[];
  lightningEnabled: boolean; stablecoinEnabled: boolean; momoBalance: boolean;
  limitsRef?: string; compliance: "unverified" | "pending" | "verified" | "blocked"; risk: "low" | "medium" | "high"; businessStatus: "active" | "suspended" | "closed";
}
export interface Mpi {
  id: string; type: MpiType; displayName: string; country: CountryCode; createdAt: string; updatedAt: string;
  aliases: Alias[]; payment: PaymentProfile; settlement: SettlementProfile;
  /** Which API organization administers this identity (a business's own MPI). */
  orgId?: string; /** Legacy links so historical records stay attached. */ links: { recipientIdentityKey?: string; merchantId?: string; deviceId?: string };
  status: "active" | "suspended" | "closed";
}

const mpis = new Map<string, Mpi>();
const byAlias = new Map<string, string>(); // `${type}:${normalized}` -> mpi id
register("connect_mpis", () => [...mpis.values()], (d: Mpi[]) => { for (const m of d) { mpis.set(m.id, m); for (const a of m.aliases) byAlias.set(aliasKey(a.type, a.value), m.id); } });

const now = () => new Date().toISOString();
export const newMpiId = () => `mpi_${crypto.randomBytes(9).toString("hex")}`;

/** Canonical form of an alias value. Phone → E.164 digits; email/addresses lower-cased. */
export function normalizeAlias(type: AliasType, raw: string, country: CountryCode = "CM"): string | null {
  const v = raw.trim();
  if (!v) return null;
  if (type === "phone") { const sp = splitDialed(v, country); const c = checkPhone(sp.local, sp.country); return c.ok ? `${COUNTRIES[sp.country].dial.replace(/\D/g, "")}${c.local}` : null; }
  if (type === "email" || type === "lightning_address") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
  if (type === "momome_id") return /^mpi_[0-9a-f]{18}$/.test(v) ? v : null;
  return v.slice(0, 120);
}
const aliasKey = (type: AliasType, value: string) => `${type}:${value}`;

export function getMpi(id: string): Mpi | undefined { return mpis.get(id); }
export function findByAlias(type: AliasType, raw: string, country: CountryCode = "CM"): Mpi | undefined {
  const n = normalizeAlias(type, raw, country); if (!n) return undefined;
  const id = byAlias.get(aliasKey(type, n)); return id ? mpis.get(id) : undefined;
}
export function listMpis(filter: { orgId?: string; type?: MpiType } = {}): Mpi[] { return [...mpis.values()].filter((m) => (!filter.orgId || m.orgId === filter.orgId) && (!filter.type || m.type === filter.type)); }

const defaultPayment = (type: MpiType): PaymentProfile => ({ methods: ["lightning", "stablecoin", "mobile_money", "momo_me"], preferred: ["momo_me", "lightning"], currencies: ["XAF"], capabilities: ["receive", "lightning_receive", "lightning_invoice", "lightning_address", "lightning_qr", "invoice", "checkout"], lightningEnabled: true, stablecoinEnabled: true, momoBalance: type !== "individual", compliance: "unverified", risk: "low", businessStatus: "active" });
const defaultSettlement = (country: CountryCode, dest?: SettlementProfile["destination"]): SettlementProfile => ({ currency: COUNTRIES[country]?.ccy ?? "XAF", preferred: dest?.phone ? "mobile_money" : "momo_me", fallback: dest?.phone ? ["momo_me"] : [], destination: dest, allowLightning: false, allowStablecoin: false, autoConvert: true, frequency: "instant" });

export interface CreateMpiInput { type: MpiType; displayName: string; country?: CountryCode; aliases?: Array<{ type: AliasType; value: string; verified?: boolean }>; orgId?: string; settlement?: Partial<SettlementProfile>; links?: Mpi["links"] }
export function createMpi(input: CreateMpiInput): { ok: true; mpi: Mpi } | { ok: false; error: string } {
  const country = (input.country ?? "CM") as CountryCode;
  if (!COUNTRIES[country]) return { ok: false, error: "country_unsupported" };
  const aliases: Alias[] = [];
  for (const a of input.aliases ?? []) {
    const n = normalizeAlias(a.type, a.value, country); if (!n) return { ok: false, error: `alias_invalid:${a.type}` };
    if (byAlias.has(aliasKey(a.type, n))) return { ok: false, error: `alias_taken:${a.type}` };
    aliases.push({ type: a.type, value: n, verified: !!a.verified, addedAt: now(), primary: aliases.length === 0 });
  }
  const id = newMpiId();
  aliases.push({ type: "momome_id", value: id, verified: true, addedAt: now() });
  const phoneAlias = aliases.find((a) => a.type === "phone");
  const dest = input.settlement?.destination ?? (phoneAlias ? { phone: phoneAlias.value, country } : undefined);
  const m: Mpi = { id, type: input.type, displayName: input.displayName.trim().slice(0, 120), country, createdAt: now(), updatedAt: now(), aliases, payment: defaultPayment(input.type), settlement: { ...defaultSettlement(country, dest), ...(input.settlement ?? {}), destination: dest }, orgId: input.orgId, links: input.links ?? {}, status: "active" };
  // Every MPI with a phone alias is reachable as a Lightning Address through the existing LNURL surface.
  if (phoneAlias) { const sp = splitDialed(`+${phoneAlias.value}`, country); const ln = lightningAddress(sp.local, sp.country); if (!byAlias.has(aliasKey("lightning_address", ln))) m.aliases.push({ type: "lightning_address", value: ln, verified: true, addedAt: now() }); }
  mpis.set(id, m); for (const a of m.aliases) byAlias.set(aliasKey(a.type, a.value), id); touch("connect_mpis");
  if (input.orgId) enqueueEvent(`org:${input.orgId}`, "identity.created", publicMpi(m));
  return { ok: true, mpi: m };
}
export function addAlias(id: string, type: AliasType, raw: string, verified = false): { ok: true; mpi: Mpi } | { ok: false; error: string } {
  const m = mpis.get(id); if (!m) return { ok: false, error: "identity_not_found" };
  const n = normalizeAlias(type, raw, m.country); if (!n) return { ok: false, error: "alias_invalid" };
  const holder = byAlias.get(aliasKey(type, n)); if (holder && holder !== id) return { ok: false, error: "alias_taken" };
  if (!holder) {
    m.aliases.push({ type, value: n, verified, addedAt: now() }); byAlias.set(aliasKey(type, n), id);
    // A phone alias makes the identity reachable as a Lightning Address (the LNURL surface keys on the number).
    if (type === "phone" && !m.aliases.some((a) => a.type === "lightning_address")) { const sp = splitDialed(`+${n}`, m.country); const ln = lightningAddress(sp.local, sp.country); if (!byAlias.has(aliasKey("lightning_address", ln))) { m.aliases.push({ type: "lightning_address", value: ln, verified: true, addedAt: now() }); byAlias.set(aliasKey("lightning_address", ln), id); } }
    if (type === "phone" && !m.settlement.destination?.phone) { const sp = splitDialed(`+${n}`, m.country); m.settlement.destination = { ...(m.settlement.destination ?? {}), phone: n, country: sp.country }; }
    m.updatedAt = now(); touch("connect_mpis"); if (m.orgId) enqueueEvent(`org:${m.orgId}`, "identity.updated", publicMpi(m));
  }
  return { ok: true, mpi: m };
}
export function updateProfiles(id: string, patch: { payment?: Partial<PaymentProfile>; settlement?: Partial<SettlementProfile>; displayName?: string; type?: MpiType }): Mpi | undefined {
  const m = mpis.get(id); if (!m) return undefined;
  if (patch.displayName) m.displayName = patch.displayName.trim().slice(0, 120);
  if (patch.type) m.type = patch.type;
  if (patch.payment) m.payment = { ...m.payment, ...patch.payment };
  if (patch.settlement) m.settlement = { ...m.settlement, ...patch.settlement, destination: { ...(m.settlement.destination ?? {}), ...(patch.settlement.destination ?? {}) } };
  m.updatedAt = now(); touch("connect_mpis");
  if (m.orgId) enqueueEvent(`org:${m.orgId}`, "identity.updated", publicMpi(m));
  return m;
}

/* ---------- lazy bridges to the existing identity families ---------- */
/** The MPI an API organization acts as. Created on first use; the org's id is an alias. */
export function mpiForOrganization(orgId: string): Mpi | undefined {
  const ex = findByAlias("organization", orgId); if (ex) return ex;
  const org = getOrganization(orgId); if (!org) return undefined;
  const r = createMpi({ type: "business", displayName: org.name, country: (COUNTRIES[org.country as CountryCode] ? org.country : "CM") as CountryCode, aliases: [{ type: "organization", value: orgId, verified: true }], orgId });
  return r.ok ? r.mpi : undefined;
}
/** The MPI behind a Mobile Money number (an external recipient, or a merchant's settlement number). */
export function mpiForPhone(raw: string, country: CountryCode = "CM", displayName?: string): Mpi | undefined {
  const ex = findByAlias("phone", raw, country); if (ex) return ex;
  const n = normalizeAlias("phone", raw, country); if (!n) return undefined;
  const sp = splitDialed(`+${n}`, country);
  const r = createMpi({ type: "individual", displayName: displayName ?? `+${n}`, country: sp.country, aliases: [{ type: "phone", value: n, verified: false }], links: { recipientIdentityKey: n } });
  return r.ok ? r.mpi : undefined;
}
/** The MPI of a merchant account (code MOM-CM-…); settles to its settlement number. */
export function mpiForMerchant(codeOrId: string): Mpi | undefined {
  const ex = findByAlias("merchant_code", codeOrId); if (ex) return ex;
  const mer = merchantByCode(codeOrId) ?? merchantById(codeOrId); if (!mer) return undefined;
  const exByCode = findByAlias("merchant_code", mer.code); if (exByCode) return exByCode;
  const phoneMpi = findByAlias("phone", mer.settlementPhone, mer.country);
  if (phoneMpi) { addAlias(phoneMpi.id, "merchant_code", mer.code, true); updateProfiles(phoneMpi.id, { type: "merchant", displayName: mer.businessName }); phoneMpi.links.merchantId = mer.id; return phoneMpi; }
  const r = createMpi({ type: "merchant", displayName: mer.businessName, country: mer.country, aliases: [{ type: "merchant_code", value: mer.code, verified: true }, { type: "phone", value: mer.settlementPhone, verified: mer.verifiedPhone }], links: { merchantId: mer.id } });
  return r.ok ? r.mpi : undefined;
}

/** What another party may see (docs/connect §33): reachability and capabilities, never balances or destinations. */
export function publicMpi(m: Mpi) {
  return { id: m.id, object: "identity", type: m.type, display_name: m.displayName, country: m.country, status: m.status, aliases: m.aliases.filter((a) => a.type !== "organization" && a.type !== "external_id").map((a) => ({ type: a.type, value: a.type === "phone" ? `+${a.value}` : a.value, verified: a.verified })), payment_methods: m.payment.methods, capabilities: m.payment.capabilities, lightning_enabled: m.payment.lightningEnabled, currencies: m.payment.currencies, created_at: m.createdAt };
}
/** The owner's full view (includes the settlement profile). */
export function ownerMpi(m: Mpi) { return { ...publicMpi(m), settlement: m.settlement, payment_profile: m.payment, links: m.links }; }
export function _resetMpis(): void { mpis.clear(); byAlias.clear(); }
