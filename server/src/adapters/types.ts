/* ============================================================
   Crypto INBOUND rail adapter contract. One interface per provider so the
   registry, state machine and webhook handler don't care who the rail is.
   Add a new crypto rail by implementing this interface and registering it
   in adapters/index.ts — nothing else in the codebase needs to change.
   ============================================================ */
import type { Method, PayInstruction } from "../../../shared/types.js";

export interface InstructionRequest {
  method: Method;
  /** Payment ref — used as the memo and the idempotency key with the provider. */
  ref: string;
  /** Inbound amount in asset units (BTC or USDT). */
  amount: number;
  /** Quote value in USD — used by rails that can receive into a USD-denominated
   *  wallet to hedge crypto-price risk. Optional; a rail
   *  that only receives in the native asset ignores it. */
  usd?: number;
  /** Provider webhook callback URL for this rail. */
  callbackUrl: string;
}

/** Normalised inbound event parsed from a provider webhook. */
export interface RailEvent {
  /** Matches PayInstruction.providerRef (LN payment hash / address). */
  providerRef: string;
  kind: "detected" | "confirmed";
  /** Actual amount received, in asset units (for under/overpayment checks). */
  amount?: number;
  /** The RAIL'S OWN id for this particular deposit — distinct per deposit, unlike
   *  providerRef, which for on-chain and ERC-20 is the receive ADDRESS and is therefore
   *  identical across every deposit sent to it. Without this, a redelivered webhook and a
   *  genuine SECOND payment to the same address are indistinguishable, and the settlement
   *  guard treats both as "already booked" — silently keeping real money. Optional: a rail
   *  that cannot supply one degrades to the old behaviour. */
  eventId?: string;
}

/** Authoritative settlement result from re-querying the provider by providerRef.
 *  `null` (from confirmSettlement) means indeterminate — the caller must not treat
 *  it as either settled or failed (e.g. an on-chain address that isn't pollable). */
export interface SettlementStatus {
  settled: boolean;
  failed: boolean;
}

/** Result of an OUTBOUND crypto payment (a refund to a sender / a treasury sweep).
 *  `transactionId` is a rail id to poll `outboundStatus` by (for Lightning, the
 *  invoice's payment hash). `settled` = confirmed synchronously; else poll. */
export interface OutboundResult {
  transactionId: string;
  settled: boolean;
  feesMsat?: number;
}

export interface RailAdapter {
  /** Stable rail id — also the /webhooks/:provider path segment and
   *  PayInstruction.provider value. Open string; must be unique across rails. */
  readonly name: string;
  /** Selection priority when several configured rails support a method:
   *  LOWER wins. IBEX (the base crypto rail) = 0; added rails > 0; the
   *  zero-credential sandbox catch-all is highest (always last). */
  readonly priority: number;
  /** True when this rail has the credentials it needs to be active. The registry
   *  only routes to configured rails. The sandbox rail returns true unconditionally. */
  configured(): boolean;
  /** True when a SETTLED inbound on this rail may authorize a REAL Mobile-Money
   *  payout (i.e. it moves real money). The sandbox rail returns false — a simulated
   *  inbound must never drive a real payout. Generalises the old IBEX-only check. */
  trusted(): boolean;
  /** True if this adapter handles the given method. */
  supports(method: Method): boolean;
  /** Create the inbound pay instruction (invoice / address). Idempotent on ref. */
  createInstruction(req: InstructionRequest): Promise<PayInstruction>;
  /** Verify a raw webhook payload's authenticity. */
  /** `clientIp` is the TRUST-PROXY-RESOLVED sender (Express req.ip), not a raw header.
   *  Adapters that allowlist sender IPs must prefer it: X-Forwarded-For is supplied by the
   *  caller and can be forged, whereas req.ip is derived using the configured proxy hop
   *  count. Optional so non-Express callers (tests, internal replay) still work. */
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>, clientIp?: string): boolean;
  /** Parse a verified webhook body into a normalised event (null = ignore). */
  parseEvent(body: unknown): RailEvent | null;
  /** OPTIONAL authoritative re-query: given a providerRef (LN payment hash / tx id),
   *  is the inbound actually settled? Used to (a) never settle on a webhook body alone
   *  and (b) reconcile lost webhooks. Return null when it can't be determined (e.g. an
   *  on-chain address). A rail with no pollable status (the sandbox) omits this. */
  confirmSettlement?(providerRef: string): Promise<SettlementStatus | null>;

  /** OPTIONAL crypto-OUTBOUND (refund a sender / treasury sweep). Pays a BOLT11 invoice
   *  from the rail's wallet; `amountMsat` is required for an amount-less invoice. A rail
   *  that can't send omits this — the registry only routes refunds to rails that have it,
   *  so refunds route through whichever rail is live, without the state machine knowing. */
  payInvoice?(bolt11: string, amountMsat?: number): Promise<OutboundResult>;
  /** OPTIONAL authoritative status of an OUTBOUND payment by its id (LN payment hash /
   *  tx id). null = indeterminate. Pairs with payInvoice for the refund reconcile loop. */
  outboundStatus?(txId: string): Promise<SettlementStatus | null>;
}
