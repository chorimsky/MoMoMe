/* ============================================================
   MoMo›Me interoperability model — the vocabulary the v1 API speaks.

   MoMo›Me does not compete with the financial system; it makes it interoperable. These
   types describe a payment WITHOUT reference to any one network: what the user wants
   (PaymentIntent), where value can land (PaymentAddress), how it could get there
   (PaymentRoute), what it costs (PaymentQuote), and where it is (PaymentStatus). Rails and
   providers execute; they never leak into these shapes except as named steps.

   Country-agnostic by construction: currencies and providers are strings resolved by the
   registry, never enumerated here.
   ============================================================ */
import type { CountryCode, Method, PaymentState, ProviderId } from "./types.js";

/* ---------- rails & providers ---------- */
/** A payment NETWORK class. A provider is one operator/integration on a rail. */
export type RailId = "mobile_money" | "lightning" | "onchain_btc" | "stablecoin" | "bank" | "card" | "ussd";
export type Direction = "receive" | "send";
export type ProviderHealth = "OPERATIONAL" | "DEGRADED" | "DOWN" | "NOT_CONFIGURED" | "SANDBOX";

export interface RailCapabilities {
  directions: Direction[];
  currencies: string[];            // ISO or ticker: "XAF", "BTC", "USDT", "USDC"
  instant: boolean;                // settles in seconds under normal conditions
  supportsInvoice: boolean;        // fixed-amount payment request (bolt11, link)
  supportsAddress: boolean;        // reusable destination (0x…, bc1…, phone)
  supportsRefund: boolean;         // an automated refund path exists
  supportsQuote: boolean;
  supportsStatus: boolean;
}

export interface ProviderInfo {
  id: string;                      // "ibex", "peexit", "pawapay", "phoenixd", "sandbox"
  rail: RailId;
  name: string;
  /** Operators/networks this provider reaches (e.g. ["MTN","ORANGE"] or ["LIGHTNING","ONCHAIN"]). */
  reaches: string[];
  countries: CountryCode[];
  health: ProviderHealth;
  live: boolean;                   // moves real money
  successRate: number;             // 0..1, recent
  avgLatencyMs: number;
  /** What this provider can hold/route right now, when it exposes it (XAF for payout rails). */
  liquidity?: { currency: string; available: number | null };
}

export interface RailInfo {
  id: RailId;
  name: string;
  capabilities: RailCapabilities;
  providers: ProviderInfo[];
  /** Currency limits per transaction, in the rail's settlement currency of this deployment. */
  limits: { currency: string; min: number; max: number };
  fees: { platformPct: number; spreadBps?: number };
  /** The regulated party doing the financial activity on this rail — MoMo›Me orchestrates. */
  regulatedParty: string;
}

/* ---------- payment address ---------- */
export type PaymentAddressType = "PHONE" | "LIGHTNING_ADDRESS" | "MERCHANT_CODE" | "PAYMENT_LINK" | "QR" | "EMAIL" | "ACCOUNT_REFERENCE";

export interface PaymentAddress {
  id: string;                      // stable key: "<type>:<normalised value>"
  type: PaymentAddressType;
  value: string;                   // normalised (digits for PHONE, lowercase for LN)
  /** Who this address belongs to, as far as we may say publicly. */
  owner: { displayName: string | null; nameVerified: boolean; kind: "person" | "merchant" | "unknown" };
  verified: boolean;               // the owner proved control (OTP / merchant verification)
  country: CountryCode | null;
  currency: string | null;         // what lands there ("XAF")
  /** How value can reach this address, best first. */
  rails: Array<{ rail: RailId; provider: string; currency: string; available: boolean; reason?: string }>;
  defaultRail: RailId | null;
  status: "ACTIVE" | "UNSUPPORTED" | "BLOCKED" | "RESERVED";
  limits?: { currency: string; min: number; max: number };
}

/* ---------- payment intent ---------- */
/** Canonical, rail-independent status. `toCanonicalStatus` maps the engine's fine states. */
export type PaymentStatus =
  | "CREATED" | "VALIDATING" | "COMPLIANCE_REVIEW" | "QUOTED" | "AUTHORIZED" | "ROUTING"
  | "PROCESSING" | "PENDING_SETTLEMENT" | "COMPLETED" | "FAILED" | "CANCELLED" | "EXPIRED" | "REFUNDED";

export function toCanonicalStatus(state: PaymentState, expiresAt?: string, now = Date.now(), lastNote?: string): PaymentStatus {
  if (state === "FAILED" && lastNote && /^cancelled by/i.test(lastNote)) return "CANCELLED";
  switch (state) {
    case "QUOTED": return "QUOTED";
    case "AWAITING_INBOUND": return expiresAt && Date.parse(expiresAt) < now ? "EXPIRED" : "AUTHORIZED";
    case "INBOUND_DETECTED": return "PROCESSING";
    case "INBOUND_CONFIRMED":
    case "FX_LOCKED":
    case "PAYOUT_REQUESTED": return "PENDING_SETTLEMENT";
    case "PAYOUT_CONFIRMED":
    case "DELIVERED": return "COMPLETED";
    case "MANUAL_REVIEW": return "COMPLIANCE_REVIEW";
    case "REFUND_PENDING": return "FAILED";
    case "REFUNDED": return "REFUNDED";
    case "FAILED": return "FAILED";
    default: return "PROCESSING";
  }
}

export interface PaymentIntent {
  id: string;
  owner: string;                   // authenticated device / partner id — never exposed onward
  destination: PaymentAddress;
  amount: number;                  // in destination currency (what the recipient receives)
  destinationCurrency: string;
  sourceCurrency: string | null;   // the payer's asset, once a route is chosen
  purpose?: string;
  preferredRail?: RailId;
  preferredMethod?: Method;        // V1: the crypto pay-in method the sender picked
  availableRoutes: string[];       // route ids from the last routing pass
  routeId: string | null;          // the locked route
  paymentId: string | null;        // the engine payment executing the route
  paymentRef: string | null;       // MMM-… (what the user sees)
  status: PaymentStatus;
  riskStatus: "unknown" | "clear" | "review" | "blocked";
  complianceStatus: "unknown" | "clear" | "review" | "blocked";
  idempotencyKey?: string;
  createdAt: string;
  updatedAt: string;
}

/* ---------- route & quote ---------- */
export interface RouteStep {
  rail: RailId;
  provider: string;
  currency: string;
  role: "source" | "conversion" | "destination";
  /** The regulated/operating party for this step. */
  party: string;
}

export interface PaymentQuote {
  amount: number;                  // recipient receives
  destinationCurrency: string;
  sourceCurrency: string;
  sourceAmount: number;            // what the payer sends, in source units
  sourceAmountLabel: string;
  exchangeRate: number;            // destination units per source unit
  providerFee: number;             // in destination currency (0 when absorbed)
  platformFee: number;
  networkFee: number;              // payer-side network cost we can estimate (0 = none / unknown)
  totalFee: number;
  recipientAmount: number;
  estimatedSeconds: number;
  estimateOnly: boolean;           // re-priced on arrival (on-chain BTC)
  expiresAt: string;
  quoteId: string;                 // the engine quote to execute with
}

export interface PaymentRoute {
  id: string;
  intentId: string;
  steps: RouteStep[];
  sourceRail: RailId; sourceProvider: string; sourceCurrency: string;
  conversionRequired: boolean;
  destinationRail: RailId; destinationProvider: string; destinationCurrency: string;
  method: Method;                  // V1 engine method this route executes as
  quote: PaymentQuote;
  score: { cost: number; speed: number; reliability: number; total: number };
  checks: Array<{ name: string; ok: boolean; detail?: string }>;
  viable: boolean;
  status: "PROPOSED" | "LOCKED" | "EXECUTING" | "COMPLETED" | "FAILED" | "EXPIRED";
  createdAt: string;
}

/* ---------- events & reconciliation ---------- */
export interface PaymentEvent {
  id: string;
  provider: string;
  eventType: string;               // "webhook.received" | "webhook.rejected" | "callback.received" | …
  providerReference: string | null;
  paymentId: string | null;
  payloadHash: string;             // sha256 of the raw body — dedupe + audit, never the body
  receivedAt: string;
  processedAt: string | null;
  status: "received" | "verified" | "rejected" | "duplicate" | "processed";
  detail?: string;
}

export interface ReconciliationRecord {
  scope: "deposits";
  provider: string;
  asset: string;
  externalId: string;              // the provider's id for the movement
  externalAmount: number;
  internalPaymentRef: string | null;
  internalAmount: number | null;
  verdict: "matched" | "missing_internal" | "amount_mismatch" | "unattributed" | "pending";
  detail?: string;
}
export interface ReconciliationReport {
  generatedAt: string;
  windowDays: number;
  totals: Record<ReconciliationRecord["verdict"], number>;
  records: ReconciliationRecord[];
}

export type { CountryCode, Method, ProviderId };
