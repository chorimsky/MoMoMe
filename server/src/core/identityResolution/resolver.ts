/* ============================================================
   The Identity Resolver — orchestration.

   normalize → operator → cache → providers in configured priority for this operator →
   name match → cache → audit. Fallback to the next provider ONLY on a retryable failure
   (timeout / unavailable / auth) — never on NOT_FOUND or INACTIVE, which are answers. No
   uncontrolled retries: at most IDENTITY_MAX_RETRIES (default 0) extra attempts per
   provider, each bounded by IDENTITY_TIMEOUT (ms, default 6000).
   ============================================================ */
import { randomUUID } from "node:crypto";
import type { IdentityResolution, IdentityPurpose, IdentityCapabilityConfig, IdentityProviderHealth, RecipientIdentitySnapshot } from "../../../../shared/identity.js";
import { normalizeMsisdn, identifierHash, last4 } from "./msisdn.js";
import { IdentityError, STATUS_FOR_ERROR } from "./errors.js";
import type { IdentityProvider, ProviderAnswer } from "./providers/types.js";
import { mtnDirect } from "./providers/mtnDirect.js";
import { orangeDirect } from "./providers/orange.js";
import { aggregator } from "./providers/aggregator.js";
import { peexitVerify } from "./providers/peexit.js";
import { sandboxProvider } from "./providers/sandbox.js";
import { cached, remember, cacheTtlSec } from "./cache.js";
import { record } from "./audit.js";
import { matchNames } from "./names.js";
import { liveMoney } from "../../config.js";
import { MARKETS } from "../network/markets.js";

export const identityEnabled = () => (process.env.IDENTITY_RESOLUTION_ENABLED ?? "").trim().toLowerCase() === "true";
/** ADVISORY: resolve + show; the V1 payment executes regardless. GATE: a later decision. */
export const identityMode = (): "advisory" | "gate" => ((process.env.IDENTITY_RESOLUTION_MODE ?? "advisory").toLowerCase() === "gate" ? "gate" : "advisory");
const TIMEOUT_MS = () => Math.max(1000, Number(process.env.IDENTITY_TIMEOUT ?? 6000) || 6000);
const MAX_RETRIES = () => Math.min(2, Math.max(0, Number(process.env.IDENTITY_MAX_RETRIES ?? 0) || 0));

const ALL: Record<string, IdentityProvider> = { mtn_direct: mtnDirect, orange_direct: orangeDirect, peexit_verify: peexitVerify, pawapay: aggregator, sandbox: sandboxProvider };
/** IDENTITY_PROVIDER_PRIORITY="mtn_direct,orange_direct,peexit_verify,pawapay,sandbox" — first that is
 *  configured and supports the market × operator answers; the next is tried only on a
 *  retryable failure. */
export function providerChain(country: string, operator: string | null): IdentityProvider[] {
  const order = (process.env.IDENTITY_PROVIDER_PRIORITY ?? "mtn_direct,orange_direct,peexit_verify,pawapay,sandbox").split(",").map((s) => s.trim()).filter((s) => s in ALL);
  return order.map((k) => ALL[k]).filter((p) => p.configured() && p.supports(country, operator) && (p.authoritative || p.name === "pawapay" || !liveMoney()));
}
export async function providersHealth(): Promise<IdentityProviderHealth[]> { return Promise.all(Object.values(ALL).map((p) => p.health())); }

/** Capability table: what an AUTHORIZED, configured provider actually gives us per market ×
 *  operator — never an assumption. */
export function capabilityConfig(): Record<string, Record<string, IdentityCapabilityConfig>> {
  const out: Record<string, Record<string, IdentityCapabilityConfig>> = {};
  for (const [code, m] of Object.entries(MARKETS)) {
    out[code] = {};
    for (const p of m.providers) {
      const chain = providerChain(code, p.id).filter((x) => x.authoritative);
      out[code][p.id] = { identity_resolution: chain.length > 0, payout: p.payout, collection: p.collect, provider: chain[0]?.name ?? null };
    }
  }
  return out;
}

export interface ResolveInput { identifier: string; purpose: IdentityPurpose; actor: string; expectedName?: string; paymentIntentId?: string; correlationId?: string; defaultCountry?: string; bypassCache?: boolean }

export async function resolveIdentity(input: ResolveInput): Promise<IdentityResolution> {
  const requestId = `idq_${randomUUID().slice(0, 12)}`;
  const t0 = Date.now();
  const base = (overrides: Partial<IdentityResolution>, id?: ReturnType<typeof normalizeMsisdn>): IdentityResolution => ({
    identifier: id?.identifier ?? input.identifier, identifierType: "MSISDN", country: id?.country ?? "", operator: id?.operator ?? null, currency: id?.currency ?? null,
    status: "UNKNOWN", verified: false, accountStatus: "UNKNOWN", capabilities: { mobile_money: false, receive: false, send: false, payout: false, collection: false },
    provider: { name: "none" }, source: "none", requestId, ...overrides,
  });
  let id: ReturnType<typeof normalizeMsisdn>;
  try { id = normalizeMsisdn(input.identifier, input.defaultCountry ?? "CM"); }
  catch (e) {
    const err = e as IdentityError;
    record({ requestId, correlationId: input.correlationId, actor: input.actor, purpose: input.purpose, identifierHash: identifierHash(input.identifier.replace(/\D/g, "")), country: "", operator: null, provider: "none", status: "ERROR", error: err.code, latencyMs: Date.now() - t0, cache: "bypass", at: new Date().toISOString() });
    throw err;
  }
  const hash = identifierHash(id.identifier);
  const finish = (r: IdentityResolution, cache: "hit" | "miss" | "bypass") => {
    record({ requestId, correlationId: input.correlationId, actor: input.actor, purpose: input.purpose, identifierHash: hash, country: id.country, operator: r.operator, provider: r.provider.name, status: r.status, error: r.error, latencyMs: Date.now() - t0, cache, at: new Date().toISOString() });
    return r;
  };
  // Cache: a fresh VERIFIED / NOT_FOUND / INACTIVE answer is reused within the TTL.
  if (!input.bypassCache) {
    const c = cached(hash);
    if (c) {
      const r = base({ country: c.country, operator: c.operator, currency: c.currency, status: c.verificationStatus, verified: c.verificationStatus === "VERIFIED", displayName: c.displayName, accountStatus: c.accountStatus, capabilities: caps(c.verificationStatus === "VERIFIED"), provider: { name: c.provider, reference: c.providerReference, verifiedAt: c.verifiedAt }, source: "cache", expiresAt: c.expiresAt, nameMatch: matchNames(input.expectedName, c.displayName) }, id);
      return finish(r, "hit");
    }
  }
  if (!id.operator) return finish(base({ status: "UNSUPPORTED", error: "IDENTITY_UNSUPPORTED_OPERATOR" }, id), "bypass");
  const chain = providerChain(id.country, id.operator);
  if (!chain.length) return finish(base({ status: "UNSUPPORTED", error: "IDENTITY_UNSUPPORTED_OPERATOR", capabilities: caps(false) }, id), "bypass");
  let lastErr: IdentityError | null = null;
  let operatorHint: string | null = null;
  for (const p of chain) {
    for (let attempt = 0; attempt <= MAX_RETRIES(); attempt++) {
      try {
        const a: ProviderAnswer = await p.resolve(id, { purpose: input.purpose, requestId, actor: input.actor, paymentIntentId: input.paymentIntentId, timeoutMs: TIMEOUT_MS() });
        if (a.operator && a.operator !== id.operator) operatorHint = a.operator;
        if (!p.authoritative && p.name === "pawapay") { operatorHint = a.operator ?? operatorHint; continue; } // reachability only — keep looking for an authoritative answer
        const r = base({ ...a, operator: a.operator ?? id.operator, source: p.name === "sandbox" ? "sandbox" : "provider", nameMatch: a.status === "VERIFIED" ? matchNames(input.expectedName, a.displayName) : "NOT_AVAILABLE" }, id);
        if (r.status === "VERIFIED" || r.status === "NOT_FOUND" || r.status === "INACTIVE") { const rec = remember(hash, last4(id.identifier), r); r.expiresAt = rec.expiresAt; }
        return finish(r, "miss");
      } catch (e) {
        lastErr = e instanceof IdentityError ? e : new IdentityError("IDENTITY_PROVIDER_UNAVAILABLE", "Recipient verification is temporarily unavailable.", (e as Error)?.message, true);
        if (!lastErr.retryable) break; // auth error etc.: do not hammer; try the next provider
      }
    }
    // Only a retryable failure reaches here → fall through to the next provider.
  }
  // Every answering provider failed (or only the aggregator was there): say so honestly.
  // The sandbox counts as an answering provider — its simulated timeout must surface as
  // PROVIDER_UNAVAILABLE exactly like a real one, never as UNKNOWN or NOT_FOUND.
  const answererTried = chain.some((p) => p.authoritative || p.name === "sandbox");
  if (!answererTried) return finish(base({ status: "UNKNOWN", operator: operatorHint ?? id.operator, capabilities: caps(true), provider: { name: "pawapay" } }, id), "bypass");
  const code = lastErr?.code ?? "IDENTITY_PROVIDER_UNAVAILABLE";
  return finish(base({ status: STATUS_FOR_ERROR[code] ?? "PROVIDER_UNAVAILABLE", error: code, operator: operatorHint ?? id.operator }, id), "bypass");
}

/** The immutable snapshot a payment carries. Built from a resolution (never from input). */
export function snapshotOf(r: IdentityResolution): RecipientIdentitySnapshot {
  return { identifier: r.identifier, country: r.country, operator: r.operator, currency: r.currency, status: r.status, verified: r.verified, displayName: r.displayName, provider: r.provider.name, verifiedAt: r.provider.verifiedAt, nameMatch: r.nameMatch, requestId: r.requestId };
}
/** For the payment path: the freshest usable answer WITHOUT calling a provider. */
export function cachedSnapshot(identifier: string, defaultCountry = "CM"): RecipientIdentitySnapshot | null {
  try {
    const id = normalizeMsisdn(identifier, defaultCountry);
    const c = cached(identifierHash(id.identifier));
    if (!c) return null;
    return { identifier: id.identifier, country: c.country, operator: c.operator, currency: c.currency, status: c.verificationStatus, verified: c.verificationStatus === "VERIFIED", displayName: c.displayName, provider: c.provider, verifiedAt: c.verifiedAt, requestId: `cache:${c.id}` };
  } catch { return null; }
}
export const cacheTtl = cacheTtlSec;
const caps = (ok: boolean) => ({ mobile_money: true, receive: ok, send: ok, payout: ok, collection: ok });
