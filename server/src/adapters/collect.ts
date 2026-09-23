/* ============================================================
   COLLECTION RAILS — taking money IN from a customer's Mobile Money wallet.

   The payout side has had a provider registry since the beginning (adapters/payouts.ts):
   several rails can pay the same operator, the funded and cheaper one is chosen, and a
   failure fails over. Collection had none — it called one aggregator directly from
   core/momoTransfer.ts, so there was no way to add MTN's or Orange's own Collection API,
   no per-provider limits or fees, and no failover. Merchant payment acceptance is exactly
   the product that needs all three, so collection gets the same treatment.

   The interface is deliberately the mirror image of PayoutAdapter, because the operational
   questions are the same: is this rail configured, is it real money, does it serve this
   operator, what does it cost, what are its limits, is it healthy, and what does the
   provider authoritatively say about one request.

   WHAT AN ADAPTER MAY AND MAY NOT DO
     • It may implement only what its provider documents. Nothing here infers undocumented
       behaviour — an unknown response is an unknown status, never an optimistic one.
     • It never sees or stores a customer's PIN. Authorisation happens on the customer's own
       handset, inside the operator's own flow; we only ask for it and then ask what happened.
     • `collect()` is idempotent on `idempotencyKey`: the same key must never produce two
       debits, whatever the network did.
     • A collection is ASYNCHRONOUS. `collect()` returning "accepted" means the request
       reached the payer, not that money moved. Only `status()` decides, and only the
       provider's own record is authoritative — never a callback body alone.

   ADD A RAIL: implement CollectAdapter, append it to COLLECTORS. Nothing else changes.
   ============================================================ */
import type { CountryCode, ProviderId } from "../../../shared/types.js";
import { peexitConfigured, peexitLive } from "../config.js";
import { getSettings } from "../core/settings.js";
import * as peexit from "./peexit.js";
import { mtnCollector } from "./mtnCollect.js";
import { orangeCollector } from "./orangeCollect.js";

/** What the caller asks for. Mirrors DisburseRequest: the same corridor language. */
export interface CollectRequest {
  /** Our own reference. The rail MUST treat a repeat as the same request, not a second one. */
  idempotencyKey: string;
  /** The operator the payer's wallet belongs to. */
  provider: ProviderId;
  country: CountryCode;
  /** The payer we are collecting FROM. */
  phone: string;
  xaf: number;
  /** Shown to the payer by some operators ("pay X"); never a credential. */
  name?: string;
  /** What the payer sees as the reason, where the rail supports it. */
  narration?: string;
}

export interface CollectResult {
  /** "accepted" — the request is with the payer. "duplicate" — this key was already used. */
  status: "accepted" | "duplicate";
  /** The provider's own id for the request, for reconciliation and support. */
  providerRef: string;
  /** True when no real money can move (no credentials / sandbox): the caller simulates. */
  simulated: boolean;
  /** HOSTED rails only (Orange Web Payment): the page the payer must open to complete the
   *  payment. A handset-prompt rail (MTN request-to-pay, an aggregator) leaves this unset.
   *  A caller that cannot put this in front of the payer must not use such a rail — the
   *  payer would be waiting for a prompt that never comes. */
  paymentUrl?: string;
}

/** The only three answers that matter. PENDING means "the payer has not decided yet" —
 *  it is NOT an error, and it must never be settled or refunded on. */
export type CollectStatus = "COMPLETED" | "FAILED" | "PENDING";

/** What a rail will accept for one collection, in XAF. Absent bound = rail does not say. */
export interface CollectLimits { minXaf?: number; maxXaf?: number }

export interface CollectAdapter {
  /** Stable id — also the `/webhooks/collect/<name>` segment and the stored rail name. */
  readonly name: string;
  /** Preference when several configured rails serve an operator: LOWER wins. */
  readonly priority: number;
  /** Real credentials present → this rail can collect for real. */
  configured(): boolean;
  /** Production (moves real money). A sandbox-configured rail is configured() but not live(). */
  live(): boolean;
  /** Does this rail currently collect from the given Mobile-Money operator? */
  supports(provider: ProviderId, country: CountryCode): boolean;
  /** Ask the payer to approve a debit. Idempotent on req.idempotencyKey. */
  collect(req: CollectRequest): Promise<CollectResult>;
  /** Authoritative status by OUR key — the only thing allowed to settle a collection. */
  status(idempotencyKey: string): Promise<CollectStatus | null>;
  /** OPTIONAL: what this rail charges us to collect from this operator, as a fraction
   *  (0.015 = 1.5%), from the rail's own data. null = unknown. Routing prefers cheaper. */
  feePct?(provider: ProviderId, country: CountryCode): Promise<number | null>;
  /** OPTIONAL: the rail's own accepted range. Checked BEFORE the payer is prompted, so a
   *  customer is never asked to approve an amount the rail will refuse. */
  limits?(provider: ProviderId, country: CountryCode): CollectLimits | null;
  /** OPTIONAL callback auth. Missing → accept the callback and re-query: `status()` is the
   *  settlement gate either way, exactly as on the payout side. */
  verifyCallback?(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;
  /** OPTIONAL: is the provider answering right now? Used by health and by selection. */
  health?(): Promise<{ ok: boolean; note?: string }>;
  /** OPTIONAL: with no credentials, can this rail still stand in for one (sandbox/demo)?
   *  An aggregator adapter that fakes an approval says yes; an OPERATOR's own API says no —
   *  MTN and Orange either have credentials or cannot act, and a rail that cannot act must
   *  never be selected, or the payer's request fails after the transfer has been created. */
  simulates?(): boolean;
}

/** A rail may be chosen only if it can actually do something: real credentials, or an
 *  explicit stand-in for them. */
const selectable = (c: CollectAdapter): boolean => c.configured() || c.simulates?.() === true;

/* ---------------- the aggregator we already collect through ----------------
   Unchanged behaviour: this is the code path core/momoTransfer.ts has always used, now
   behind the interface so it can be one of several rather than the only one. */
const peexitCollector: CollectAdapter = {
  name: "peexit",
  priority: 10,
  configured: peexitConfigured,
  live: peexitLive,
  // The aggregator serves both Cameroonian operators; other corridors are not enabled.
  supports: (provider, country) => country === "CM" && (provider === "MTN" || provider === "ORANGE"),
  collect: async (req) => peexit.collect({ idempotencyKey: req.idempotencyKey, provider: req.provider, country: req.country, phone: req.phone, xaf: req.xaf, name: req.name }),
  status: async (key) => peexit.collectStatus(key),
  feePct: async (provider) => {
    const s = await peexit.feeSchedule().catch(() => null);
    const pct = provider === "MTN" ? s?.collMtn : s?.collOrange;
    return typeof pct === "number" ? pct : null;
  },
  health: async () => { const r = peexit.reachability(); return { ok: !r || r.ok, note: r ? r.reason : undefined }; },
  // Peexit authenticates its callbacks with HTTP Basic using credentials WE give it — the
  // same pair its payout callback uses, so a collection callback is verified exactly as a
  // payout one is rather than trusted because it arrived.
  verifyCallback: (_raw, headers) => {
    const a = headers["authorization"];
    return peexit.verifyCallbackAuth(Array.isArray(a) ? a[0] : a);
  },
  // Without credentials this adapter answers as the sandbox does: the request is "accepted"
  // and simulated, which is what every demo and every test has always relied on.
  simulates: () => !peexitLive(),
};

/** Every known collection rail. Selection is by priority among the rails that serve the
 *  corridor — order here is irrelevant. */
export const COLLECTORS: CollectAdapter[] = [mtnCollector, orangeCollector, peexitCollector];

/** Look up a rail by name (callback dispatch + reconciling a stored collection). */
export function collectorByName(name: string | undefined): CollectAdapter | undefined {
  return name ? COLLECTORS.find((c) => c.name === name) : undefined;
}

/** Rails that serve this corridor, preferred first. Configured rails always come before
 *  unconfigured ones: an unconfigured rail can only simulate, which is right in the sandbox
 *  and useless in production. */
/** The operator's settings for collection (Admin → Rails). Read on every selection so a
 *  change takes effect on the next payment, not the next deploy. */
function collectSettings() {
  const r = getSettings().rails.collect;
  return {
    preferred: (p: ProviderId): string => (p === "MTN" ? r.preferred.MTN : p === "ORANGE" ? r.preferred.ORANGE : "auto") || "auto",
    disabled: new Set(r.disabled ?? []),
    minXaf: r.minXaf || 0,
    maxXaf: r.maxXaf || 0,
    /** What the PROVIDER accepts, as an operator recorded it. We cannot probe a rail's
     *  limits, and being refused after the payer has approved is the worst way to learn one. */
    railLimit: (name: string) => (r.railLimits ?? {})[name],
  };
}

export function collectorsFor(provider: ProviderId, country: CountryCode = "CM"): CollectAdapter[] {
  const cfg = collectSettings();
  const pref = cfg.preferred(provider);
  return COLLECTORS
    .filter((c) => c.supports(provider, country) && selectable(c) && !cfg.disabled.has(c.name))
    // A PINNED rail wins outright — that is what pinning means. Otherwise: rails that can
    // move real money first, then by priority.
    .sort((a, b) =>
      Number(b.name === pref) - Number(a.name === pref)
      || Number(b.configured()) - Number(a.configured())
      || a.priority - b.priority);
}

/** The rail that should take this collection, and why — or null with the reason it cannot.
 *  Amount limits are checked HERE, before the payer's phone rings: being asked to approve a
 *  payment the rail will then refuse is the worst version of this failure. */
export function selectCollector(input: { provider: ProviderId; country?: CountryCode; xaf: number }): { rail: CollectAdapter; why: string } | { rail: null; why: string } {
  const country = input.country ?? "CM";
  const cfg = collectSettings();
  // The operator's own bounds come first: they are a policy decision, not a rail's limit,
  // and a payer must never be prompted for an amount policy already refuses.
  if (cfg.minXaf && input.xaf < cfg.minXaf) return { rail: null, why: `below the configured minimum collection of ${cfg.minXaf} XAF` };
  if (cfg.maxXaf && input.xaf > cfg.maxXaf) return { rail: null, why: `above the configured maximum collection of ${cfg.maxXaf} XAF` };
  const candidates = collectorsFor(input.provider, country);
  if (!candidates.length) {
    const knows = COLLECTORS.filter((c) => c.supports(input.provider, country));
    const off = knows.filter((c) => cfg.disabled.has(c.name)).map((c) => c.name);
    if (off.length) return { rail: null, why: `${off.join(", ")} ${off.length > 1 ? "serve" : "serves"} ${input.provider} but ${off.length > 1 ? "are" : "is"} switched off in Rails` };
    return { rail: null, why: knows.length ? `${knows.map((c) => c.name).join(", ")} ${knows.length > 1 ? "serve" : "serves"} ${input.provider} but none is configured` : `no collection rail serves ${input.provider} in ${country}` };
  }
  const refused: string[] = [];
  for (const c of candidates) {
    // The rail's own declared range, then the one an operator recorded for it. Either can
    // rule a rail out for this amount; the next candidate is tried.
    const declared = c.limits?.(input.provider, country) ?? null;
    const recorded = cfg.railLimit(c.name);
    const lim = declared || recorded ? { minXaf: declared?.minXaf ?? recorded?.minXaf, maxXaf: declared?.maxXaf ?? recorded?.maxXaf } : null;
    if (lim?.minXaf !== undefined && input.xaf < lim.minXaf) { refused.push(`${c.name}: below its ${lim.minXaf} XAF minimum`); continue; }
    if (lim?.maxXaf !== undefined && input.xaf > lim.maxXaf) { refused.push(`${c.name}: above its ${lim.maxXaf} XAF maximum`); continue; }
    const pinned = cfg.preferred(input.provider) === c.name ? ", pinned in Rails" : "";
    return { rail: c, why: `${c.name} (${c.configured() ? (c.live() ? "live" : "sandbox credentials") : "simulated"}${pinned})` };
  }
  return { rail: null, why: refused.join("; ") || "no eligible collection rail" };
}

/** Operator-facing view of the collection side, for /health/deep and the admin console. */
export async function collectHealth(): Promise<Array<{ name: string; configured: boolean; live: boolean; operators: ProviderId[]; ok: boolean | null; note?: string }>> {
  return Promise.all(COLLECTORS.map(async (c) => {
    const h = c.health ? await c.health().catch(() => ({ ok: false, note: "health check threw" })) : null;
    return {
      name: c.name,
      configured: c.configured(),
      live: c.live(),
      operators: (["MTN", "ORANGE"] as ProviderId[]).filter((p) => c.supports(p, "CM")),
      ok: h ? h.ok : null,
      note: h?.note,
    };
  }));
}
