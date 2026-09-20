/* ============================================================
   Universal Payment Identity + multi-rail settlement — the shared vocabulary.

   Four things that must never be one object:
     IDENTITY      who is being paid            +237674123456
     INTENT        what is being paid           10 000 XAF
     PAYMENT RAIL  how the payer provides value Lightning · USDT/ETHEREUM · Mobile Money
     SETTLEMENT    how MoMo›Me moves value out  Mobile Money · Lightning · stablecoin
   The phone number is the human identity. It is not an invoice, not an address, not a wallet:
   it RESOLVES to destinations. docs/upi/UNIVERSAL_PAYMENT_IDENTITY_ARCHITECTURE.md
   ============================================================ */
import type { RecipientIdentitySnapshot } from "./identity.js";

/* ---------- identity ---------- */
export type IdentityType = "MSISDN" | "EMAIL" | "MOMOME_ADDRESS" | "LIGHTNING_ADDRESS" | "UMA" | "BANK_ACCOUNT" | "MERCHANT_ID";
export interface PaymentIdentity {
  type: IdentityType;
  /** The canonical form: E.164 for MSISDN, lower-cased address for the others. */
  canonical: string;
  /** What the identity is anchored in, when known (a number's country and currency). */
  country?: string;
  currency?: string;
  operator?: string | null;
  /** Operator-registered holder, from the Identity Resolution chain (never fabricated). */
  verification?: RecipientIdentitySnapshot;
  /** A MoMo›Me identity (we can resolve destinations for it) vs a foreign one (a Lightning
   *  Address at another domain, a UMA address): we can only pay the latter as given. */
  native: boolean;
}

/* ---------- destinations ---------- */
export type Rail = "LIGHTNING" | "STABLECOIN" | "MOBILE_MONEY" | "BANK" | "UMA";
export type PaymentDestination =
  | { rail: "LIGHTNING"; protocol: "LIGHTNING_ADDRESS" | "LNURL_PAY" | "BOLT11"; address: string; status: DestinationStatus }
  | { rail: "MOBILE_MONEY"; provider: string; country: string; currency: string; identifier: string; status: DestinationStatus }
  | { rail: "STABLECOIN"; asset: string; network: string; destination: string; status: DestinationStatus }
  | { rail: "BANK"; country: string; currency: string; account: string; status: DestinationStatus }
  | { rail: "UMA"; address: string; status: DestinationStatus };
export type DestinationStatus = "ACTIVE" | "UNVERIFIED" | "INACTIVE" | "UNSUPPORTED";

/* ---------- assets and networks ---------- */
export type AssetType = "FIAT" | "CRYPTO" | "STABLECOIN";
export interface Asset {
  /** "BTC", "USDT", "USDC", "XAF", "KES" … */
  code: string;
  type: AssetType;
  /** Explicit for anything that moves on a chain — "LIGHTNING", "ETHEREUM"; null for fiat. */
  network: string | null;
  decimals: number;
  issuer?: string;
  /** The fiat currency it represents (USDT → USD) or is (XAF → XAF). */
  currency: string;
  status: "ACTIVE" | "RECEIVE_ONLY" | "PLANNED" | "DISABLED";
}
export interface BlockchainNetwork {
  id: string;             // "LIGHTNING" | "ETHEREUM" | "TRON" | "BASE" | …
  name: string;
  chainId: number | null;
  nativeAsset: string;
  rpcProvider: string | null;
  explorer: string | null;
  /** Confirmations after which a transfer is CONFIRMED, and FINALIZED. */
  confirmationPolicy: { confirmed: number; finalized: number; timeoutMin: number };
  feeModel: "NONE" | "ROUTING_FEE" | "GAS" | "BANDWIDTH";
  status: "ACTIVE" | "PLANNED" | "DISABLED";
}
/** A blockchain transfer's own lifecycle. Broadcast is not completion. */
export type ChainTxState = "CREATED" | "BROADCASTING" | "BROADCAST" | "CONFIRMING" | "CONFIRMED" | "FINALIZED" | "FAILED" | "EXPIRED" | "REORGED";
export interface ChainTx {
  id: string; asset: string; network: string; direction: "IN" | "OUT"; amount: number; to?: string; from?: string;
  txid?: string; confirmations: number; state: ChainTxState; createdAt: string; updatedAt: string;
  events: Array<{ at: string; state: ChainTxState; note?: string }>;
  /** Set when the lifecycle could not be closed by observation alone. */
  reconciliation?: "REQUIRED" | "RESOLVED";
}

/* ---------- capabilities and health ---------- */
export interface ProviderCapability {
  kind: "MOBILE_MONEY" | "LIGHTNING" | "STABLECOIN" | "BANK" | "AGGREGATOR";
  id: string;                       // "CM:MTN", "LIGHTNING", "USDT/ETHEREUM", "pawapay"
  country?: string; provider?: string; asset?: string; network?: string;
  capabilities: { collection?: boolean; payout?: boolean; identity_verification?: boolean; send?: boolean; receive?: boolean; settlement?: boolean; currency?: string[] };
  health: RailHealthState;
  reason?: string;
}
export type RailHealthState = "HEALTHY" | "DEGRADED" | "UNAVAILABLE" | "MAINTENANCE";

/* ---------- intent, quote, route, request ---------- */
export type IntentState =
  | "CREATED" | "IDENTITY_RESOLVED" | "QUOTED" | "ROUTE_SELECTED" | "LIQUIDITY_RESERVED"
  | "PAYMENT_PENDING" | "PAYMENT_DETECTED" | "PAYMENT_CONFIRMED"
  | "SETTLEMENT_PENDING" | "SETTLEMENT_PROCESSING" | "SETTLEMENT_COMPLETED" | "COMPLETED"
  | "EXPIRED" | "CANCELLED" | "PAYMENT_FAILED" | "SETTLEMENT_FAILED" | "LIQUIDITY_FAILED" | "PROVIDER_UNAVAILABLE" | "RECONCILIATION_REQUIRED";
export interface Money { value: number; currency: string }
export interface FxRateQuote { pair: string; rate: number; mid: number; spreadBps: number; source: string; timestamp: string; expiresAt: string }
export interface FeeLines { network: number; provider: number; momome: number; fxSpread: number; liquidity: number; total: number; currency: string }
export interface QuoteOption {
  id: string;
  sourceRail: Rail;
  sourceAsset: string;           // "BTC", "USDT", "XAF"
  sourceNetwork: string | null;  // "LIGHTNING", "ETHEREUM", null
  sourceAmount: number;          // in source asset units
  sourceAmountLabel: string;
  destinationRail: Rail;
  destinationAmount: Money;      // what the recipient receives
  fx: FxRateQuote | null;
  fees: FeeLines;
  latencySec: { p50: number; p95: number };
  expiresAt: string;
  available: boolean;
  reason?: string;
}
export type RouteType = "DIRECT" | "LIGHTNING" | "STABLECOIN" | "AGGREGATOR" | "HYBRID";
export interface RouteV2 {
  id: string;
  type: RouteType;
  sourceRail: Rail; settlementRail: Rail; destinationRail: Rail;
  steps: Array<{ kind: string; actor: string; detail: string }>;
  fees: FeeLines; fx: FxRateQuote | null;
  latencySec: { p50: number; p95: number };
  liquidity: { pool: string; available: number | null; required: number; ok: boolean };
  providerAvailability: RailHealthState;
  risk: "LOW" | "MEDIUM" | "HIGH";
  limits: { min: number; max: number; currency: string };
  status: "AVAILABLE" | "UNAVAILABLE";
  reason?: string;
  /** Deterministic ordering key (the rule is configuration, never a score). */
  rank: number;
}
export type PaymentProtocol = "BOLT11" | "LNURL_PAY" | "ERC20_TRANSFER" | "MOBILE_MONEY_COLLECTION" | "BANK_TRANSFER" | "UMA";
export interface PaymentRequestV2 {
  id: string;
  intentId: string;
  protocol: PaymentProtocol;
  sourceAsset: string; sourceNetwork: string | null; sourceAmount: number;
  /** What the payer pays against — the V1 pay instruction (invoice / address / URI). */
  instruction: unknown;
  expiresAt: string;
  /** The V1 record that carries the money (ids the ledger and reconciliation key on). */
  refs: LedgerRefs;
}
export interface LedgerRefs {
  correlationId: string;
  paymentIntentId: string;
  quoteId?: string; routeId?: string; settlementId?: string;
  /** V1 payment id / network tx id that actually moved the money. */
  v1PaymentId?: string; networkTxId?: string;
  providerReference?: string; blockchainTxid?: string; mobileMoneyReference?: string;
}
export interface PaymentIntentV2 {
  id: string;
  owner: string;
  recipient: { identity: string; resolved?: PaymentIdentity; destinations: PaymentDestination[] };
  amount: Money;
  source?: { rail: Rail; asset: string; network: string | null };
  destination?: { rail: Rail; provider?: string; currency: string; country?: string };
  state: IntentState;
  events: Array<{ at: string; state: IntentState; note?: string }>;
  quote?: { id: string; options: QuoteOption[]; expiresAt: string };
  route?: RouteV2;
  request?: PaymentRequestV2;
  refs: LedgerRefs;
  /** Shadow: what the routing engine would have chosen, beside what V1 did. */
  shadow?: { engineRoute: string; v1Route: string; agree: boolean; at: string };
  createdAt: string; updatedAt: string; expiresAt: string;
}

export const UPI_FLAGS = [
  "UNIVERSAL_PAYMENT_IDENTITY_ENABLED", "PAYMENT_INTENT_V2_ENABLED", "MULTI_RAIL_ROUTING_ENABLED",
  "STABLECOIN_SETTLEMENT_ENABLED", "STABLECOIN_USDT_ENABLED", "STABLECOIN_USDC_ENABLED",
  "PHONE_PAYMENT_RESOLUTION_ENABLED", "WALLET_RESOLUTION_API_ENABLED", "UMA_COMPATIBILITY_ENABLED", "CROSS_BORDER_ROUTING_ENABLED",
] as const;
export type UpiFlag = (typeof UPI_FLAGS)[number];
