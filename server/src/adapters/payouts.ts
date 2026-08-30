/* ============================================================
   Fiat PAYOUT rail registry — the fiat-side twin of the crypto inbound registry
   (adapters/index.ts). Each Mobile-Money aggregator is a self-describing
   PayoutAdapter; the registry is an OPEN array so a new fiat API plugs in by
   implementing the interface and appending here — nothing else changes (routing,
   webhooks and the state machine talk to aggregators only through this contract).

   Symmetry with crypto RailAdapter: name / priority / configured() / live() /
   supports() + the money verbs (disburse / queryStatus / balance) + callback
   verify/parse. "Work together or separately": each rail activates on its own
   credentials (configured/live), routing fails over across healthy same-class
   rails, and per-rail live-gating means one can be production while another is off.
   ============================================================ */
import type { ProviderId, CountryCode } from "../../../shared/types.js";
import type { PayoutStatus } from "./pawapay.js";
import { pawapayConfigured, pawapayLive, peexitConfigured, peexitLive } from "../config.js";
import * as pawapay from "./pawapay.js";
import * as peexit from "./peexit.js";

export type { PayoutStatus } from "./pawapay.js";
export type { DisburseRequest, DisburseResult } from "./pawapay.js";
import type { DisburseRequest, DisburseResult } from "./pawapay.js";

/** A normalised payout callback event. `status` is advisory only — the webhook
 *  handler always re-queries authoritatively via queryStatus before settling. */
export interface PayoutCallbackEvent { ref: string; providerRef?: string; status?: PayoutStatus }

export interface PayoutAdapter {
  /** Stable id — also the /webhooks/payout/<name> segment and Payment.aggregator value. */
  readonly name: string;
  /** Preference when several configured rails serve a corridor: LOWER wins. */
  readonly priority: number;
  /** Real credentials present → this rail can settle for real (independent of others). */
  configured(): boolean;
  /** Production (moves real money). A sandbox-configured rail is configured() but not live(). */
  live(): boolean;
  /** Does this rail currently route the given Mobile-Money operator? */
  supports(provider: ProviderId): boolean;
  /** Execute a Mobile-Money payout (idempotent on req.idempotencyKey). */
  disburse(req: DisburseRequest): Promise<DisburseResult>;
  /** Authoritative payout status by our ref — never trust a callback body alone. */
  queryStatus(idempotencyKey: string): Promise<PayoutStatus | null>;
  /** Available PAYOUT balance in XAF for a corridor (null = unknown / not real). */
  balance(country: CountryCode, provider?: ProviderId): Promise<number | null>;
  /** Was this ref issued by THIS rail? (webhook routing + reconcile ownership). */
  statusByKey(idempotencyKey: string): DisburseResult | null;
  /** OPTIONAL callback auth — mirrors crypto verifyWebhook. Missing → accept (the
   *  authoritative queryStatus re-query is the real settlement gate either way). */
  verifyCallback?(rawBody: string, headers: Record<string, string | string[] | undefined>): boolean;
  /** OPTIONAL parse a verified callback body → normalised events (mirrors parseEvent). */
  parseCallback?(body: unknown): PayoutCallbackEvent[];
}

/* ---------- Peexit — the primary live payout rail ---------- */
export const peexitAdapter: PayoutAdapter = {
  name: "peexit",
  priority: 0,
  configured: peexitConfigured,
  live: peexitLive,
  // Peexit auto-detects the operator and serves both MTN and Orange (CM). Airtel N/A.
  supports: (p) => p === "MTN" || p === "ORANGE",
  disburse: peexit.disburse,
  queryStatus: peexit.queryStatus,
  balance: peexit.availableBalanceXaf,
  statusByKey: peexit.statusByKey,
  // Peexit authenticates its callback with HTTP Basic Auth (creds we handed it).
  verifyCallback: (_raw, headers) => {
    const a = headers["authorization"];
    return peexit.verifyCallbackAuth(Array.isArray(a) ? a[0] : a);
  },
  parseCallback: (body) => peexit.parsePayoutEvents(body).map((e) => ({ ref: e.ref, status: e.status })),
};

/* ---------- PawaPay — second rail, currently OUT of rotation ---------- */
export const pawapayAdapter: PayoutAdapter = {
  name: "pawapay",
  priority: 10,
  configured: pawapayConfigured,
  live: pawapayLive,
  // PawaPay's account is NOT activated for CMR corridors (deposits + payouts
  // NOT_ALLOWED), so it serves NOTHING for now — leaving it in would let the
  // balance-driven selector pick its funded wallet and fail every payout.
  // RESTORE `p === "MTN" || p === "ORANGE" || p === "AIRTEL"` once PawaPay enables it.
  supports: () => false,
  disburse: pawapay.disburse,
  queryStatus: pawapay.queryStatus,
  balance: pawapay.availableBalanceXaf,
  statusByKey: pawapay.statusByKey,
  // PawaPay v2 uses RFC-9421 asymmetric signatures, which are NOT implemented (see
  // pawapay.verifyCallback). Previously this accepted ANY body whenever the rail was
  // merely configured; it now fails closed on a live rail. Settlement is unaffected —
  // the authoritative queryStatus re-query is the real gate.
  verifyCallback: () => pawapay.verifyCallback(),
  parseCallback: (body) => {
    const payoutId = (body as { payoutId?: string })?.payoutId;
    if (!payoutId) return [];
    const ref = pawapay.refForPayoutId(payoutId);
    return ref ? [{ ref, providerRef: payoutId }] : [];
  },
};

/** Every known payout rail. Order is irrelevant — selection is by priority among the
 *  rails that support the corridor. ADD A RAIL: implement PayoutAdapter, append here. */
export const PAYOUTS: PayoutAdapter[] = [peexitAdapter, pawapayAdapter];

/** Look up a payout rail by name (webhook dispatch + stored-payment reconcile). */
export function payoutByName(name: string | undefined): PayoutAdapter | undefined {
  return name ? PAYOUTS.find((p) => p.name === name) : undefined;
}

/** Rails that support a corridor, highest priority (lowest number) first. */
export function payoutsFor(provider: ProviderId): PayoutAdapter[] {
  return PAYOUTS.filter((p) => p.supports(provider)).sort((a, b) => a.priority - b.priority);
}
